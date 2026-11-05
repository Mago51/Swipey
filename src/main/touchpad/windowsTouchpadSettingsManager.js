const { execFile } = require("child_process");
const { helperPath } = require("../nativeHelpers.js");

const PRECISION_TOUCHPAD_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad";
const refreshHelperExe = helperPath("Swipey.TouchpadSettingsRefresh");
// Diese beiden Werte schaltet Swipey aus, damit Windows nicht mehr selbst scrollt und zoomt.
const MANAGED_SETTINGS = [
  { name: "PanEnabled", swipeyValue: 0, enabledValue: 0xffffffff, disabledValue: 0, label: "Two-finger scrolling" },
  { name: "ZoomEnabled", swipeyValue: 0, enabledValue: 0xffffffff, disabledValue: 0, label: "Pinch to zoom" },
];
// Frühere Versionen haben auch die 3- und 4-Finger-Gesten verändert. Steht davon noch
// etwas in einem alten Snapshot, stellen wir es beim Zurücksetzen mit wieder her.
const LEGACY_RESTORE_ONLY_SETTINGS = [
  { name: "ThreeFingerSlideEnabled" },
  { name: "ThreeFingerUp" },
  { name: "ThreeFingerDown" },
  { name: "ThreeFingerLeft" },
  { name: "ThreeFingerRight" },
  { name: "FourFingerSlideEnabled" },
  { name: "FourFingerUp" },
  { name: "FourFingerDown" },
  { name: "FourFingerLeft" },
  { name: "FourFingerRight" },
];

function createWindowsTouchpadSettingsManager(adapter = createRegistryAdapter(), refreshAdapter = createRefreshAdapter()) {
  async function getCapabilities() {
    if (process.platform !== "win32") {
      return unsupported("Windows touchpad settings are only available on Windows.");
    }

    const keyExists = await adapter.keyExists(PRECISION_TOUCHPAD_KEY);
    if (!keyExists) {
      return unsupported("Verified Precision Touchpad settings key was not found for this Windows user.");
    }

    const settings = [];
    for (const setting of MANAGED_SETTINGS) {
      const current = await adapter.readDword(PRECISION_TOUCHPAD_KEY, setting.name);
      settings.push({
        name: setting.name,
        label: setting.label,
        supported: current.exists,
        currentValue: current.exists ? current.value : null,
        swipeyValue: setting.swipeyValue,
      });
    }
    return {
      supported: true,
      provider: "hkcu-precision-touchpad",
      keyPath: PRECISION_TOUCHPAD_KEY,
      managedSettings: settings,
      manageable: MANAGED_SETTINGS.map((setting) => setting.name),
      missing: [],
      reason: "",
    };
  }

  async function captureCurrentSettings() {
    const capabilities = await getCapabilities();
    const settings = {};
    if (!capabilities.supported) {
      return {
        capturedAt: nowIso(),
        provider: capabilities.provider,
        keyPath: PRECISION_TOUCHPAD_KEY,
        supported: false,
        reason: capabilities.reason,
        settings,
      };
    }

    for (const setting of MANAGED_SETTINGS) {
      const current = await adapter.readDword(PRECISION_TOUCHPAD_KEY, setting.name);
      settings[setting.name] = current.exists
        ? { exists: true, type: "REG_DWORD", value: current.value }
        : { exists: false };
    }
    return {
      capturedAt: nowIso(),
      provider: capabilities.provider,
      keyPath: PRECISION_TOUCHPAD_KEY,
      supported: true,
      settings,
    };
  }

  async function applySwipeySettings() {
    const capabilities = await getCapabilities();
    if (!capabilities.supported) {
      return { success: false, unsupported: true, changed: [], failed: [], capabilities, message: capabilities.reason };
    }

    const changed = [];
    const failed = [];
    for (const setting of MANAGED_SETTINGS) {
      try {
        await adapter.writeDword(PRECISION_TOUCHPAD_KEY, setting.name, setting.swipeyValue);
        changed.push({ name: setting.name, value: setting.swipeyValue });
      } catch (error) {
        failed.push({ name: setting.name, message: error.message });
      }
    }
    const registryWriteSucceeded = failed.length === 0;
    // Die Registry allein reicht nicht, Windows übernimmt die Werte erst nach dem Refresh.
    const refresh = registryWriteSucceeded
      ? await refreshAdapter.refresh({ panEnabled: false, zoomEnabled: false })
      : refreshSkipped("Registry writes did not complete.");

    return {
      success: registryWriteSucceeded && refresh.success,
      changed,
      failed,
      capabilities,
      registryWriteSucceeded,
      liveRefreshAttempted: refresh.attempted,
      liveRefreshSucceeded: refresh.success,
      refreshMechanism: refresh.mechanism,
      refresh,
      message: registryWriteSucceeded && refresh.success ? "Windows touchpad gestures configured for Swipey." : "Windows touchpad gesture configuration did not fully refresh live.",
    };
  }

  async function restorePreviousSettings(snapshot) {
    console.info("[touchpad-settings] restoreStarted");
    if (!snapshot?.settings || typeof snapshot.settings !== "object") {
      console.warn("[touchpad-settings] restoreError no saved Windows touchpad settings snapshot is available");
      return { success: false, changed: [], failed: [], message: "No saved Windows touchpad settings snapshot is available." };
    }

    const failed = [];
    const legacyFailed = [];
    const operations = [];
    const legacyOperations = [];
    for (const setting of MANAGED_SETTINGS) {
      const name = setting.name;
      const saved = normalizeSnapshotEntry(snapshot.settings[name]);
      if (!saved) {
        failed.push({ name, message: "Snapshot entry is missing or incomplete." });
        continue;
      }
      operations.push({ name, saved });
    }
    for (const setting of legacyRestoreSettingsForSnapshot(snapshot)) {
      const name = setting.name;
      const saved = normalizeSnapshotEntry(snapshot.settings[name]);
      if (!saved) {
        legacyFailed.push({ name, message: "Legacy snapshot entry is missing or incomplete." });
        continue;
      }
      legacyOperations.push({ name, saved });
    }

    // Ein unvollständiger Snapshot wird gar nicht erst zurückgespielt,
    // sonst hätte der Nutzer danach eine Mischung aus alten und neuen Einstellungen.
    if (failed.length > 0) {
      const refresh = refreshSkipped("Saved snapshot is missing one or more managed values.");
      console.warn("[touchpad-settings] restoreError current 2-finger snapshot is incomplete", { failed });
      return {
        success: false,
        changed: [],
        failed,
        registryWriteSucceeded: false,
        liveRefreshAttempted: refresh.attempted,
        liveRefreshSucceeded: refresh.success,
        refreshMechanism: refresh.mechanism,
        refresh,
        message: "Windows touchpad settings snapshot is incomplete and was not restored.",
      };
    }

    const changed = [];
    for (const { name, saved } of operations) {
      try {
        logRestoreAttempt(name, saved);
        if (saved.exists) {
          const value = Number(saved.value);
          await adapter.writeDword(PRECISION_TOUCHPAD_KEY, name, value);
          changed.push({ name, value, restored: "dword" });
        } else {
          await adapter.deleteValue(PRECISION_TOUCHPAD_KEY, name);
          changed.push({ name, restored: "absent" });
        }
        logRestoreSucceeded(name);
      } catch (error) {
        failed.push({ name, message: error.message });
        console.warn("[touchpad-settings] restoreError", { name, message: error.message });
      }
    }

    const legacyChanged = [];
    for (const { name, saved } of legacyOperations) {
      try {
        if (saved.exists) {
          const value = Number(saved.value);
          await adapter.writeDword(PRECISION_TOUCHPAD_KEY, name, value);
          legacyChanged.push({ name, value, restored: "dword" });
        } else {
          await adapter.deleteValue(PRECISION_TOUCHPAD_KEY, name);
          legacyChanged.push({ name, restored: "absent" });
        }
      } catch (error) {
        legacyFailed.push({ name, message: error.message });
        console.warn("[touchpad-settings] restoreError legacy cleanup failed", { name, message: error.message });
      }
    }

    const registryWriteSucceeded = failed.length === 0;
    const panSnapshot = normalizeSnapshotEntry(snapshot.settings.PanEnabled);
    const zoomSnapshot = normalizeSnapshotEntry(snapshot.settings.ZoomEnabled);
    console.info("[touchpad-settings] refreshAttempted", { attempted: registryWriteSucceeded });
    const refresh = registryWriteSucceeded
      ? await refreshAdapter.refresh({
        panEnabled: panSnapshot?.exists ? Number(panSnapshot.value) !== 0 : false,
        zoomEnabled: zoomSnapshot?.exists ? Number(zoomSnapshot.value) !== 0 : false,
      })
      : refreshSkipped("Registry restore did not complete.");
    console.info("[touchpad-settings] refreshSucceeded", { succeeded: refresh.success, mechanism: refresh.mechanism });
    if (!refresh.success) console.warn("[touchpad-settings] restoreError live refresh failed", refresh);

    return {
      success: registryWriteSucceeded && refresh.success,
      changed: [...changed, ...legacyChanged],
      failed,
      legacyChanged,
      legacyFailed,
      registryWriteSucceeded,
      liveRefreshAttempted: refresh.attempted,
      liveRefreshSucceeded: refresh.success,
      refreshMechanism: refresh.mechanism,
      refresh,
      message: registryWriteSucceeded && refresh.success ? "Windows touchpad settings restored." : "Windows touchpad settings did not fully refresh live.",
    };
  }

  return {
    applySwipeySettings,
    captureCurrentSettings,
    getCapabilities,
    hasSavedSnapshot: (snapshot) => !!snapshot?.settings && Object.keys(snapshot.settings).length > 0,
    restorePreviousSettings,
  };
}

function createRefreshAdapter(refreshRunner = runRefreshHelper) {
  return {
    async refresh(options = {}) {
      const args = ["refresh"];
      if (typeof options.panEnabled === "boolean") args.push("--pan-enabled", options.panEnabled ? "1" : "0");
      if (typeof options.zoomEnabled === "boolean") args.push("--zoom-enabled", options.zoomEnabled ? "1" : "0");
      try {
        const result = await refreshRunner(args);
        const success = result.success ?? result.Success;
        const mechanism = result.mechanism || result.Mechanism;
        return {
          attempted: true,
          success: !!success,
          mechanism: mechanism || "touchpad-settings-refresh-helper",
          result,
        };
      } catch (error) {
        return {
          attempted: true,
          success: false,
          mechanism: "touchpad-settings-refresh-helper",
          error: error.message,
        };
      }
    },
  };
}

function refreshSkipped(reason) {
  return {
    attempted: false,
    success: false,
    mechanism: "not-attempted",
    reason,
  };
}

function createRegistryAdapter() {
  return {
    async keyExists(keyPath) {
      const result = await reg(["query", keyPath], { allowFailure: true });
      return result.code === 0;
    },
    async readDword(keyPath, name) {
      const result = await reg(["query", keyPath, "/v", name], { allowFailure: true });
      if (result.code !== 0) return { exists: false, value: null };
      const match = result.stdout.match(new RegExp(`${escapeRegExp(name)}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, "i"));
      if (!match) return { exists: false, value: null };
      return { exists: true, value: Number.parseInt(match[1], 16) };
    },
    async writeDword(keyPath, name, value) {
      const result = await reg(["add", keyPath, "/v", name, "/t", "REG_DWORD", "/d", formatDwordForReg(value), "/f"], { allowFailure: true });
      if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `reg.exe failed writing ${name}.`);
      return { success: true };
    },
    async deleteValue(keyPath, name) {
      const query = await reg(["query", keyPath, "/v", name], { allowFailure: true });
      if (query.code !== 0) return { success: true, alreadyAbsent: true };
      const result = await reg(["delete", keyPath, "/v", name, "/f"], { allowFailure: true });
      if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `reg.exe failed deleting ${name}.`);
      return { success: true };
    },
  };
}

function legacyRestoreSettingsForSnapshot(snapshot) {
  const settings = snapshot?.settings && typeof snapshot.settings === "object" ? snapshot.settings : {};
  return LEGACY_RESTORE_ONLY_SETTINGS.filter((setting) => Object.prototype.hasOwnProperty.call(settings, setting.name));
}

// Ältere Snapshots haben kein `exists`-Feld, dann zählen type und value allein.
function normalizeSnapshotEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.exists === false) return { exists: false };
  if (entry.exists === true && entry.type === "REG_DWORD" && Number.isFinite(Number(entry.value))) {
    return { exists: true, type: "REG_DWORD", value: Number(entry.value) };
  }
  if (entry.type === "REG_DWORD" && Number.isFinite(Number(entry.value))) {
    return { exists: true, type: "REG_DWORD", value: Number(entry.value) };
  }
  return null;
}

function formatDwordForReg(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new Error(`REG_DWORD value out of range: ${value}`);
  }
  return `0x${number.toString(16)}`;
}

function logRestoreAttempt(name, saved) {
  if (name === "PanEnabled") console.info("[touchpad-settings] restorePanAttempted", { action: saved.exists ? "writeDword" : "deleteValue", value: saved.exists ? saved.value : null });
  if (name === "ZoomEnabled") console.info("[touchpad-settings] restoreZoomAttempted", { action: saved.exists ? "writeDword" : "deleteValue", value: saved.exists ? saved.value : null });
}

function logRestoreSucceeded(name) {
  if (name === "PanEnabled") console.info("[touchpad-settings] restorePanSucceeded");
  if (name === "ZoomEnabled") console.info("[touchpad-settings] restoreZoomSucceeded");
}

function reg(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile("reg.exe", args, { windowsHide: true }, (error, stdout, stderr) => {
      const result = { code: error?.code || 0, stdout: stdout || "", stderr: stderr || "" };
      if (error && !options.allowFailure) {
        const wrapped = new Error(stderr.trim() || stdout.trim() || error.message);
        wrapped.code = "REGISTRY_COMMAND_FAILED";
        reject(wrapped);
        return;
      }
      resolve(result);
    });
  });
}

function runRefreshHelper(args) {
  return new Promise((resolve, reject) => {
    execFile(refreshHelperExe, args, { windowsHide: true }, (error, stdout, stderr) => {
      const text = String(stdout || "").trim();
      let parsed = null;
      if (text) {
        try {
          // Der Helper kann mehrere Zeilen ausgeben, das Ergebnis steht in der letzten.
          parsed = JSON.parse(text.split(/\r?\n/).filter(Boolean).at(-1));
        } catch (_parseError) {
          parsed = null;
        }
      }
      if (error) {
        const wrapped = new Error((stderr || "").trim() || parsed?.message || error.message);
        wrapped.code = "TOUCHPAD_SETTINGS_REFRESH_FAILED";
        wrapped.details = parsed;
        reject(wrapped);
        return;
      }
      if (!parsed) {
        const wrapped = new Error("Touchpad settings refresh helper did not return JSON.");
        wrapped.code = "TOUCHPAD_SETTINGS_REFRESH_INVALID_OUTPUT";
        reject(wrapped);
        return;
      }
      resolve(parsed);
    });
  });
}

function unsupported(reason) {
  return {
    supported: false,
    provider: "hkcu-precision-touchpad",
    keyPath: PRECISION_TOUCHPAD_KEY,
    managedSettings: MANAGED_SETTINGS.map((setting) => ({ name: setting.name, label: setting.label, supported: false, currentValue: null, swipeyValue: setting.swipeyValue })),
    manageable: [],
    missing: MANAGED_SETTINGS.map((setting) => setting.name),
    reason,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  LEGACY_RESTORE_ONLY_SETTINGS,
  MANAGED_SETTINGS,
  PRECISION_TOUCHPAD_KEY,
  createRefreshAdapter,
  createRegistryAdapter,
  createWindowsTouchpadSettingsManager,
  formatDwordForReg,
};
