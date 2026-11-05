const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const STORAGE_FILE = "text-presets.json";
const STORAGE_VERSION = 1;
const MAX_PRESET_TEXT_LENGTH = 10000;

let storagePath = "";
let presets = [];

async function initializePresetStore(userDataPath) {
  storagePath = path.join(userDataPath, STORAGE_FILE);
  await fs.mkdir(userDataPath, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(storagePath, "utf8"));
    presets = loadStorage(parsed);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`[presets] Failed to load presets: ${error.message}`);
    presets = seedPresets();
    await writeStorage();
  }
}

function loadStorage(parsed) {
  if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.presets)) return seedPresets();
  return parsed.presets.map(normalizePreset).filter(Boolean);
}

function listPresets() {
  return presets.map(clonePreset);
}

function findPreset(presetId) {
  const preset = presets.find((item) => item.id === presetId);
  return preset ? clonePreset(preset) : null;
}

async function createPreset(input) {
  const preset = normalizePreset({
    ...input,
    id: input?.id || createId("preset"),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (!preset) throw structuredError("INVALID_PRESET", "Preset is invalid.");
  validatePreset(preset);
  presets.unshift(preset);
  await writeStorage();
  return clonePreset(preset);
}

async function updatePreset(input) {
  const index = presets.findIndex((item) => item.id === input?.id);
  if (index < 0) throw structuredError("PRESET_NOT_FOUND", "Preset was not found.");
  const preset = normalizePreset({
    ...input,
    createdAt: presets[index].createdAt,
    updatedAt: nowIso(),
  });
  if (!preset) throw structuredError("INVALID_PRESET", "Preset is invalid.");
  validatePreset(preset);
  presets.splice(index, 1, preset);
  await writeStorage();
  return clonePreset(preset);
}

async function deletePreset(presetId) {
  const index = presets.findIndex((item) => item.id === presetId);
  if (index >= 0) {
    presets.splice(index, 1);
    await writeStorage();
  }
  return { success: true };
}

function normalizePreset(input) {
  if (!input || typeof input !== "object") return null;
  const now = nowIso();
  return {
    id: String(input.id || createId("preset")),
    name: String(input.name || "Untitled Preset").trim() || "Untitled Preset",
    text: String(input.text || ""),
    createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now,
  };
}

function validatePreset(preset) {
  if (!preset.name.trim()) throw structuredError("PRESET_NAME_REQUIRED", "Preset name is required.");
  if (!preset.text) throw structuredError("PRESET_TEXT_REQUIRED", "Preset text is required.");
  if (preset.text.length > MAX_PRESET_TEXT_LENGTH) throw structuredError("PRESET_TEXT_TOO_LONG", `Preset text cannot exceed ${MAX_PRESET_TEXT_LENGTH} characters.`);
}

async function writeStorage() {
  const payload = `${JSON.stringify({ version: STORAGE_VERSION, presets }, null, 2)}\n`;
  const tmpPath = `${storagePath}.tmp`;
  // Temporäre Datei und rename, damit die Datei nie halb geschrieben ist.
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, storagePath);
}

function seedPresets() {
  const now = nowIso();
  return [{
    id: "preset-support-reply",
    name: "Support Reply",
    text: "Thanks for reaching out. I will take a look and get back to you shortly.",
    createdAt: now,
    updatedAt: now,
  }];
}

function clonePreset(preset) {
  return { ...preset };
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
  MAX_PRESET_TEXT_LENGTH,
  STORAGE_FILE,
  STORAGE_VERSION,
  initializePresetStore,
  listPresets,
  findPreset,
  createPreset,
  updatePreset,
  deletePreset,
};
