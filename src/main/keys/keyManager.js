const { globalShortcut } = require("electron");
const keyStore = require("./keyStore.js");
const { validateBinding } = require("./keyValidator.js");
const windowsKeyboardProvider = require("./windowsKeyboardProvider.js");

let flowStore = null;
let flowExecutor = null;
let notifyRenderer = () => {};
const registered = new Map();
const nativeRegistered = new Map();
const registrationErrors = new Map();
const nativeBindingsByCode = new Map();

function configureKeyManager(options) {
  flowStore = options.flowStore;
  flowExecutor = options.flowExecutor;
  notifyRenderer = options.notifyRenderer || notifyRenderer;
}

async function initializeKeyManager(userDataPath) {
  await keyStore.initializeKeyStore(userDataPath);
  refreshRegistrations();
}

function listBindings() {
  return keyStore.getBindings().map(withStatus);
}

async function createBinding(binding) {
  const saved = await keyStore.createBinding(binding, contextFor(binding));
  refreshRegistrations();
  return withStatus(saved);
}

async function updateBinding(binding) {
  const saved = await keyStore.updateBinding(binding, contextFor(binding));
  refreshRegistrations();
  return withStatus(saved);
}

async function deleteBinding(id) {
  unregisterBinding(id);
  await keyStore.deleteBinding(id);
  refreshRegistrations();
  return { success: true };
}

async function deleteBindingsForFlow(flowId) {
  const removed = await keyStore.deleteBindingsForFlow(flowId);
  removed.forEach((binding) => unregisterBinding(binding.id));
  refreshRegistrations();
  return removed;
}

async function setEnabled(id, enabled) {
  const existing = keyStore.getBindings().find((binding) => binding.id === id);
  const saved = await keyStore.setEnabled(id, enabled, contextFor({ ...existing, enabled }));
  refreshRegistrations();
  return withStatus(saved);
}

// Bei jeder Änderung registrieren wir alles komplett neu. Das ist einfacher,
// als einzelne Shortcuts nachzuziehen.
function refreshRegistrations() {
  for (const id of [...registered.keys()]) unregisterBinding(id);
  nativeRegistered.clear();
  nativeBindingsByCode.clear();
  windowsKeyboardProvider.stop();
  registrationErrors.clear();

  const nativeFallbackCodes = new Set();
  for (const binding of keyStore.getBindings()) {
    if (!binding.enabled) continue;
    const status = registrationStatus(binding);
    if (status.status !== "ready") continue;
    if (shouldUseNativeFallback(binding)) {
      probeElectronRegistrationForDebug(binding.accelerator);
      nativeRegistered.set(binding.id, binding.input.code);
      nativeBindingsByCode.set(binding.input.code, binding);
      nativeFallbackCodes.add(binding.input.code);
      continue;
    }
    const ok = globalShortcut.register(binding.accelerator, () => {
      debugLog(`callback fired ${binding.accelerator}`);
      handleShortcut(binding).catch((error) => console.error("[keys] Shortcut execution failed", error));
    });
    debugLog(`registered ${binding.accelerator} = ${ok}; isRegistered = ${globalShortcut.isRegistered(binding.accelerator)}`);
    if (ok) registered.set(binding.id, binding.accelerator);
    else {
      const message = `Electron could not register ${binding.displayName} (${binding.accelerator}).`;
      registrationErrors.set(binding.id, message);
      console.warn(`[keys] Registration failed: ${binding.displayName} (${binding.accelerator})`);
    }
  }

  if (nativeFallbackCodes.size > 0) {
    windowsKeyboardProvider.start({
      codes: [...nativeFallbackCodes],
      onEvent: handleNativeKeyboardEvent,
      onExit: (exit) => {
        if (nativeRegistered.size > 0) console.warn("[keys] Native keyboard helper exited", exit);
      },
    });
  }
}

async function handleShortcut(binding) {
  console.log(`[keys] Triggered ${binding.displayName} -> ${binding.flowId}`);
  const result = await flowExecutor.runFlow(binding.flowId);
  notifyRenderer("key-flow-result", { bindingId: binding.id, binding: withStatus(binding), result });
  if (!result.success) console.warn("[keys] Triggered Flow failed", result);
}

function handleNativeKeyboardEvent(event) {
  if (event.type === "keyboardStarted") {
    debugLog(`native fallback started for ${(event.codes || []).join(", ")}`);
    return;
  }
  if (event.type === "error") {
    console.warn("[keys] Native keyboard helper error", event);
    return;
  }
  if (event.type !== "keyDown") return;

  const binding = nativeBindingsByCode.get(event.code);
  if (!binding) return;
  debugLog(`native callback fired ${binding.accelerator} scanCode=${event.scanCode} vkCode=${event.vkCode}`);
  handleShortcut(binding).catch((error) => console.error("[keys] Native shortcut execution failed", error));
}

function unregisterBinding(id) {
  const accelerator = registered.get(id);
  if (accelerator) {
    globalShortcut.unregister(accelerator);
    registered.delete(id);
  }
  nativeRegistered.delete(id);
}

function withStatus(binding) {
  return { ...binding, ...registrationStatus(binding) };
}

function registrationStatus(binding) {
  if (!binding.enabled) return { status: "disabled", statusReason: "" };
  const validation = validateBinding(binding, contextFor(binding));
  if (!validation.valid) {
    const first = validation.errors[0];
    return { status: statusForError(first.code), statusReason: first.message };
  }
  if (!binding.accelerator) return { status: "unsupported", statusReason: "No accelerator can be created for this key." };
  if (registered.get(binding.id) === binding.accelerator) return { status: "registered", statusReason: "" };
  if (nativeRegistered.has(binding.id)) return { status: "registered", statusReason: "" };
  if (registrationErrors.has(binding.id)) return { status: "unsupported", statusReason: registrationErrors.get(binding.id) };
  return { status: "ready", statusReason: "" };
}

// Reine Numpad-Tasten ohne Modifier laufen über den nativen Keyboard-Helper
// und nicht über globalShortcut von Electron.
function shouldUseNativeFallback(binding) {
  return (
    windowsKeyboardProvider.isSupported() &&
    /^Numpad\d$/.test(binding.input?.code || "") &&
    binding.input?.location === "numpad" &&
    !binding.modifiers?.ctrl &&
    !binding.modifiers?.alt &&
    !binding.modifiers?.shift &&
    !binding.modifiers?.win
  );
}

function statusForError(code) {
  if (code === "KEY_BINDING_CONFLICT") return "conflict";
  if (code === "MISSING_FLOW") return "missing-flow";
  if (code === "RESERVED_WINDOWS_SHORTCUT" || code === "EMERGENCY_HOTKEY_RESERVED" || code === "UNSUPPORTED_KEY") return "unsupported";
  return "error";
}

function contextFor(binding) {
  return {
    bindings: keyStore.getBindings(),
    flowExists: !!flowStore?.findFlow?.(binding.flowId),
  };
}

function shutdownKeyManager() {
  windowsKeyboardProvider.stop();
}

function debugLog(message) {
  if (process.env.SWIPEY_KEY_DEBUG === "1") console.log(`[key-debug] ${message}`);
}

function probeElectronRegistrationForDebug(accelerator) {
  if (process.env.SWIPEY_KEY_DEBUG !== "1") return;
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => {
      debugLog(`electron probe callback fired ${accelerator}`);
    });
    debugLog(`electron probe registered ${accelerator} = ${ok}; isRegistered = ${globalShortcut.isRegistered(accelerator)}`);
  } catch (error) {
    debugLog(`electron probe failed ${accelerator}: ${error.message}`);
  } finally {
    if (ok) globalShortcut.unregister(accelerator);
  }
}

module.exports = {
  configureKeyManager,
  initializeKeyManager,
  listBindings,
  createBinding,
  updateBinding,
  deleteBinding,
  deleteBindingsForFlow,
  setEnabled,
  refreshRegistrations,
  shutdownKeyManager,
};
