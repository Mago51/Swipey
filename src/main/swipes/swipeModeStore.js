const fs = require("fs/promises");
const path = require("path");

const STORAGE_VERSION = 1;
const STORAGE_FILE = "swipeMode.json";

let storagePath = "";
let state = defaultState();

async function initializeSwipeModeStore(userDataPath) {
  storagePath = path.join(userDataPath, STORAGE_FILE);
  await fs.mkdir(userDataPath, { recursive: true });
  try {
    state = normalizeState(JSON.parse(await fs.readFile(storagePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      state = defaultState();
      await writeState();
      return;
    }
    if (error instanceof SyntaxError) {
      await preserveCorruptFile();
      console.warn(`[swipes] Corrupt Swipe mode storage moved aside. Starting with Swipes off. ${error.message}`);
      state = defaultState();
      return;
    }
    console.warn(`[swipes] Failed to load Swipe mode storage. Starting with Swipes off. ${error.message}`);
    state = defaultState();
  }
}

function getState() {
  return cloneState(state);
}

async function setSwipesEnabled(swipesEnabled) {
  state.swipesEnabled = !!swipesEnabled;
  state.updatedAt = nowIso();
  await writeState();
  return getState();
}

async function setOriginalSnapshot(snapshot) {
  state.originalWindowsTouchpadSettings = snapshot ? clone(snapshot) : null;
  state.updatedAt = nowIso();
  await writeState();
  return getState();
}

async function setLastWindowsResult(kind, result) {
  if (kind === "apply") state.lastApplyResult = clone(result);
  if (kind === "restore") state.lastRestoreResult = clone(result);
  state.updatedAt = nowIso();
  await writeState();
  return getState();
}

function hasOriginalSnapshot() {
  return !!state.originalWindowsTouchpadSettings;
}

async function clearOriginalSnapshot() {
  state.originalWindowsTouchpadSettings = null;
  state.updatedAt = nowIso();
  await writeState();
  return getState();
}

function defaultState() {
  const now = nowIso();
  return {
    version: STORAGE_VERSION,
    swipesEnabled: false,
    originalWindowsTouchpadSettings: null,
    lastApplyResult: null,
    lastRestoreResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeState(parsed) {
  const fallback = defaultState();
  if (!parsed || typeof parsed !== "object" || parsed.version !== STORAGE_VERSION) return fallback;
  return {
    version: STORAGE_VERSION,
    swipesEnabled: !!parsed.swipesEnabled,
    originalWindowsTouchpadSettings: parsed.originalWindowsTouchpadSettings && typeof parsed.originalWindowsTouchpadSettings === "object" ? clone(parsed.originalWindowsTouchpadSettings) : null,
    lastApplyResult: parsed.lastApplyResult && typeof parsed.lastApplyResult === "object" ? clone(parsed.lastApplyResult) : null,
    lastRestoreResult: parsed.lastRestoreResult && typeof parsed.lastRestoreResult === "object" ? clone(parsed.lastRestoreResult) : null,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : fallback.createdAt,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
  };
}

async function writeState() {
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${storagePath}.tmp`;
  // Temporäre Datei und rename, damit die Datei nie halb geschrieben ist.
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, storagePath);
}

async function preserveCorruptFile() {
  const stamp = nowIso().replace(/[:.]/g, "-");
  await fs.rename(storagePath, storagePath.replace(/\.json$/, `.corrupt-${stamp}.json`));
}

function cloneState(value) {
  return clone(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  STORAGE_FILE,
  STORAGE_VERSION,
  clearOriginalSnapshot,
  getState,
  hasOriginalSnapshot,
  initializeSwipeModeStore,
  setLastWindowsResult,
  setOriginalSnapshot,
  setSwipesEnabled,
};
