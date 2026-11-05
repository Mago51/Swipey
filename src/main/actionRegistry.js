const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { clipboard, shell } = require("electron");
const { helperPath } = require("./nativeHelpers.js");
const { hasTemplatePlaceholder, validateVariableName, validateVariableValue } = require("./variables.js");

const MAX_WAIT_MS = 5 * 60 * 1000;
const MAX_APP_WAIT_MS = 10 * 60 * 1000;
const MIN_APP_WAIT_MS = 250;
const DEFAULT_APP_POLL_MS = 500;
const MAX_KEYBOARD_SEQUENCE_STEPS = 50;
const MAX_OPEN_MULTIPLE_URLS = 20;
const VOLUME_STEP_COUNT = 2;
const allowedUrlProtocols = new Set(["http:", "https:"]);
const windowsAutomationHelper = helperPath("Swipey.WindowsAutomation");

let flowRunner = null;
const dependencies = {
  clipboard,
  execFile,
  flowStore: null,
  presetStore: null,
  shell,
  spawn,
  windowsAutomation: null,
  browserResolver: null,
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function configureActionRegistry(options = {}) {
  flowRunner = typeof options.runFlow === "function" ? options.runFlow : flowRunner;
  if (options.clipboard) dependencies.clipboard = options.clipboard;
  if (typeof options.execFile === "function") dependencies.execFile = options.execFile;
  if (options.flowStore && typeof options.flowStore.findFlow === "function") dependencies.flowStore = options.flowStore;
  if (options.presetStore && typeof options.presetStore.findPreset === "function") dependencies.presetStore = options.presetStore;
  if (options.shell) dependencies.shell = options.shell;
  if (typeof options.spawn === "function") dependencies.spawn = options.spawn;
  if (options.windowsAutomation && typeof options.windowsAutomation.run === "function") dependencies.windowsAutomation = options.windowsAutomation;
  if (typeof options.browserResolver === "function") dependencies.browserResolver = options.browserResolver;
  if (typeof options.delay === "function") dependencies.delay = options.delay;
}

function ok(normalizedParams = null) {
  return normalizedParams ? { valid: true, normalizedParams } : { valid: true };
}

function invalid(code, message, details = {}) {
  return { valid: false, code, message, ...details };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateWait(params) {
  if (!isPlainObject(params)) return invalid("INVALID_ACTION_PARAMS", "Wait action parameters are missing.");
  const milliseconds = Number(params.milliseconds);
  if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds)) {
    return invalid("INVALID_WAIT_DURATION", "Wait duration must be an integer number of milliseconds.");
  }
  if (milliseconds < 0) return invalid("INVALID_WAIT_DURATION", "Wait duration cannot be negative.");
  if (milliseconds > MAX_WAIT_MS) return invalid("WAIT_DURATION_TOO_LONG", `Wait duration cannot exceed ${MAX_WAIT_MS}ms.`);
  return ok({ milliseconds });
}

function validateAppOpen(params) {
  if (!isPlainObject(params) || typeof params.path !== "string" || params.path.trim() === "") {
    return invalid("APP_PATH_REQUIRED", "Application path is required.");
  }
  const appPath = params.path.trim();
  const looksLikePath = appPath.includes("\\") || appPath.includes("/") || path.isAbsolute(appPath);
  if (looksLikePath && !fs.existsSync(appPath)) return invalid("APP_PATH_NOT_FOUND", "Application path was not found.");
  return ok({ path: appPath });
}

function validateAppClose(params) {
  if (!isPlainObject(params)) return invalid("INVALID_ACTION_PARAMS", "Close App parameters are missing.");
  const processName = normalizedProcessName(params.processName || params.appName || params.path);
  if (!processName) return invalid("PROCESS_NAME_REQUIRED", "Process name is required.");
  if (!/^[a-z0-9_.-]+\.exe$/i.test(processName)) return invalid("INVALID_PROCESS_NAME", "Process name must be a Windows executable image name.");
  return ok({ processName });
}

function normalizeAppTarget(params) {
  if (!isPlainObject(params)) return invalid("APP_TARGET_REQUIRED", "Choose an app target.");
  const executablePath = stringOrEmpty(params.executablePath || params.path);
  const processName = normalizedProcessName(params.processName || params.appName || executablePath || params.displayName);
  const windowTitle = stringOrEmpty(params.windowTitle);
  const displayName = stringOrEmpty(params.displayName || params.appName || processName || executablePath || windowTitle);
  if (!processName && !executablePath && !windowTitle) return invalid("APP_TARGET_REQUIRED", "Choose an app target.");
  if (processName && !/^[a-z0-9_. -]+(\.exe)?$/i.test(processName)) return invalid("INVALID_PROCESS_NAME", "Process name is invalid.");
  if (executablePath && path.isAbsolute(executablePath) && !fs.existsSync(executablePath)) return invalid("APP_PATH_NOT_FOUND", "Application path was not found.");
  return ok({ executablePath, processName, windowTitle, displayName });
}

function validateAppTarget(params) {
  return normalizeAppTarget(params);
}

function validateMovePosition(params) {
  const target = normalizeAppTarget(params);
  if (!target.valid) return target;
  const position = String(params.position || "").trim();
  const allowed = new Set(["left-half", "right-half", "top-left", "top-right", "bottom-left", "bottom-right", "center"]);
  if (!allowed.has(position)) return invalid("INVALID_POSITION", "Choose a supported window position.");
  return ok({ ...target.normalizedParams, position });
}

function validateWaitUntilAppOpens(params) {
  const target = normalizeAppTarget(params);
  if (!target.valid) return target;
  const timeoutMs = Number(params.timeoutMs ?? 30000);
  const pollIntervalMs = Number(params.pollIntervalMs ?? DEFAULT_APP_POLL_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_APP_WAIT_MS || timeoutMs > MAX_APP_WAIT_MS) {
    return invalid("INVALID_APP_WAIT_TIMEOUT", `Timeout must be ${MIN_APP_WAIT_MS}ms through ${MAX_APP_WAIT_MS}ms.`);
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 5000) {
    return invalid("INVALID_APP_WAIT_INTERVAL", "Poll interval must be 50ms through 5000ms.");
  }
  return ok({ ...target.normalizedParams, timeoutMs, pollIntervalMs });
}

function validateWebOpen(params) {
  if (!isPlainObject(params) || typeof params.url !== "string" || params.url.trim() === "") {
    return invalid("URL_REQUIRED", "Website URL is required.");
  }
  const normalized = normalizeHttpUrl(params.url);
  if (!normalized.valid) return normalized;
  return ok({ url: normalized.url });
}

function validateSearchQuery(params) {
  if (!isPlainObject(params) || typeof params.query !== "string" || params.query.trim() === "") {
    return invalid("SEARCH_QUERY_REQUIRED", "Search query is required.");
  }
  return ok({ query: params.query.trim() });
}

function validateRunFlow(params, context = {}) {
  if (!isPlainObject(params) || typeof params.flowId !== "string" || params.flowId.trim() === "") {
    return invalid("FLOW_ID_REQUIRED", "Choose a Flow to run.");
  }
  const targetFlowId = params.flowId.trim();
  if (targetFlowId === context.currentFlowId) return invalid("FLOW_RECURSION_DETECTED", "A Flow cannot run itself.");
  const targetFlow = getFlowStore().findFlow(targetFlowId);
  if (!targetFlow) return invalid("FLOW_NOT_FOUND", "Referenced Flow was not found.");
  if (!targetFlow.enabled) return invalid("FLOW_DISABLED", "Referenced Flow is disabled.");
  if (Array.isArray(context.ancestry) && context.ancestry.includes(targetFlowId)) {
    return invalid("FLOW_RECURSION_DETECTED", "Flow recursion was detected.");
  }
  return ok({ flowId: targetFlowId });
}

function validateNoParams(params) {
  if (!isPlainObject(params)) return invalid("INVALID_ACTION_PARAMS", "Action parameters are malformed.");
  if (Object.keys(params).length > 0) return invalid("UNEXPECTED_PARAMS", "This action does not accept parameters.");
  return ok();
}

function validateSetVariable(params) {
  if (!isPlainObject(params)) return invalid("INVALID_ACTION_PARAMS", "Set Variable parameters are missing.");
  const nameCheck = validateVariableName(params.name);
  if (!nameCheck.valid) return invalid(nameCheck.code, nameCheck.message);
  const valueType = String(params.valueType || "").trim();
  if (!["string", "number", "boolean"].includes(valueType)) {
    return invalid("INVALID_VARIABLE_TYPE", "Variable type must be string, number, or boolean.");
  }
  const valueCheck = validateVariableValue(valueType, params.value);
  if (!valueCheck.valid) return invalid(valueCheck.code, valueCheck.message);
  return ok({ name: params.name, valueType, value: valueCheck.value });
}

function validateVariableMutation(params) {
  if (!isPlainObject(params)) return invalid("INVALID_ACTION_PARAMS", "Parameters are missing.");
  const nameCheck = validateVariableName(params.name);
  if (!nameCheck.valid) return invalid(nameCheck.code, nameCheck.message);
  const amount = params.amount === undefined || params.amount === "" ? 1 : Number(params.amount);
  if (!Number.isFinite(amount)) return invalid("INVALID_INCREMENT", "Amount must be a finite number.");
  return ok({ name: params.name, amount });
}

function validateStopWithError(params) {
  if (!isPlainObject(params) || typeof params.message !== "string" || params.message.trim() === "") {
    return invalid("STOP_MESSAGE_REQUIRED", "Error message is required.");
  }
  if (params.message.length > 500) return invalid("STOP_MESSAGE_TOO_LONG", "Error message cannot exceed 500 characters.");
  return ok({ message: params.message });
}

function validateTypeText(params) {
  if (!isPlainObject(params) || typeof params.text !== "string") return invalid("TEXT_REQUIRED", "Text is required.");
  if (params.text.length > 1000) return invalid("TEXT_TOO_LONG", "Text cannot exceed 1000 characters.");
  return ok({ text: params.text });
}

function validatePressKey(params) {
  if (!isPlainObject(params) || typeof params.key !== "string" || params.key.trim() === "") return invalid("KEY_REQUIRED", "Key is required.");
  const key = normalizeKeyToken(params.key);
  if (!key) return invalid("UNSUPPORTED_KEY", "Unsupported key.");
  return ok({ key });
}

function validatePressKeyCombination(params) {
  if (!isPlainObject(params) || typeof params.combination !== "string" || params.combination.trim() === "") {
    return invalid("KEY_COMBINATION_REQUIRED", "Key combination is required.");
  }
  const normalized = normalizeKeyCombination(params.combination);
  if (!normalized.valid) return normalized;
  return ok({ combination: normalized.combination });
}

function validateVolumePercent(params) {
  const percent = Number(params?.percent);
  if (!Number.isFinite(percent) || !Number.isInteger(percent) || percent < 0 || percent > 100) {
    return invalid("INVALID_VOLUME_PERCENT", "Volume must be 0 through 100.");
  }
  return ok({ percent });
}

function validatePastePresetText(params) {
  if (!isPlainObject(params) || typeof params.presetId !== "string" || params.presetId.trim() === "") {
    return invalid("PRESET_ID_REQUIRED", "Choose a preset.");
  }
  return ok({ presetId: params.presetId.trim() });
}

function validateKeyboardSequence(params) {
  if (!isPlainObject(params) || !Array.isArray(params.steps)) return invalid("KEYBOARD_SEQUENCE_REQUIRED", "Keyboard sequence steps are required.");
  if (params.steps.length === 0) return invalid("KEYBOARD_SEQUENCE_EMPTY", "Keyboard sequence must include at least one step.");
  if (params.steps.length > MAX_KEYBOARD_SEQUENCE_STEPS) return invalid("KEYBOARD_SEQUENCE_TOO_LONG", `Keyboard sequence cannot exceed ${MAX_KEYBOARD_SEQUENCE_STEPS} steps.`);
  const steps = [];
  for (const [index, step] of params.steps.entries()) {
    if (!isPlainObject(step)) return invalid("INVALID_KEYBOARD_SEQUENCE_STEP", `Step ${index + 1} is invalid.`);
    const type = String(step.type || "").trim();
    const delayAfterMs = Number(step.delayAfterMs ?? 0);
    if (!Number.isInteger(delayAfterMs) || delayAfterMs < 0 || delayAfterMs > 10000) return invalid("INVALID_SEQUENCE_DELAY", "Step delay must be 0ms through 10000ms.");
    if (type === "key") {
      const key = normalizeKeyToken(step.key);
      if (!key) return invalid("UNSUPPORTED_KEY", `Step ${index + 1} uses an unsupported key.`);
      steps.push({ type, key, delayAfterMs });
      continue;
    }
    if (type === "combo") {
      const combination = Array.isArray(step.keys) ? step.keys.join("+") : step.combination;
      const normalized = normalizeKeyCombination(combination);
      if (!normalized.valid) return invalid(normalized.code, `Step ${index + 1}: ${normalized.message}`);
      steps.push({ type, combination: normalized.combination, tokens: normalized.tokens, delayAfterMs });
      continue;
    }
    if (type === "text") {
      if (typeof step.text !== "string" || step.text.length === 0) return invalid("TEXT_REQUIRED", `Step ${index + 1} text is required.`);
      if (step.text.length > 1000) return invalid("TEXT_TOO_LONG", `Step ${index + 1} text is too long.`);
      steps.push({ type, text: step.text, delayAfterMs });
      continue;
    }
    return invalid("INVALID_SEQUENCE_STEP_TYPE", `Step ${index + 1} type is unsupported.`);
  }
  return ok({ steps });
}

function validateOpenInBrowser(params) {
  const url = validateWebOpen(params);
  if (!url.valid) return url;
  const browserId = String(params.browserId || params.browser || "").trim().toLowerCase();
  if (!browserId || browserId === "default") return invalid("BROWSER_REQUIRED", "Choose Chrome, Edge, or Firefox.");
  if (!["chrome", "edge", "firefox", "brave", "opera"].includes(browserId)) return invalid("UNSUPPORTED_BROWSER", "Browser is not supported.");
  return ok({ url: url.normalizedParams.url, browserId });
}

function validateOpenMultiple(params) {
  if (!isPlainObject(params) || !Array.isArray(params.urls)) return invalid("URL_LIST_REQUIRED", "Website list is required.");
  if (params.urls.length < 1) return invalid("URL_LIST_REQUIRED", "Add at least one website.");
  if (params.urls.length > MAX_OPEN_MULTIPLE_URLS) return invalid("TOO_MANY_URLS", `Open Multiple Websites supports up to ${MAX_OPEN_MULTIPLE_URLS} URLs.`);
  const urls = [];
  for (const rawUrl of params.urls) {
    const normalized = normalizeHttpUrl(rawUrl);
    if (!normalized.valid) return normalized;
    urls.push(normalized.url);
  }
  const delayMs = Number(params.delayMs ?? 250);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10000) return invalid("INVALID_OPEN_DELAY", "Delay must be 0ms through 10000ms.");
  const browserId = String(params.browserId || params.browser || "default").trim().toLowerCase() || "default";
  if (!["default", "chrome", "edge", "firefox", "brave", "opera"].includes(browserId)) return invalid("UNSUPPORTED_BROWSER", "Browser is not supported.");
  return ok({ urls, delayMs, browserId });
}

function validateUnavailable(_params, _context, definition) {
  return invalid("ACTION_UNAVAILABLE", definition.unavailableReason || `${definition.label} is not available yet.`);
}

function delay(milliseconds) {
  return dependencies.delay(milliseconds);
}

async function executeWait(action) {
  await delay(Number(action.params.milliseconds));
}

async function executeAppOpen(action) {
  const child = dependencies.spawn(action.params.path.trim(), [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
  await waitForSpawn(child, "APP_OPEN_FAILED", "Application could not be opened.");
  child.unref();
}

async function executeAppClose(action) {
  const processName = normalizedProcessName(action.params.processName || action.params.appName || action.params.path);
  // Aktuell beenden wir einfach alle Prozesse mit diesem Dateinamen.
  await execFilePromise("taskkill.exe", ["/IM", processName, "/T"]);
}

async function executeWindowOperation(action, operation) {
  const validation = operation === "move-position" ? validateMovePosition(action.params || {}) : validateAppTarget(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const target = validation.normalizedParams;
  const args = ["window", "--operation", operation];
  addAppTargetArgs(args, target);
  if (operation === "move-position") args.push("--position", target.position);
  return runWindowsAutomation(args);
}

async function executeAppFocus(action) {
  return executeWindowOperation(action, "focus");
}

async function executeAppMinimize(action) {
  return executeWindowOperation(action, "minimize");
}

async function executeAppMaximize(action) {
  return executeWindowOperation(action, "maximize");
}

async function executeAppMoveToPosition(action) {
  return executeWindowOperation(action, "move-position");
}

async function executeWaitUntilAppOpens(action) {
  const validation = validateWaitUntilAppOpens(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const target = validation.normalizedParams;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= target.timeoutMs) {
    const args = ["window", "--operation", "exists"];
    addAppTargetArgs(args, target);
    try {
      await runWindowsAutomation(args);
      return { waitedMs: Date.now() - startedAt };
    } catch (error) {
      if (!["APP_NOT_RUNNING", "WINDOW_NOT_FOUND"].includes(error.code)) throw error;
    }
    await delay(target.pollIntervalMs);
  }
  throw structuredError("APP_WAIT_TIMEOUT", "App did not open before the timeout.");
}

async function checkAppRunning(params) {
  const validation = validateAppTarget(params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const args = ["window", "--operation", "exists"];
  addAppTargetArgs(args, validation.normalizedParams);
  try {
    await runWindowsAutomation(args);
    return true;
  } catch (error) {
    if (["APP_NOT_RUNNING", "WINDOW_NOT_FOUND"].includes(error.code)) return false;
    throw error;
  }
}

async function executeWebOpen(action) {
  const normalized = normalizeHttpUrl(action.params.url);
  if (!normalized.valid) throw structuredError(normalized.code, normalized.message);
  await dependencies.shell.openExternal(normalized.url);
}

async function executeGoogleSearch(action) {
  const query = String(action.params.query || "").trim();
  await dependencies.shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

async function executeYouTubeSearch(action) {
  const query = String(action.params.query || "").trim();
  await dependencies.shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
}

async function executeOpenClipboardUrl() {
  const text = dependencies.clipboard?.readText?.() || "";
  const normalized = normalizeHttpUrl(text);
  if (!normalized.valid) throw structuredError(normalized.code, normalized.message);
  await dependencies.shell.openExternal(normalized.url);
}

async function executeOpenInBrowser(action) {
  const validation = validateOpenInBrowser(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const browser = await resolveBrowserExecutable(validation.normalizedParams.browserId);
  if (!browser) throw structuredError("BROWSER_UNAVAILABLE", "Selected browser was not found.");
  const child = dependencies.spawn(browser.path, [validation.normalizedParams.url], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
  await waitForSpawn(child, "BROWSER_OPEN_FAILED", "Browser could not be opened.");
  child.unref();
  return { browserId: browser.id, url: validation.normalizedParams.url };
}

async function executeOpenMultiple(action) {
  const validation = validateOpenMultiple(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const { urls, browserId, delayMs } = validation.normalizedParams;
  let browser = null;
  if (browserId !== "default") {
    browser = await resolveBrowserExecutable(browserId);
    if (!browser) throw structuredError("BROWSER_UNAVAILABLE", "Selected browser was not found.");
  }
  for (const [index, url] of urls.entries()) {
    if (browser) {
      const child = dependencies.spawn(browser.path, [url], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
      await waitForSpawn(child, "BROWSER_OPEN_FAILED", "Browser could not be opened.");
      child.unref();
    } else {
      await dependencies.shell.openExternal(url);
    }
    if (index < urls.length - 1 && delayMs > 0) await delay(delayMs);
  }
  return { count: urls.length, browserId };
}

async function executeRunFlow(action, context = {}) {
  if (!flowRunner) throw structuredError("FLOW_RUNNER_UNAVAILABLE", "Run Flow is not available.");
  const nestedResult = await flowRunner(action.params.flowId, {
    ancestry: context.ancestry || [],
    depth: (context.depth || 0) + 1,
    parentExecutionId: context.executionId || null,
    // Der Kind-Flow nutzt dieselben Variablen wie der Eltern-Flow (siehe docs/flow-variables.md),
    // bekommt aber eine eigene Execution-ID.
    variables: context.execution?.variables,
  });
  if (!nestedResult.success) {
    throw structuredError(nestedFailureCode(nestedResult), nestedResult.message || "Nested Flow failed.", { nestedResult });
  }
  return { nestedResult };
}

async function executePcLock() {
  const child = dependencies.spawn("rundll32.exe", ["user32.dll,LockWorkStation"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  await waitForSpawn(child, "PC_LOCK_FAILED", "Windows lock could not be started.");
  child.unref();
}

async function executeShowDesktop() {
  await execFilePromise("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "(New-Object -ComObject Shell.Application).ToggleDesktop()",
  ]);
}

async function executeOpenExplorer() {
  const child = dependencies.spawn("explorer.exe", [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
  await waitForSpawn(child, "EXPLORER_OPEN_FAILED", "File Explorer could not be opened.");
  child.unref();
}

async function executeOpenTerminal() {
  try {
    const terminal = dependencies.spawn("wt.exe", [], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
    await waitForSpawn(terminal, "TERMINAL_OPEN_FAILED", "Windows Terminal could not be opened.");
    terminal.unref();
  } catch (_error) {
    const fallback = dependencies.spawn("cmd.exe", [], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
    await waitForSpawn(fallback, "TERMINAL_OPEN_FAILED", "Terminal could not be opened.");
    fallback.unref();
  }
}

async function executeVolumeUp() {
  await sendVolumeKey("0xAF", VOLUME_STEP_COUNT);
}

async function executeVolumeDown() {
  await sendVolumeKey("0xAE", VOLUME_STEP_COUNT);
}

async function executeMuteToggle() {
  await sendVolumeKey("0xAD", 1);
}

async function executeMediaPlayPause() {
  await sendVolumeKey("0xB3", 1);
}

async function executeMediaNext() {
  await sendVolumeKey("0xB0", 1);
}

async function executeMediaPrevious() {
  await sendVolumeKey("0xB1", 1);
}

async function executeScreenshot() {
  await sendKeyCombination("{PRTSC}");
}

async function executeOpenTaskManager() {
  const child = dependencies.spawn("taskmgr.exe", [], { detached: true, stdio: "ignore", windowsHide: false, shell: false });
  await waitForSpawn(child, "TASK_MANAGER_OPEN_FAILED", "Task Manager could not be opened.");
  child.unref();
}

async function executeOpenSettings() {
  await dependencies.shell.openExternal("ms-settings:");
}

async function executeCopy() {
  await sendKeyCombination("^c");
}

async function executePaste() {
  await sendKeyCombination("^v");
}

async function executeUndo() {
  await sendKeyCombination("^z");
}

async function executeRedo() {
  await sendKeyCombination("^y");
}

async function executeSelectAll() {
  await sendKeyCombination("^a");
}

async function executeTypeText(action) {
  await sendKeys(escapeSendKeysText(action.params.text || ""));
}

async function executePressKey(action) {
  await sendKeys(`{${normalizeKeyToken(action.params.key)}}`);
}

async function executePressKeyCombination(action) {
  const normalized = normalizeKeyCombination(action.params.combination);
  if (!normalized.valid) throw structuredError(normalized.code, normalized.message);
  await sendKeyCombination(toSendKeysCombination(normalized.tokens));
}

async function executeSetVolume(action) {
  const validation = validateVolumePercent(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  return runWindowsAutomation(["volume", "--percent", String(validation.normalizedParams.percent)]);
}

async function executePastePresetText(action) {
  const validation = validatePastePresetText(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const preset = getPresetStore().findPreset(validation.normalizedParams.presetId);
  if (!preset) throw structuredError("PRESET_NOT_FOUND", "Preset was not found.");
  try {
    dependencies.clipboard.writeText(preset.text);
  } catch (error) {
    throw structuredError("CLIPBOARD_FAILED", `Clipboard could not be updated. ${error.message}`.trim());
  }
  try {
    await sendKeyCombination("^v");
  } catch (error) {
    throw structuredError("PASTE_FAILED", error.message || "Paste failed.");
  }
  return { presetId: preset.id, presetName: preset.name };
}

async function executeKeyboardSequence(action) {
  const validation = validateKeyboardSequence(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  for (const step of validation.normalizedParams.steps) {
    if (step.type === "key") await sendKeys(`{${step.key}}`);
    if (step.type === "combo") await sendKeyCombination(toSendKeysCombination(step.tokens));
    if (step.type === "text") await sendKeys(escapeSendKeysText(step.text));
    if (step.delayAfterMs > 0) await delay(step.delayAfterMs);
  }
  return { stepCount: validation.normalizedParams.steps.length };
}

async function executeStopFlow() {
  return { stopFlow: true };
}

async function executeSetVariable(action, context = {}) {
  const validation = validateSetVariable(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  const { name, value } = validation.normalizedParams;
  const variables = requireVariableStore(context);
  variables.set(name, value);
  return { name, value };
}

async function executeIncrementVariable(action, context = {}) {
  const validation = validateVariableMutation(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  return mutateNumericVariable(context, validation.normalizedParams.name, validation.normalizedParams.amount);
}

async function executeDecrementVariable(action, context = {}) {
  const validation = validateVariableMutation(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  return mutateNumericVariable(context, validation.normalizedParams.name, -validation.normalizedParams.amount);
}

function mutateNumericVariable(context, name, delta) {
  const variables = requireVariableStore(context);
  if (!variables.has(name)) throw structuredError("VARIABLE_NOT_FOUND", `Variable "${name}" was not found.`, { variableName: name });
  const current = variables.get(name);
  if (typeof current !== "number") throw structuredError("VARIABLE_NOT_NUMBER", `Variable "${name}" is not a number.`, { variableName: name });
  const next = current + delta;
  if (!Number.isFinite(next)) throw structuredError("INVALID_INCREMENT", "Resulting value is not a finite number.", { variableName: name });
  variables.set(name, next);
  return { name, value: next };
}

function requireVariableStore(context) {
  const variables = context?.execution?.variables;
  if (!variables) throw structuredError("VARIABLES_UNAVAILABLE", "Flow variables are not available in this context.");
  return variables;
}

async function executeStopWithError(action) {
  const validation = validateStopWithError(action.params || {});
  if (!validation.valid) throw structuredError(validation.code, validation.message);
  throw structuredError("FLOW_STOPPED_WITH_ERROR", validation.normalizedParams.message);
}

function sendVolumeKey(virtualKey, times) {
  return execFilePromise("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SwipeyVolume { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }';",
      `$vk = [byte]${virtualKey};`,
      `for ($i = 0; $i -lt ${Number(times)}; $i++) {`,
      "[SwipeyVolume]::keybd_event($vk, 0, 0, [UIntPtr]::Zero);",
      "Start-Sleep -Milliseconds 35;",
      "[SwipeyVolume]::keybd_event($vk, 0, 2, [UIntPtr]::Zero);",
      "}",
    ].join(" "),
  ]);
}

function sendKeyCombination(sequence) {
  return sendKeys(sequence);
}

function sendKeys(sequence) {
  return execFilePromise("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(sequence)}')`,
  ]);
}

function runWindowsAutomation(args) {
  if (dependencies.windowsAutomation) return dependencies.windowsAutomation.run(args);
  return execJsonFilePromise(windowsAutomationHelper, args, "WINDOWS_AUTOMATION_UNAVAILABLE", "Windows automation helper is not available.");
}

function execJsonFilePromise(file, args, missingCode, missingMessage) {
  return new Promise((resolve, reject) => {
    dependencies.execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      let parsed = null;
      try {
        parsed = stdout ? JSON.parse(stdout) : null;
      } catch (_parseError) {
        parsed = null;
      }
      if (error || !parsed?.success) {
        const code = parsed?.code || (error?.code === "ENOENT" ? missingCode : "WINDOWS_AUTOMATION_FAILED");
        const message = parsed?.message || (stderr || stdout || error?.message || missingMessage || "Windows automation failed.").trim();
        reject(structuredError(code, message, parsed?.data || null));
        return;
      }
      resolve(parsed.data || {});
    });
  });
}

function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes(" ")) return invalid("INVALID_URL", "Enter a valid website URL.");
  // Mit {{variable}} im Text lässt sich die URL noch nicht prüfen. Die echte Prüfung
  // läuft nach dem Ersetzen noch einmal, direkt bevor die Aktion ausgeführt wird.
  if (hasTemplatePlaceholder(raw)) return { valid: true, url: raw };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    return invalid("INVALID_URL", "Enter a valid website URL.");
  }
  if (!allowedUrlProtocols.has(parsed.protocol)) return invalid("UNSUPPORTED_URL_SCHEME", "Only http and https URLs are supported.");
  if (!parsed.hostname || !parsed.hostname.includes(".")) return invalid("INVALID_URL", "Enter a complete website host, such as example.com.");
  return { valid: true, url: parsed.toString() };
}

function addAppTargetArgs(args, target) {
  if (target.processName) args.push("--process-name", target.processName);
  if (target.executablePath) args.push("--executable-path", target.executablePath);
  if (target.windowTitle) args.push("--window-title", target.windowTitle);
}

async function resolveBrowserExecutable(browserId) {
  if (dependencies.browserResolver) return dependencies.browserResolver(browserId);
  const candidates = browserCandidates(browserId);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return { id: browserId, path: candidate };
  }
  const appPath = await queryAppPath(browserId);
  if (appPath && fs.existsSync(appPath)) return { id: browserId, path: appPath };
  return null;
}

function browserCandidates(browserId) {
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LocalAppData].filter(Boolean);
  const map = {
    edge: ["Microsoft\\Edge\\Application\\msedge.exe"],
    chrome: ["Google\\Chrome\\Application\\chrome.exe"],
    firefox: ["Mozilla Firefox\\firefox.exe"],
    brave: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
    opera: ["Programs\\Opera\\opera.exe", "Opera\\launcher.exe"],
  };
  return (map[browserId] || []).flatMap((suffix) => programFiles.map((root) => path.join(root, suffix)));
}

async function queryAppPath(browserId) {
  const exeName = {
    edge: "msedge.exe",
    chrome: "chrome.exe",
    firefox: "firefox.exe",
    brave: "brave.exe",
    opera: "opera.exe",
  }[browserId];
  if (!exeName) return "";
  for (const hive of ["HKCU", "HKLM"]) {
    try {
      const { stdout } = await execFilePromise("reg.exe", ["query", `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, "/ve"]);
      const match = stdout.match(/REG_SZ\s+(.+)\s*$/m);
      if (match) return match[1].trim();
    } catch (_error) {
      // Kein Eintrag in diesem Hive, weiter zum nächsten.
    }
  }
  return "";
}

function waitForSpawn(child, code, message) {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(structuredError(code, `${message} ${error.message}`.trim())));
    child.once("spawn", resolve);
  });
}

function execFilePromise(file, args) {
  return new Promise((resolve, reject) => {
    dependencies.execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(
          structuredError(
            error.code === 128 ? "PROCESS_NOT_FOUND" : "PROCESS_COMMAND_FAILED",
            (stderr || stdout || error.message || "").trim() || "Process command failed."
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizeKeyCombination(value) {
  const tokens = String(value || "").split("+").map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) return invalid("INVALID_KEY_COMBINATION", "Use at least one modifier and one key.");
  const key = normalizeKeyToken(tokens.at(-1));
  if (!key) return invalid("UNSUPPORTED_KEY", "Unsupported key.");
  const modifiers = tokens.slice(0, -1).map(normalizeModifierToken);
  if (modifiers.some((modifier) => !modifier)) return invalid("UNSUPPORTED_KEY_MODIFIER", "Unsupported key modifier.");
  return { valid: true, combination: [...modifiers, key].join("+"), tokens: [...modifiers, key] };
}

function normalizeModifierToken(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["CTRL", "CONTROL"].includes(normalized)) return "CTRL";
  if (normalized === "ALT") return "ALT";
  if (normalized === "SHIFT") return "SHIFT";
  return "";
}

function normalizeKeyToken(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const aliases = {
    ENTER: "ENTER",
    RETURN: "ENTER",
    ESC: "ESC",
    ESCAPE: "ESC",
    TAB: "TAB",
    SPACE: " ",
    BACKSPACE: "BACKSPACE",
    DELETE: "DELETE",
    DEL: "DELETE",
    UP: "UP",
    DOWN: "DOWN",
    LEFT: "LEFT",
    RIGHT: "RIGHT",
    HOME: "HOME",
    END: "END",
    PAGEUP: "PGUP",
    PAGEDOWN: "PGDN",
    PRINTSCREEN: "PRTSC",
    PRTSC: "PRTSC",
  };
  if (/^[A-Z0-9]$/.test(normalized)) return normalized;
  if (/^F([1-9]|1[0-2])$/.test(normalized)) return normalized;
  return aliases[normalized] || "";
}

function toSendKeysCombination(tokens) {
  const modifiers = tokens.slice(0, -1).map((token) => ({ CTRL: "^", ALT: "%", SHIFT: "+" }[token])).join("");
  const key = tokens.at(-1);
  return `${modifiers}${key.length === 1 ? key.toLowerCase() : `{${key}}`}`;
}

function escapeSendKeysText(value) {
  return String(value).replace(/[+^%~()[\]{}]/g, "{$&}");
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replaceAll("'", "''");
}

function normalizedProcessName(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const base = path.basename(trimmed);
  return base.toLowerCase().endsWith(".exe") ? base : `${base}.exe`;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function structuredError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function nestedFailureCode(result) {
  const failedAction = Array.isArray(result.actions) ? result.actions.find((action) => action.success === false) : null;
  return failedAction?.error?.code || result.reason || "NESTED_FLOW_FAILED";
}

function getFlowStore() {
  return dependencies.flowStore || require("./flowStore.js");
}

function getPresetStore() {
  return dependencies.presetStore || require("./presetStore.js");
}

function flowLogicNode(type, category, label, unavailableReason) {
  return {
    type,
    category,
    label,
    executable: false,
    unavailableReason,
    validate: (params, context) => validateUnavailable(params, context, { label, unavailableReason }),
    execute: async () => {
      throw structuredError("ACTION_UNAVAILABLE", unavailableReason);
    },
  };
}

const actionRegistry = {
  "app.open": {
    type: "app.open",
    category: "app",
    label: "Open App",
    validate: validateAppOpen,
    execute: executeAppOpen,
  },
  "app.close": {
    type: "app.close",
    category: "app",
    label: "Close App",
    validate: validateAppClose,
    execute: executeAppClose,
  },
  "app.focus": {
    type: "app.focus",
    category: "app",
    label: "Focus App",
    validate: validateAppTarget,
    execute: executeAppFocus,
  },
  "app.minimize": {
    type: "app.minimize",
    category: "app",
    label: "Minimize App",
    validate: validateAppTarget,
    execute: executeAppMinimize,
  },
  "app.maximize": {
    type: "app.maximize",
    category: "app",
    label: "Maximize App",
    validate: validateAppTarget,
    execute: executeAppMaximize,
  },
  "app.moveToPosition": {
    type: "app.moveToPosition",
    category: "app",
    label: "Move App to Position",
    validate: validateMovePosition,
    execute: executeAppMoveToPosition,
  },
  "app.waitUntilOpens": {
    type: "app.waitUntilOpens",
    category: "app",
    label: "Wait Until App Opens",
    validate: validateWaitUntilAppOpens,
    execute: executeWaitUntilAppOpens,
  },
  "event.wait": {
    type: "event.wait",
    category: "event",
    label: "Wait",
    validate: validateWait,
    execute: executeWait,
  },
  "event.stopFlow": {
    type: "event.stopFlow",
    category: "event",
    label: "Stop Flow",
    validate: validateNoParams,
    execute: executeStopFlow,
  },
  "event.runFlow": {
    type: "event.runFlow",
    category: "event",
    label: "Run Another Flow",
    validate: validateRunFlow,
    execute: executeRunFlow,
  },
  "event.setVariable": {
    type: "event.setVariable",
    category: "event",
    label: "Set Variable",
    validate: validateSetVariable,
    execute: executeSetVariable,
  },
  "event.incrementVariable": {
    type: "event.incrementVariable",
    category: "event",
    label: "Increment Variable",
    validate: validateVariableMutation,
    execute: executeIncrementVariable,
  },
  "event.decrementVariable": {
    type: "event.decrementVariable",
    category: "event",
    label: "Decrement Variable",
    validate: validateVariableMutation,
    execute: executeDecrementVariable,
  },
  "event.stopWithError": {
    type: "event.stopWithError",
    category: "event",
    label: "Stop Flow with Error",
    templatableFields: ["message"],
    validate: validateStopWithError,
    execute: executeStopWithError,
  },
  "pc.lock": {
    type: "pc.lock",
    category: "pc",
    label: "Lock PC",
    validate: validateNoParams,
    execute: executePcLock,
  },
  "web.openWebsite": {
    type: "web.openWebsite",
    category: "web",
    label: "Open Website",
    templatableFields: ["url"],
    validate: validateWebOpen,
    execute: executeWebOpen,
  },
  "web.searchGoogle": {
    type: "web.searchGoogle",
    category: "web",
    label: "Search Web",
    templatableFields: ["query"],
    validate: validateSearchQuery,
    execute: executeGoogleSearch,
  },
  "web.searchYouTube": {
    type: "web.searchYouTube",
    category: "web",
    label: "YouTube Search",
    templatableFields: ["query"],
    validate: validateSearchQuery,
    execute: executeYouTubeSearch,
  },
  "web.openClipboardUrl": {
    type: "web.openClipboardUrl",
    category: "web",
    label: "Open URL from Clipboard",
    validate: validateNoParams,
    execute: executeOpenClipboardUrl,
  },
  "web.openInBrowser": {
    type: "web.openInBrowser",
    category: "web",
    label: "Open Website in Browser",
    validate: validateOpenInBrowser,
    execute: executeOpenInBrowser,
  },
  "web.openMultiple": {
    type: "web.openMultiple",
    category: "web",
    label: "Open Multiple Websites",
    validate: validateOpenMultiple,
    execute: executeOpenMultiple,
  },
  "pc.showDesktop": {
    type: "pc.showDesktop",
    category: "pc",
    label: "Show Desktop",
    validate: validateNoParams,
    execute: executeShowDesktop,
  },
  "pc.openExplorer": {
    type: "pc.openExplorer",
    category: "pc",
    label: "Open Explorer",
    validate: validateNoParams,
    execute: executeOpenExplorer,
  },
  "pc.openTerminal": {
    type: "pc.openTerminal",
    category: "pc",
    label: "Open Terminal",
    validate: validateNoParams,
    execute: executeOpenTerminal,
  },
  "pc.volumeUp": {
    type: "pc.volumeUp",
    category: "pc",
    label: "Volume Up",
    validate: validateNoParams,
    execute: executeVolumeUp,
  },
  "pc.volumeDown": {
    type: "pc.volumeDown",
    category: "pc",
    label: "Volume Down",
    validate: validateNoParams,
    execute: executeVolumeDown,
  },
  "pc.mute": {
    type: "pc.mute",
    category: "pc",
    label: "Mute / Unmute",
    validate: validateNoParams,
    execute: executeMuteToggle,
  },
  "pc.mediaPlayPause": {
    type: "pc.mediaPlayPause",
    category: "pc",
    label: "Play / Pause",
    validate: validateNoParams,
    execute: executeMediaPlayPause,
  },
  "pc.mediaNext": {
    type: "pc.mediaNext",
    category: "pc",
    label: "Next Track",
    validate: validateNoParams,
    execute: executeMediaNext,
  },
  "pc.mediaPrevious": {
    type: "pc.mediaPrevious",
    category: "pc",
    label: "Previous Track",
    validate: validateNoParams,
    execute: executeMediaPrevious,
  },
  "pc.screenshot": {
    type: "pc.screenshot",
    category: "pc",
    label: "Screenshot",
    validate: validateNoParams,
    execute: executeScreenshot,
  },
  "pc.openTaskManager": {
    type: "pc.openTaskManager",
    category: "pc",
    label: "Open Task Manager",
    validate: validateNoParams,
    execute: executeOpenTaskManager,
  },
  "pc.openSettings": {
    type: "pc.openSettings",
    category: "pc",
    label: "Open Settings",
    validate: validateNoParams,
    execute: executeOpenSettings,
  },
  "pc.copy": {
    type: "pc.copy",
    category: "pc",
    label: "Copy",
    validate: validateNoParams,
    execute: executeCopy,
  },
  "pc.paste": {
    type: "pc.paste",
    category: "pc",
    label: "Paste",
    validate: validateNoParams,
    execute: executePaste,
  },
  "pc.undo": {
    type: "pc.undo",
    category: "pc",
    label: "Undo",
    validate: validateNoParams,
    execute: executeUndo,
  },
  "pc.redo": {
    type: "pc.redo",
    category: "pc",
    label: "Redo",
    validate: validateNoParams,
    execute: executeRedo,
  },
  "pc.selectAll": {
    type: "pc.selectAll",
    category: "pc",
    label: "Select All",
    validate: validateNoParams,
    execute: executeSelectAll,
  },
  "pc.typeText": {
    type: "pc.typeText",
    category: "pc",
    label: "Type Text",
    templatableFields: ["text"],
    validate: validateTypeText,
    execute: executeTypeText,
  },
  "pc.pressKey": {
    type: "pc.pressKey",
    category: "pc",
    label: "Press Key",
    validate: validatePressKey,
    execute: executePressKey,
  },
  "pc.pressKeyCombination": {
    type: "pc.pressKeyCombination",
    category: "pc",
    label: "Press Key Combination",
    validate: validatePressKeyCombination,
    execute: executePressKeyCombination,
  },
  "pc.setVolume": {
    type: "pc.setVolume",
    category: "pc",
    label: "Set Volume",
    validate: validateVolumePercent,
    execute: executeSetVolume,
  },
  "pc.pastePresetText": {
    type: "pc.pastePresetText",
    category: "pc",
    label: "Paste Preset Text",
    validate: validatePastePresetText,
    execute: executePastePresetText,
  },
  "pc.keyboardSequence": {
    type: "pc.keyboardSequence",
    category: "pc",
    label: "Keyboard Sequence",
    validate: validateKeyboardSequence,
    execute: executeKeyboardSequence,
  },
  "app.ifRunning": flowLogicNode("app.ifRunning", "app", "If App Is Running", "If App Is Running is a Flow logic node and cannot run as a standalone action."),
  "app.ifNotRunning": flowLogicNode("app.ifNotRunning", "app", "If App Is Not Running", "If App Is Not Running is a Flow logic node and cannot run as a standalone action."),
  "event.condition": flowLogicNode("event.condition", "event", "If / Else", "If / Else is a Flow logic node and cannot run as a standalone action."),
  "event.loop": flowLogicNode("event.loop", "event", "Repeat", "Repeat is a Flow logic node and cannot run as a standalone action."),
  "event.randomChoice": flowLogicNode("event.randomChoice", "event", "Random Choice", "Random Choice is a Flow logic node and cannot run as a standalone action."),
  "event.delayBetweenActions": flowLogicNode("event.delayBetweenActions", "event", "Delay Between Actions", "Delay Between Actions is a Flow logic node and cannot run as a standalone action."),
  "event.runAfterDelay": flowLogicNode("event.runAfterDelay", "event", "Run After Delay", "Run After Delay is a Flow logic node and cannot run as a standalone action."),
  "event.waitUntil": flowLogicNode("event.waitUntil", "event", "Wait Until", "Wait Until is a Flow logic node and cannot run as a standalone action."),
  "event.try": flowLogicNode("event.try", "event", "Try / On Error", "Try / On Error is a Flow logic node and cannot run as a standalone action."),
  "event.continueOnError": flowLogicNode("event.continueOnError", "event", "Continue On Error", "Continue On Error is a Flow logic node and cannot run as a standalone action."),
};

function getActionDefinition(type) {
  return actionRegistry[type] || null;
}

module.exports = {
  MAX_WAIT_MS,
  VOLUME_STEP_COUNT,
  actionRegistry,
  checkAppRunning,
  configureActionRegistry,
  getActionDefinition,
  normalizeHttpUrl,
};
