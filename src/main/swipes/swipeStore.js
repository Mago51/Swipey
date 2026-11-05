const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { displaySwipe, normalizeDirection, signatureForSwipe, validateBinding } = require("./swipeValidator.js");

const STORAGE_VERSION = 1;
const STORAGE_FILE = "swipeBindings.json";

let storagePath = "";
let bindings = [];

async function initializeSwipeStore(userDataPath) {
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
      console.warn(`[swipes] Corrupt swipe storage moved aside. Starting with no Swipe bindings. ${error.message}`);
      bindings = [];
      return;
    }
    console.warn(`[swipes] Failed to load swipe storage. Starting with no Swipe bindings. ${error.message}`);
    bindings = [];
  }
}

function loadStorage(parsed) {
  if (!parsed || typeof parsed !== "object" || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.bindings)) {
    console.warn("[swipes] Unsupported or malformed swipe storage format. Starting with no Swipe bindings.");
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
    id: binding?.id || createId("swipebinding"),
    type: "swipe",
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
  if (index < 0) throw structuredError("SWIPE_BINDING_NOT_FOUND", "Swipe binding was not found.");
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
  if (!binding) throw structuredError("SWIPE_BINDING_NOT_FOUND", "Swipe binding was not found.");
  const updated = normalizeBinding({ ...binding, enabled: !!enabled, updatedAt: nowIso() });
  if (updated.enabled || validateBinding(updated, context).valid) assertValidBinding(updated, context);
  Object.assign(binding, updated);
  await writeStorage();
  return cloneBinding(binding);
}

function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  const now = nowIso();
  const normalized = {
    id: String(binding.id || createId("swipebinding")),
    type: "swipe",
    fingers: Number(binding.fingers),
    direction: normalizeDirection(binding.direction),
    flowId: String(binding.flowId || ""),
    enabled: typeof binding.enabled === "boolean" ? binding.enabled : true,
    createdAt: typeof binding.createdAt === "string" ? binding.createdAt : now,
    updatedAt: typeof binding.updatedAt === "string" ? binding.updatedAt : now,
  };
  normalized.signature = signatureForSwipe(normalized);
  normalized.displayName = displaySwipe(normalized);
  return normalized;
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
  return { ...binding };
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
  createBinding,
  deleteBinding,
  deleteBindingsForFlow,
  getBindings,
  initializeSwipeStore,
  setEnabled,
  updateBinding,
};
