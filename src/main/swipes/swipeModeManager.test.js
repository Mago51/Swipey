const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const swipeModeManager = require("./swipeModeManager.js");

const originalTouchpadSnapshotSettings = {
  PanEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
  ZoomEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swipey-swipe-mode-"));
}

function fakeWindowsSettings(options = {}) {
  const calls = { capture: 0, apply: 0, restore: 0, restoredSnapshots: [] };
  const snapshot = options.snapshot || {
    capturedAt: "first",
    supported: true,
    settings: originalTouchpadSnapshotSettings,
  };
  return {
    calls,
    manager: {
      getCapabilities: async () => ({ supported: true, manageable: Object.keys(snapshot.settings), managedSettings: [] }),
      captureCurrentSettings: async () => {
        calls.capture += 1;
        return snapshot;
      },
      applySwipeySettings: async () => {
        calls.apply += 1;
        return options.applyResult || { success: true, changed: [], failed: [], message: "applied" };
      },
      restorePreviousSettings: async (saved) => {
        calls.restore += 1;
        calls.restoredSnapshots.push(saved);
        return options.restoreResult || { success: true, changed: [], failed: [], message: "restored" };
      },
    },
  };
}

(async () => {
  {
    const userData = tempDir();
    const windows = fakeWindowsSettings();
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    assert.strictEqual((await swipeModeManager.suspendSwipeMode()).skipped, true, "suspending while Swipe mode is off must not touch Windows settings");
    await swipeModeManager.setSwipeModeEnabled(true);
    await swipeModeManager.suspendSwipeMode();
    assert.strictEqual(windows.calls.restore, 1, "exiting while enabled must restore the original Windows settings");
    assert.deepStrictEqual(windows.calls.restoredSnapshots[0].settings, originalTouchpadSnapshotSettings);
    assert.strictEqual(swipeModeManager.areSwipesEnabled(), true, "the Swipe mode preference must survive the restore");

    const next = fakeWindowsSettings();
    swipeModeManager.configureSwipeModeManager({ windowsSettings: next.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    assert.strictEqual(next.calls.apply, 1, "the next start must re-apply the Swipey settings");
    await swipeModeManager.setSwipeModeEnabled(false);
    assert.strictEqual(next.calls.restore, 1, "turning the mode off after a restart must still restore from the saved snapshot");
  }

  {
    const windows = fakeWindowsSettings();
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    await swipeModeManager.setSwipeModeEnabled(true);
    const state = await swipeModeManager.getSwipeModeState();
    assert.strictEqual(windows.calls.capture, 1, "enabling should capture original Windows settings once");
    assert.strictEqual(windows.calls.apply, 1, "enabling should apply Swipey Windows settings");
    assert.strictEqual(state.swipesEnabled, true);
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, true);
    assert.strictEqual(windows.calls.restoredSnapshots.length, 0);
  }

  {
    const userData = tempDir();
    const first = fakeWindowsSettings({ snapshot: { capturedAt: "original", supported: true, settings: { PanEnabled: { type: "REG_DWORD", value: 0xffffffff } } } });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: first.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    await swipeModeManager.setSwipeModeEnabled(true);

    const second = fakeWindowsSettings({ snapshot: { capturedAt: "wrong", supported: true, settings: { PanEnabled: { type: "REG_DWORD", value: 0 } } } });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: second.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    const state = await swipeModeManager.getSwipeModeState();
    assert.strictEqual(second.calls.capture, 0, "startup while enabled must not overwrite the original snapshot");
    assert.strictEqual(second.calls.apply, 1, "startup while enabled should ensure Swipey settings are active");
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, true);
  }

  {
    const userData = tempDir();
    const stale = fakeWindowsSettings({
      snapshot: {
        capturedAt: "stale",
        supported: true,
        settings: {
          PanEnabled: { type: "REG_DWORD", value: 0 },
          ZoomEnabled: { type: "REG_DWORD", value: 0 },
        },
      },
      restoreResult: { success: false, changed: [], failed: [], message: "refresh failed" },
    });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: stale.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    await swipeModeManager.setSwipeModeEnabled(true);
    await swipeModeManager.setSwipeModeEnabled(false);
    assert.strictEqual((await swipeModeManager.getSwipeModeState()).hasOriginalWindowsTouchpadSettings, true);

    const fresh = fakeWindowsSettings({
      snapshot: {
        capturedAt: "fresh",
        supported: true,
        settings: {
          PanEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
          ZoomEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
        },
      },
    });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: fresh.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    await swipeModeManager.setSwipeModeEnabled(true);
    await swipeModeManager.setSwipeModeEnabled(false);

    assert.strictEqual(fresh.calls.capture, 1, "OFF -> ON should replace a stale disabled snapshot with the current original settings");
    assert.strictEqual(fresh.calls.restoredSnapshots[0].settings.PanEnabled.value, 0xffffffff);
    assert.strictEqual(fresh.calls.restoredSnapshots[0].settings.ZoomEnabled.value, 0xffffffff);
  }

  {
    const userData = tempDir();
    fs.writeFileSync(path.join(userData, "swipeMode.json"), `${JSON.stringify({
      version: 1,
      swipesEnabled: false,
      originalWindowsTouchpadSettings: {
        capturedAt: "stale",
        supported: true,
        settings: {
          PanEnabled: { type: "REG_DWORD", value: 0 },
          ZoomEnabled: { type: "REG_DWORD", value: 0 },
          ThreeFingerSlideEnabled: { type: "REG_DWORD", value: 0 },
          FourFingerSlideEnabled: { type: "REG_DWORD", value: 0 },
        },
      },
      lastApplyResult: {
        capabilities: {
          managedSettings: [
            { name: "PanEnabled", supported: true, currentValue: 0xffffffff },
            { name: "ZoomEnabled", supported: true, currentValue: 0xffffffff },
          ],
        },
      },
      lastRestoreResult: null,
      createdAt: "now",
      updatedAt: "now",
    }, null, 2)}\n`);
    const windows = fakeWindowsSettings();
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(userData);
    const result = await swipeModeManager.setSwipeModeEnabled(false);
    const state = await swipeModeManager.getSwipeModeState();

    assert.strictEqual(result.success, true);
    assert.strictEqual(windows.calls.restore, 1);
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.PanEnabled.value, 0xffffffff, "stale snapshot should repair PanEnabled from last apply capabilities");
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.ZoomEnabled.value, 0xffffffff, "stale snapshot should repair ZoomEnabled from last apply capabilities");
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, false);
  }

  {
    const windows = fakeWindowsSettings();
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    await swipeModeManager.setSwipeModeEnabled(true);
    const result = await swipeModeManager.setSwipeModeEnabled(false);
    const state = await swipeModeManager.getSwipeModeState();
    assert.strictEqual(result.success, true);
    assert.strictEqual(windows.calls.restore, 1, "disabling should restore the saved snapshot");
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.PanEnabled.value, 0xffffffff, "restore should receive the exact saved DWORD value");
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.ZoomEnabled.value, 0xffffffff, "restore should preserve 0xffffffff");
    assert.strictEqual(state.swipesEnabled, false);
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, false, "successful restore should clear snapshot");
  }

  {
    const legacySnapshot = {
      capturedAt: "legacy",
      supported: true,
      settings: {
        PanEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
        ZoomEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
        ThreeFingerSlideEnabled: { exists: true, type: "REG_DWORD", value: 1 },
        ThreeFingerUp: { exists: true, type: "REG_DWORD", value: 4 },
        FourFingerSlideEnabled: { exists: true, type: "REG_DWORD", value: 0xffff },
        FourFingerRight: { exists: false },
      },
    };
    const windows = fakeWindowsSettings({ snapshot: legacySnapshot });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    await swipeModeManager.setSwipeModeEnabled(true);
    const result = await swipeModeManager.setSwipeModeEnabled(false);
    const state = await swipeModeManager.getSwipeModeState();

    assert.strictEqual(result.success, true);
    assert.strictEqual(windows.calls.restore, 1);
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.ThreeFingerUp.value, 4, "legacy restore should receive saved 3/4 settings once");
    assert.strictEqual(windows.calls.restoredSnapshots[0].settings.FourFingerSlideEnabled.value, 0xffff);
    assert.deepStrictEqual(windows.calls.restoredSnapshots[0].settings.FourFingerRight, { exists: false });
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, false, "successful legacy cleanup should clear the old snapshot");
  }

  {
    const windows = fakeWindowsSettings({ restoreResult: { success: false, changed: [], failed: [{ name: "PanEnabled", message: "denied" }], message: "restore failed" } });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    await swipeModeManager.setSwipeModeEnabled(true);
    const result = await swipeModeManager.setSwipeModeEnabled(false);
    const state = await swipeModeManager.getSwipeModeState();
    assert.strictEqual(result.success, false);
    assert.strictEqual(state.swipesEnabled, false);
    assert.strictEqual(swipeModeManager.areSwipesEnabled(), false, "OFF execution gate must remain off even if restore fails");
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, true, "failed restore must retain snapshot");
  }

  {
    const windows = fakeWindowsSettings({
      restoreResult: {
        success: false,
        changed: [{ name: "PanEnabled", value: 0xffffffff }, { name: "ZoomEnabled", value: 0xffffffff }],
        failed: [],
        registryWriteSucceeded: true,
        liveRefreshAttempted: true,
        liveRefreshSucceeded: false,
        message: "refresh failed",
      },
    });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    await swipeModeManager.setSwipeModeEnabled(true);
    const result = await swipeModeManager.setSwipeModeEnabled(false);
    const state = await swipeModeManager.getSwipeModeState();

    assert.strictEqual(result.success, false, "failed live refresh should prevent snapshot clearing");
    assert.strictEqual(state.swipesEnabled, false);
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, true, "failed live refresh must retain snapshot");
  }

  {
    const windows = fakeWindowsSettings({
      applyResult: {
        success: false,
        changed: [{ name: "PanEnabled", value: 0 }],
        failed: [{ name: "ZoomEnabled", message: "denied" }],
        message: "apply failed",
      },
    });
    swipeModeManager.configureSwipeModeManager({ windowsSettings: windows.manager });
    await swipeModeManager.initializeSwipeModeManager(tempDir());
    const result = await swipeModeManager.setSwipeModeEnabled(true);
    const state = await swipeModeManager.getSwipeModeState();
    assert.strictEqual(result.windows.success, false);
    assert.strictEqual(windows.calls.restore, 1, "partial apply failure should attempt rollback");
    assert.strictEqual(state.swipesEnabled, true, "Swipe execution state still follows the requested master toggle");
    assert.strictEqual(state.hasOriginalWindowsTouchpadSettings, true, "snapshot should remain after apply failure");
  }

  console.log("swipeModeManager tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
