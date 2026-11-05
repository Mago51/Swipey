const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { canonicalizeInput } = require("./keyCanonicalizer.js");
const { validateBinding } = require("./keyValidator.js");

const STORAGE_VERSION = 1;
const STORAGE_FILE = "keyBindings.json";

let storagePath = "";
let bindings = [];

async function initializeKeyStore(userDataPath) {
  storagePath = path.join(userDataPath, STORAGE_FILE);
  await fs.mkdir(userDataPath, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(storagePath, "utf8"));
    bindings = loadStorage(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      bindings = [];
      await writeStorage();
      return;
    }
    if (error instanceof SyntaxError) {
      await preserveCorruptFile();
      console.warn(`[keys] Corrupt key storage moved aside. Starting with no Key bindings. ${error.message}`);
      bindings = [];
      return;
    }
    console.warn(`[keys] Failed to load key storage. Starting with no Key bindings. ${error.message}`);
    bindings = [];
  }
}

function loadStorage(parsed) {
  if (!parsed || typeof parsed !== "object" || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.bindings)) {
    console.warn("[keys] Unsupported or malformed key storage format. Starting with no Key bindings.");
    return [];
  }
  return parsed.bindings.map(normalizeBinding).filter(Boolean);
}

function getBindings() {
  return bindings.map(cloneBinding);
}

async function createBinding(binding, context = {}) {
  const now = nowIso();
  const normalized = normalizeBinding({
    ...binding,
    id: binding?.id || createId("keybinding"),
    type: "key",
    enabled: typeof binding?.enabled === "boolean" ? binding.enabled : true,
    createdAt: binding?.createdAt || now,
    updatedAt: now,
  });
  assertValidBinding(normalized, context);
  bindings.unshift(normalized);
  await writeStorage();
  return cloneBinding(normalized);
}

async function updateBinding(binding, context = {}) {
  const index = bindings.findIndex((item) => item.id === binding?.id);
  if (index < 0) throw structuredError("KEY_BINDING_NOT_FOUND", "Key binding was not found.");
  const existing = bindings[index];
  const normalized = normalizeBinding({ ...binding, createdAt: existing.createdAt, updatedAt: nowIso() });
  assertValidBinding(normalized, context);
  bindings.splice(index, 1, normalized);
  await writeStorage();
  return cloneBinding(normalized);
}

async function deleteBinding(id) {
  const index = bindings.findIndex((item) => item.id === id);
  if (index >= 0) {
    bindings.splice(index, 1);
    await writeStorage();
  }
  return { success: true };
}

async function deleteBindingsForFlow(flowId) {
  const removed = bindings.filter((item) => item.flowId === flowId);
  if (removed.length > 0) {
    bindings = bindings.filter((item) => item.flowId !== flowId);
    await writeStorage();
  }
  return removed.map(cloneBinding);
}

async function setEnabled(id, enabled, context = {}) {
  const binding = bindings.find((item) => item.id === id);
  if (!binding) throw structuredError("KEY_BINDING_NOT_FOUND", "Key binding was not found.");
  const updated = normalizeBinding({ ...binding, enabled: !!enabled, updatedAt: nowIso() });
  assertValidBinding(updated, context);
  Object.assign(binding, updated);
  await writeStorage();
  return cloneBinding(binding);
}

function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  const canonical = canonicalizeInput(binding.input, binding.modifiers);
  const now = nowIso();
  return {
    id: String(binding.id || createId("keybinding")),
    type: "key",
    flowId: String(binding.flowId || ""),
    enabled: typeof binding.enabled === "boolean" ? binding.enabled : true,
    input: canonical.valid ? canonical.input : { ...(binding.input || {}) },
    modifiers: canonical.valid ? canonical.modifiers : normalizeModifiers(binding.modifiers),
    signature: canonical.valid ? canonical.signature : String(binding.signature || ""),
    accelerator: canonical.valid ? canonical.accelerator : String(binding.accelerator || ""),
    displayName: canonical.valid ? canonical.displayName : String(binding.displayName || ""),
    commonTyping: canonical.valid ? canonical.commonTyping : false,
    status: binding.status || "unknown",
    statusReason: binding.statusReason || "",
    createdAt: typeof binding.createdAt === "string" ? binding.createdAt : now,
    updatedAt: typeof binding.updatedAt === "string" ? binding.updatedAt : now,
  };
}

function assertValidBinding(binding, context) {
  const validation = validateBinding(binding, { ...context, bindings });
  if (!validation.valid) {
    const first = validation.errors[0];
    throw structuredError(first.code, first.message, { errors: validation.errors });
  }
}

async function writeStorage() {
  const payload = `${JSON.stringify({ version: STORAGE_VERSION, bindings }, null, 2)}\n`;
  const tmpPath = `${storagePath}.tmp`;
  // Wie bei den Flows: temporäre Datei schreiben, dann umbenennen.
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, storagePath);
}

async function preserveCorruptFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.rename(storagePath, storagePath.replace(/\.json$/, `.corrupt-${stamp}.json`));
}

function cloneBinding(binding) {
  return {
    ...binding,
    input: { ...binding.input },
    modifiers: {
      ...binding.modifiers,
      left: { ...(binding.modifiers?.left || {}) },
      right: { ...(binding.modifiers?.right || {}) },
    },
  };
}

function normalizeModifiers(modifiers = {}) {
  return {
    ctrl: !!modifiers.ctrl,
    alt: !!modifiers.alt,
    shift: !!modifiers.shift,
    win: !!modifiers.win,
    left: modifiers.left || {},
    right: modifiers.right || {},
  };
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
  initializeKeyStore,
  getBindings,
  createBinding,
  updateBinding,
  deleteBinding,
  deleteBindingsForFlow,
  setEnabled,
};
