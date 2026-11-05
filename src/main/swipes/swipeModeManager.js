const swipeModeStore = require("./swipeModeStore.js");
const { createWindowsTouchpadSettingsManager } = require("../touchpad/windowsTouchpadSettingsManager.js");

let windowsSettings = createWindowsTouchpadSettingsManager();
let notifyRenderer = () => {};
let debugEnabled = false;

function configureSwipeModeManager(options = {}) {
  windowsSettings = options.windowsSettings || windowsSettings;
  notifyRenderer = options.notifyRenderer || notifyRenderer;
  debugEnabled = !!options.debug;
}

async function initializeSwipeModeManager(userDataPath) {
  await swipeModeStore.initializeSwipeModeStore(userDataPath);
  const current = swipeModeStore.getState();
  // Der Swipe-Modus bleibt über Neustarts aktiv, die Windows-Einstellungen
  // müssen deshalb bei jedem Start neu gesetzt werden.
  if (current.swipesEnabled) {
    const result = await windowsSettings.applySwipeySettings();
    await swipeModeStore.setLastWindowsResult("apply", result);
    emitState();
    if (!result.success) console.warn("[swipes] Swipe mode startup Windows gesture configuration incomplete", result.message);
  }
}

function areSwipesEnabled() {
  return swipeModeStore.getState().swipesEnabled;
}

async function getSwipeModeState() {
  const capabilities = await windowsSettings.getCapabilities();
  return publicState(capabilities);
}

async function setSwipeModeEnabled(enabled) {
  if (enabled) return enableSwipeMode();
  return disableSwipeMode();
}

async function enableSwipeMode() {
  const before = swipeModeStore.getState();
  let snapshot = before.originalWindowsTouchpadSettings;
  snapshot = await repairStaleDisabledSnapshot(before, snapshot);
  if (snapshot && !before.swipesEnabled && snapshotRestoresDisabledTwoFingerSettings(snapshot)) {
    const replacement = await windowsSettings.captureCurrentSettings();
    if (replacement?.supported && !snapshotRestoresDisabledTwoFingerSettings(replacement)) {
      snapshot = replacement;
      await swipeModeStore.setOriginalSnapshot(snapshot);
      console.info("[swipes] stale disabled Windows touchpad snapshot replaced before enable");
    }
  }
  // Den Originalzustand speichern wir nur einmal. Würden wir ihn bei jedem Einschalten neu lesen,
  // würden wir später unsere eigenen abgeschalteten Werte als "Original" zurückschreiben.
  if (!before.originalWindowsTouchpadSettings) {
    snapshot = await windowsSettings.captureCurrentSettings();
    await swipeModeStore.setOriginalSnapshot(snapshot);
    debugLog("captured original Windows touchpad settings snapshot");
  }

  const result = await windowsSettings.applySwipeySettings();
  if (!result.success && result.changed?.length > 0 && snapshot) {
    result.rollbackResult = await windowsSettings.restorePreviousSettings(snapshot);
    if (!result.rollbackResult.success) console.warn("[swipes] Windows touchpad rollback incomplete", result.rollbackResult.message);
  }
  await swipeModeStore.setLastWindowsResult("apply", result);
  await swipeModeStore.setSwipesEnabled(true);
  emitState();
  return { success: true, enabled: true, windows: result, state: await getSwipeModeState() };
}

async function disableSwipeMode() {
  await swipeModeStore.setSwipesEnabled(false);
  const current = swipeModeStore.getState();
  let restore = { success: true, changed: [], failed: [], message: "No Windows touchpad settings snapshot was saved." };
  const snapshot = await repairStaleDisabledSnapshot(current, current.originalWindowsTouchpadSettings);

  console.info("[swipes] restoreStarted");
  console.info("[swipes] snapshotPresent", { snapshotPresent: !!snapshot });
  if (snapshot) {
    console.info("[swipes] snapshotSchemaVersion", { snapshotSchemaVersion: snapshot.schemaVersion || snapshot.version || "unversioned" });
    console.info("[swipes] panSnapshot", sanitizeSnapshotEntry(snapshot.settings?.PanEnabled));
    console.info("[swipes] zoomSnapshot", sanitizeSnapshotEntry(snapshot.settings?.ZoomEnabled));
  }

  if (snapshot) {
    restore = await windowsSettings.restorePreviousSettings(snapshot);
    await swipeModeStore.setLastWindowsResult("restore", restore);
    if (restore.success) {
      await swipeModeStore.clearOriginalSnapshot();
      console.info("[swipes] snapshotCleared");
      debugLog("restored and cleared original Windows touchpad settings snapshot");
    } else {
      console.warn("[swipes] restoreError", { message: restore.message, failed: restore.failed, refresh: restore.refresh });
      console.warn("[swipes] Windows touchpad settings restoration incomplete", restore.message);
    }
  }

  emitState();
  return { success: restore.success, enabled: false, windows: restore, state: await getSwipeModeState() };
}

// Beim Beenden bekommt Windows das Touchpad zurück. Die Einstellung "Swipe-Modus an"
// bleibt gespeichert, damit beim nächsten Start alles wieder gesetzt wird.
async function suspendSwipeMode() {
  const current = swipeModeStore.getState();
  if (!current.swipesEnabled || !current.originalWindowsTouchpadSettings) return { success: true, skipped: true };
  const restore = await windowsSettings.restorePreviousSettings(current.originalWindowsTouchpadSettings);
  await swipeModeStore.setLastWindowsResult("restore", restore);
  if (!restore.success) console.warn("[swipes] Windows touchpad settings restoration on exit incomplete", restore.message);
  return restore;
}

function publicState(capabilities = null) {
  const saved = swipeModeStore.getState();
  return {
    swipesEnabled: saved.swipesEnabled,
    hasOriginalWindowsTouchpadSettings: !!saved.originalWindowsTouchpadSettings,
    windowsTouchpad: {
      capabilities,
      lastApplyResult: saved.lastApplyResult,
      lastRestoreResult: saved.lastRestoreResult,
    },
  };
}

async function emitState() {
  notifyRenderer("swipes:mode-changed", await getSwipeModeState());
}

function debugLog(message) {
  if (debugEnabled || process.env.SWIPEY_SWIPE_DEBUG === "1") console.log(`[swipe-debug] ${message}`);
}

function sanitizeSnapshotEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.exists === false) return { exists: false };
  return {
    exists: entry.exists === true || entry.exists === undefined,
    type: entry.type,
    value: entry.value,
  };
}

// Repariert einen Snapshot, der schon die von Swipey abgeschalteten Werte (0) enthält.
// Die echten Werte holen wir aus dem letzten Apply-Ergebnis.
async function repairStaleDisabledSnapshot(state, snapshot) {
  if (!snapshot || state.swipesEnabled || !snapshotRestoresDisabledTwoFingerSettings(snapshot)) return snapshot;
  const repaired = snapshotFromLastApplyCapabilities(state.lastApplyResult, snapshot);
  if (!repaired) return snapshot;
  await swipeModeStore.setOriginalSnapshot(repaired);
  console.info("[swipes] stale disabled Windows touchpad snapshot repaired from last apply capabilities");
  return repaired;
}

function snapshotFromLastApplyCapabilities(lastApplyResult, existingSnapshot) {
  const managed = lastApplyResult?.capabilities?.managedSettings;
  if (!Array.isArray(managed)) return null;
  const pan = managed.find((setting) => setting?.name === "PanEnabled");
  const zoom = managed.find((setting) => setting?.name === "ZoomEnabled");
  if (!canRepairSnapshotEntry(pan) || !canRepairSnapshotEntry(zoom)) return null;
  const repaired = clone(existingSnapshot);
  repaired.settings = {
    ...repaired.settings,
    PanEnabled: { exists: true, type: "REG_DWORD", value: Number(pan.currentValue) },
    ZoomEnabled: { exists: true, type: "REG_DWORD", value: Number(zoom.currentValue) },
  };
  repaired.repairedFrom = "lastApplyResult.capabilities";
  repaired.repairedAt = new Date().toISOString();
  return repaired;
}

function canRepairSnapshotEntry(setting) {
  return setting && setting.supported !== false && Number.isFinite(Number(setting.currentValue)) && Number(setting.currentValue) !== 0;
}

function snapshotRestoresDisabledTwoFingerSettings(snapshot) {
  const pan = snapshot?.settings?.PanEnabled;
  const zoom = snapshot?.settings?.ZoomEnabled;
  return snapshotEntryRestoresDisabled(pan) && snapshotEntryRestoresDisabled(zoom);
}

function snapshotEntryRestoresDisabled(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.exists === false) return false;
  return Number(entry.value) === 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  areSwipesEnabled,
  configureSwipeModeManager,
  getSwipeModeState,
  initializeSwipeModeManager,
  setSwipeModeEnabled,
  suspendSwipeMode,
};
