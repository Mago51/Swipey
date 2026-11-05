const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
  createNodeId,
  legacyActionToNode,
  nodeToLegacyAction,
  normalizeNodes,
} = require("./flowNodes.js");
const { validateFlow } = require("./flowValidator.js");

const STORAGE_VERSION = 1;
const STORAGE_FILE = "flows.json";

let storagePath = "";
let flows = [];

// Die alten IDs brauchen wir noch, damit bereits gespeicherte Flows
// auch nach einem Update weiterhin funktionieren.
const legacyTypeMap = {
  "open-app": "app.open",
  "close-app": "app.close",
  "focus-app": "app.focus",
  "minimize-app": "app.minimize",
  "maximize-app": "app.maximize",
  "move-app-to-position": "app.moveToPosition",
  "wait-until-app-opens": "app.waitUntilOpens",
  "if-app-running": "app.ifRunning",
  "if-app-not-running": "app.ifNotRunning",
  wait: "event.wait",
  "run-flow": "event.runFlow",
  "stop-flow": "event.stopFlow",
  repeat: "event.loop",
  "if-else": "event.condition",
  "random-choice": "event.randomChoice",
  "delay-between-actions": "event.delayBetweenActions",
  "run-after-delay": "event.runAfterDelay",
  "wait-until": "event.waitUntil",
  "set-variable": "event.setVariable",
  "increment-variable": "event.incrementVariable",
  "decrement-variable": "event.decrementVariable",
  try: "event.try",
  "continue-on-error": "event.continueOnError",
  "stop-with-error": "event.stopWithError",
  "lock-pc": "pc.lock",
  "show-desktop": "pc.showDesktop",
  "open-explorer": "pc.openExplorer",
  "open-terminal": "pc.openTerminal",
  "open-task-manager": "pc.openTaskManager",
  "open-settings": "pc.openSettings",
  "volume-up": "pc.volumeUp",
  "volume-down": "pc.volumeDown",
  mute: "pc.mute",
  "play-pause": "pc.mediaPlayPause",
  "next-track": "pc.mediaNext",
  "previous-track": "pc.mediaPrevious",
  screenshot: "pc.screenshot",
  copy: "pc.copy",
  paste: "pc.paste",
  undo: "pc.undo",
  redo: "pc.redo",
  "select-all": "pc.selectAll",
  "type-text": "pc.typeText",
  "press-key": "pc.pressKey",
  "press-key-combination": "pc.pressKeyCombination",
  "set-volume": "pc.setVolume",
  "paste-preset-text": "pc.pastePresetText",
  "keyboard-sequence": "pc.keyboardSequence",
  "open-website": "web.openWebsite",
  "search-google": "web.searchGoogle",
  "search-web": "web.searchGoogle",
  "youtube-search": "web.searchYouTube",
  "open-clipboard-url": "web.openClipboardUrl",
  "open-in-browser": "web.openInBrowser",
  "open-multiple-websites": "web.openMultiple",
};

async function initializeFlowStore(userDataPath) {
  storagePath = path.join(userDataPath, STORAGE_FILE);
  await fs.mkdir(userDataPath, { recursive: true });

  try {
    const raw = await fs.readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw);
    // Unbekanntes Format, etwa von einer neueren Version: nicht überschreiben,
    // sondern zur Seite legen.
    if (!isSupportedStorage(parsed)) {
      await preserveCorruptFile();
      console.warn("[flows] Unsupported storage format moved aside. Starting with empty Flow list.");
      flows = [];
      return;
    }
    flows = parsed.flows.map(normalizeFlow).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      flows = seedFlows();
      try {
        await writeStorage();
      } catch (writeError) {
        console.warn(`[flows] Could not write initial seed storage: ${writeError.message}`);
      }
      return;
    }

    if (error instanceof SyntaxError) {
      await preserveCorruptFile();
      console.warn(`[flows] Corrupt storage moved aside. Starting with empty Flow list. ${error.message}`);
      flows = [];
      return;
    }

    console.warn(`[flows] Failed to load storage. Starting with empty Flow list. ${error.message}`);
    flows = [];
  }
}

function isSupportedStorage(parsed) {
  return !!parsed && typeof parsed === "object" && parsed.version === STORAGE_VERSION && Array.isArray(parsed.flows);
}

function getFlows() {
  return flows.map(cloneFlow);
}

async function createFlow(flow) {
  const now = nowIso();
  const normalized = normalizeFlow({
    ...flow,
    id: flow?.id || createId("flow"),
    enabled: typeof flow?.enabled === "boolean" ? flow.enabled : true,
    createdAt: flow?.createdAt || now,
    updatedAt: now,
  });
  assertValidFlow(normalized);
  flows.unshift(normalized);
  await writeStorage();
  return cloneFlow(normalized);
}

async function updateFlow(flow) {
  const index = flows.findIndex((item) => item.id === flow?.id);
  if (index < 0) throw structuredError("FLOW_NOT_FOUND", "Flow was not found.");
  const existing = flows[index];
  const normalized = normalizeFlow({
    ...flow,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  });
  assertValidFlow(normalized);
  flows.splice(index, 1, normalized);
  await writeStorage();
  return cloneFlow(normalized);
}

async function saveFlow(flow) {
  if (flow?.id && flows.some((item) => item.id === flow.id)) return updateFlow(flow);
  return createFlow(flow);
}

async function deleteFlow(flowId) {
  const index = flows.findIndex((item) => item.id === flowId);
  if (index >= 0) {
    flows.splice(index, 1);
    await writeStorage();
  }
  return { success: true };
}

async function duplicateFlow(flowId) {
  const flow = flows.find((item) => item.id === flowId);
  if (!flow) throw structuredError("FLOW_NOT_FOUND", "Flow was not found.");
  const now = nowIso();
  const copy = {
    ...cloneFlow(flow),
    id: createId("flow"),
    name: `${flow.name} Copy`,
    createdAt: now,
    updatedAt: now,
  };
  copy.nodes = cloneNodesWithNewIds(flow.nodes);
  copy.actions = topLevelActions(copy.nodes);
  assertValidFlow(copy);
  flows.unshift(copy);
  await writeStorage();
  return cloneFlow(copy);
}

async function setFlowEnabled(flowId, enabled) {
  const flow = flows.find((item) => item.id === flowId);
  if (!flow) throw structuredError("FLOW_NOT_FOUND", "Flow was not found.");
  flow.enabled = !!enabled;
  flow.updatedAt = nowIso();
  await writeStorage();
  return cloneFlow(flow);
}

function findFlow(flowId) {
  const flow = flows.find((item) => item.id === flowId);
  return flow ? cloneFlow(flow) : null;
}

function assertValidFlow(flow) {
  // Beim Speichern prüfen wir Parameter und unbekannte Aktionen bewusst nicht streng.
  // So gehen Flows mit entfernten Aktionen nicht verloren. Beim Ausführen wird alles geprüft.
  const validation = validateFlow(flow, { validateParams: false, allowUnknown: true });
  if (!validation.valid) {
    const first = validation.errors[0];
    throw structuredError(first.code || "FLOW_INVALID", first.message || "Flow is invalid.", { errors: validation.errors });
  }
}

async function writeStorage() {
  const payload = `${JSON.stringify({ version: STORAGE_VERSION, flows }, null, 2)}\n`;
  const tmpPath = `${storagePath}.tmp`;
  // Erst in eine temporäre Datei schreiben und dann umbenennen,
  // sonst bleibt bei einem Absturz eine halbe flows.json übrig.
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, storagePath);
}

// Eine Datei, die wir nicht lesen können, behalten wir mit Zeitstempel im Namen,
// statt sie beim nächsten Speichern zu überschreiben.
async function preserveCorruptFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const corruptPath = storagePath.replace(/\.json$/, `.corrupt-${stamp}.json`);
  try {
    await fs.rename(storagePath, corruptPath);
  } catch (error) {
    console.warn(`[flows] Could not preserve corrupt storage file: ${error.message}`);
  }
}

function normalizeFlow(flow) {
  if (!flow || typeof flow !== "object") return null;
  const now = nowIso();
  return {
    id: String(flow.id || createId("flow")),
    name: String(flow.name || "Untitled Flow"),
    enabled: typeof flow.enabled === "boolean" ? flow.enabled : true,
    nodes: normalizeFlowNodes(flow),
    createdAt: typeof flow.createdAt === "string" ? flow.createdAt : now,
    updatedAt: typeof flow.updatedAt === "string" ? flow.updatedAt : now,
  };
}

function normalizeFlowNodes(flow) {
  const rawNodes = Array.isArray(flow.nodes)
    ? flow.nodes
    : normalizeActions(flow.actions || flow.steps || []).map(legacyActionToNode);
  return normalizeNodes(rawNodes, normalizeParams);
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => {
    const legacyType = action.commandId || action.type;
    const type = legacyTypeMap[legacyType] || legacyType;
    return {
      id: String(action.id || createId("action")),
      type,
      params: normalizeParams(type, action.params || action.config || {}),
    };
  });
}

function normalizeParams(type, params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  if (type === "event.wait") {
    return { milliseconds: Number(params.milliseconds ?? params.durationMs ?? 1000) };
  }
  if (type === "app.open") {
    return { path: String(params.path || params.appName || "notepad.exe") };
  }
  if (type === "app.close") {
    return { processName: String(params.processName || params.appName || params.path || "notepad.exe") };
  }
  if (["app.focus", "app.minimize", "app.maximize"].includes(type)) {
    return {
      processName: String(params.processName || params.appName || params.path || "notepad.exe"),
      executablePath: String(params.executablePath || params.path || ""),
      windowTitle: String(params.windowTitle || ""),
      displayName: String(params.displayName || params.appName || params.processName || "Notepad"),
    };
  }
  if (type === "app.moveToPosition") {
    return {
      processName: String(params.processName || params.appName || params.path || "notepad.exe"),
      executablePath: String(params.executablePath || params.path || ""),
      windowTitle: String(params.windowTitle || ""),
      displayName: String(params.displayName || params.appName || params.processName || "Notepad"),
      position: String(params.position || "left-half"),
    };
  }
  if (type === "app.waitUntilOpens") {
    return {
      processName: String(params.processName || params.appName || params.path || "notepad.exe"),
      executablePath: String(params.executablePath || params.path || ""),
      displayName: String(params.displayName || params.appName || params.processName || "Notepad"),
      timeoutMs: Number(params.timeoutMs ?? 30000),
      pollIntervalMs: Number(params.pollIntervalMs ?? 500),
    };
  }
  if (type === "web.openWebsite") {
    return { url: String(params.url || params.href || "https://example.com") };
  }
  if (type === "web.searchGoogle" || type === "web.searchYouTube") {
    return { query: String(params.query || params.text || "") };
  }
  if (type === "web.openInBrowser") {
    return { url: String(params.url || params.href || "https://example.com"), browserId: String(params.browserId || params.browser || "edge") };
  }
  if (type === "web.openMultiple") {
    const urls = Array.isArray(params.urls) ? params.urls.map(String) : String(params.urls || "https://example.com").split(/\r?\n/).filter(Boolean);
    return { urls, browserId: String(params.browserId || params.browser || "default"), delayMs: Number(params.delayMs ?? 250) };
  }
  if (type === "pc.typeText") {
    return { text: String(params.text || "") };
  }
  if (type === "pc.pressKey") {
    return { key: String(params.key || "ENTER") };
  }
  if (type === "pc.pressKeyCombination") {
    return { combination: String(params.combination || params.keys || "CTRL+SHIFT+S") };
  }
  if (type === "pc.setVolume") {
    return { percent: Number(params.percent ?? 50) };
  }
  if (type === "pc.pastePresetText") {
    return { presetId: String(params.presetId || ""), presetName: String(params.presetName || "") };
  }
  if (type === "pc.keyboardSequence") {
    return { steps: Array.isArray(params.steps) ? params.steps : [] };
  }
  if (type === "event.setVariable") {
    return { name: String(params.name || ""), valueType: String(params.valueType || "string"), value: params.value ?? "" };
  }
  if (type === "event.incrementVariable" || type === "event.decrementVariable") {
    return { name: String(params.name || ""), amount: Number(params.amount ?? 1) };
  }
  if (type === "event.stopWithError") {
    return { message: String(params.message || "") };
  }
  return { ...params };
}

function cloneFlow(flow) {
  const nodes = cloneNodes(flow.nodes || []);
  return {
    ...flow,
    nodes,
    actions: topLevelActions(nodes),
  };
}

function topLevelActions(nodes) {
  return (nodes || []).map(nodeToLegacyAction).filter(Boolean);
}

function cloneNodes(nodes) {
  return (nodes || []).map((node) => {
    if (node.type === "action") return { id: node.id, type: "action", actionId: node.actionId, config: { ...(node.config || {}) } };
    if (node.type === "repeat") return { id: node.id, type: "repeat", count: node.count, children: cloneNodes(node.children) };
    if (node.type === "if") return { id: node.id, type: "if", condition: cloneCondition(node.condition), then: cloneNodes(node.then), else: cloneNodes(node.else) };
    if (node.type === "wait-until") return { id: node.id, type: "wait-until", condition: cloneCondition(node.condition), timeoutMs: node.timeoutMs, pollIntervalMs: node.pollIntervalMs };
    if (node.type === "delay-between-actions") return { id: node.id, type: "delay-between-actions", delayMs: node.delayMs, children: cloneNodes(node.children) };
    if (node.type === "run-after-delay") return { id: node.id, type: "run-after-delay", delayMs: node.delayMs, children: cloneNodes(node.children) };
    if (node.type === "random-choice") return { id: node.id, type: "random-choice", branches: (node.branches || []).map(cloneNodes) };
    if (node.type === "try") return { id: node.id, type: "try", children: cloneNodes(node.children), onError: cloneNodes(node.onError) };
    if (node.type === "continue-on-error") return { id: node.id, type: "continue-on-error", children: cloneNodes(node.children) };
    return { ...node };
  });
}

function cloneNodesWithNewIds(nodes) {
  return cloneNodes(nodes).map((node) => cloneNodeWithNewIds(node));
}

function cloneNodeWithNewIds(node) {
  if (node.type === "action") return { ...node, id: createNodeId("node"), config: { ...(node.config || {}) } };
  if (node.type === "repeat") return { ...node, id: createNodeId("node"), children: cloneNodesWithNewIds(node.children) };
  if (node.type === "if") return { ...node, id: createNodeId("node"), condition: cloneCondition(node.condition), then: cloneNodesWithNewIds(node.then), else: cloneNodesWithNewIds(node.else) };
  if (node.type === "wait-until") return { ...node, id: createNodeId("node"), condition: cloneCondition(node.condition) };
  if (node.type === "delay-between-actions" || node.type === "run-after-delay") return { ...node, id: createNodeId("node"), children: cloneNodesWithNewIds(node.children) };
  if (node.type === "random-choice") return { ...node, id: createNodeId("node"), branches: (node.branches || []).map(cloneNodesWithNewIds) };
  if (node.type === "try") return { ...node, id: createNodeId("node"), children: cloneNodesWithNewIds(node.children), onError: cloneNodesWithNewIds(node.onError) };
  if (node.type === "continue-on-error") return { ...node, id: createNodeId("node"), children: cloneNodesWithNewIds(node.children) };
  return { ...node, id: createNodeId("node") };
}

function cloneCondition(condition) {
  const type = condition?.type || "";
  if (type.startsWith("variable.")) {
    return {
      type,
      variableName: condition.variableName || "",
      compareType: condition.compareType || "string",
      compareValue: condition.compareValue ?? "",
    };
  }
  if (type.startsWith("execution.")) return { type };
  return {
    type,
    target: { ...(condition?.target || {}) },
  };
}

function seedFlows() {
  const now = nowIso();
  return [
    {
      id: "flow-work-setup",
      name: "Work Setup",
      enabled: true,
      actions: [
        { id: "action-1", type: "app.open", params: { path: "notepad.exe" } },
        { id: "action-2", type: "event.wait", params: { milliseconds: 1000 } },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "flow-lock-pc",
      name: "Lock PC",
      enabled: true,
      actions: [{ id: "action-3", type: "pc.lock", params: {} }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "flow-browser-reset",
      name: "Browser Reset",
      enabled: false,
      actions: [{ id: "action-4", type: "event.wait", params: { milliseconds: 250 } }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "flow-fast-switch",
      name: "Fast Switch",
      enabled: true,
      actions: [{ id: "action-5", type: "app.close", params: { processName: "notepad.exe" } }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "flow-morning-setup",
      name: "Morning Setup",
      enabled: true,
      actions: [
        { id: "action-6", type: "event.wait", params: { milliseconds: 500 } },
        { id: "action-7", type: "app.open", params: { path: "notepad.exe" } },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function structuredError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

module.exports = {
  STORAGE_FILE,
  STORAGE_VERSION,
  initializeFlowStore,
  getFlows,
  saveFlow,
  createFlow,
  updateFlow,
  deleteFlow,
  duplicateFlow,
  setFlowEnabled,
  findFlow,
};
