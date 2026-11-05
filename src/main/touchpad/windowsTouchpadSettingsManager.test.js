const assert = require("assert");
const {
  MANAGED_SETTINGS,
  PRECISION_TOUCHPAD_KEY,
  createRefreshAdapter,
  createWindowsTouchpadSettingsManager,
  formatDwordForReg,
} = require("./windowsTouchpadSettingsManager.js");

const MANAGED_NAMES = MANAGED_SETTINGS.map((setting) => setting.name);
const LEGACY_NAMES = [
  "ThreeFingerSlideEnabled",
  "ThreeFingerUp",
  "ThreeFingerDown",
  "ThreeFingerLeft",
  "ThreeFingerRight",
  "FourFingerSlideEnabled",
  "FourFingerUp",
  "FourFingerDown",
  "FourFingerLeft",
  "FourFingerRight",
];

function fakeAdapter(initialValues, options = {}) {
  const values = { ...initialValues };
  const writes = [];
  const deletes = [];
  return {
    writes,
    deletes,
    values,
    adapter: {
      keyExists: async (keyPath) => keyPath === PRECISION_TOUCHPAD_KEY,
      readDword: async (_keyPath, name) => (
        Object.prototype.hasOwnProperty.call(values, name)
          ? { exists: true, value: values[name] }
          : { exists: false, value: null }
      ),
      writeDword: async (_keyPath, name, value) => {
        writes.push({ name, value });
        if (options.failWrites?.has(name)) throw new Error(`write failed: ${name}`);
        values[name] = value;
        return { success: true };
      },
      deleteValue: async (_keyPath, name) => {
        deletes.push({ name });
        if (options.failDeletes?.has(name)) throw new Error(`delete failed: ${name}`);
        delete values[name];
        return { success: true };
      },
    },
  };
}

function fakeRefreshAdapter(options = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      refresh: async (refreshOptions) => {
        calls.push({ ...refreshOptions });
        return options.result || {
          attempted: true,
          success: true,
          mechanism: "mock-refresh",
          result: { success: true },
        };
      },
    },
  };
}

function twoFingerSnapshot(overrides = {}) {
  return {
    capturedAt: "test",
    supported: true,
    settings: {
      PanEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
      ZoomEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
      ...overrides,
    },
  };
}

(async () => {
  {
    assert.deepStrictEqual(MANAGED_NAMES, ["PanEnabled", "ZoomEnabled"], "production manager should only manage 2-finger settings");
    const registry = fakeAdapter({
      PanEnabled: 0xffffffff,
      ZoomEnabled: 0x2,
      ThreeFingerSlideEnabled: 1,
      FourFingerSlideEnabled: 1,
    });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const snapshot = await manager.captureCurrentSettings();

    assert.strictEqual(snapshot.supported, true);
    assert.deepStrictEqual(Object.keys(snapshot.settings).sort(), ["PanEnabled", "ZoomEnabled"]);
    assert.deepStrictEqual(snapshot.settings.PanEnabled, { exists: true, type: "REG_DWORD", value: 0xffffffff });
    assert.deepStrictEqual(snapshot.settings.ZoomEnabled, { exists: true, type: "REG_DWORD", value: 0x2 });
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0xffffffff });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const snapshot = await manager.captureCurrentSettings();

    assert.deepStrictEqual(snapshot.settings.ZoomEnabled, { exists: false }, "absent original values should be represented explicitly");
  }

  {
    const registry = fakeAdapter({
      PanEnabled: 0xffffffff,
      ZoomEnabled: 0xffffffff,
      ThreeFingerSlideEnabled: 1,
      FourFingerSlideEnabled: 1,
    });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.applySwipeySettings();

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(registry.writes, [
      { name: "PanEnabled", value: 0 },
      { name: "ZoomEnabled", value: 0 },
    ]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: false, zoomEnabled: false }]);
    assert(!registry.writes.some((write) => LEGACY_NAMES.includes(write.name)), "future enable must not write legacy 3/4 settings");
  }

  {
    assert.strictEqual(formatDwordForReg(0xffffffff), "0xffffffff");
    assert.strictEqual(formatDwordForReg(0), "0x0");
    assert.throws(() => formatDwordForReg(-1), /out of range/);
  }

  {
    let receivedArgs = null;
    const adapter = createRefreshAdapter(async (args) => {
      receivedArgs = args;
      return { Success: true, Mechanism: "PascalCaseHelper" };
    });
    const result = await adapter.refresh({ panEnabled: true, zoomEnabled: false });

    assert.strictEqual(result.success, true, "PascalCase native helper Success should be honored");
    assert.strictEqual(result.mechanism, "PascalCaseHelper");
    assert.deepStrictEqual(receivedArgs, ["refresh", "--pan-enabled", "1", "--zoom-enabled", "0"]);
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot({
      PanEnabled: { exists: true, type: "REG_DWORD", value: 0xffffffff },
      ZoomEnabled: { exists: true, type: "REG_DWORD", value: 3 },
    }));

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(registry.writes, [
      { name: "PanEnabled", value: 0xffffffff },
      { name: "ZoomEnabled", value: 3 },
    ]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: true, zoomEnabled: true }]);
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot({
      PanEnabled: { exists: false },
      ZoomEnabled: { exists: false },
    }));

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(registry.writes, []);
    assert.deepStrictEqual(registry.deletes, [{ name: "PanEnabled" }, { name: "ZoomEnabled" }]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: false, zoomEnabled: false }]);
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot({
      PanEnabled: { exists: true, type: "REG_DWORD", value: 0 },
      ZoomEnabled: { exists: true, type: "REG_DWORD", value: 0 },
    }));

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(registry.writes, [
      { name: "PanEnabled", value: 0 },
      { name: "ZoomEnabled", value: 0 },
    ]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: false, zoomEnabled: false }]);
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 }, {
      failWrites: new Set(["ZoomEnabled"]),
    });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot());

    assert.strictEqual(result.success, false, "failed restore should surface cleanly");
    assert.strictEqual(result.registryWriteSucceeded, false);
    assert.deepStrictEqual(result.failed, [{ name: "ZoomEnabled", message: "write failed: ZoomEnabled" }]);
    assert.deepStrictEqual(refresh.calls, [], "restore refresh should wait until all writes/deletes succeed");
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 });
    const refresh = fakeRefreshAdapter({ result: { attempted: true, success: false, mechanism: "mock-refresh", error: "timeout" } });
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot());

    assert.strictEqual(result.success, false, "failed live refresh should surface cleanly");
    assert.strictEqual(result.registryWriteSucceeded, true);
    assert.strictEqual(result.liveRefreshAttempted, true);
    assert.strictEqual(result.liveRefreshSucceeded, false);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: true, zoomEnabled: true }]);
  }

  {
    const registry = fakeAdapter({
      PanEnabled: 0,
      ZoomEnabled: 0,
      ThreeFingerSlideEnabled: 0,
      ThreeFingerUp: 0,
      FourFingerSlideEnabled: 0,
      FourFingerRight: 0,
    });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const legacySnapshot = twoFingerSnapshot({
      ThreeFingerSlideEnabled: { type: "REG_DWORD", value: 1 },
      ThreeFingerUp: { exists: true, type: "REG_DWORD", value: 4 },
      FourFingerSlideEnabled: { exists: true, type: "REG_DWORD", value: 0xffff },
      FourFingerRight: { exists: false },
    });
    const result = await manager.restorePreviousSettings(legacySnapshot);

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(registry.writes, [
      { name: "PanEnabled", value: 0xffffffff },
      { name: "ZoomEnabled", value: 0xffffffff },
      { name: "ThreeFingerSlideEnabled", value: 1 },
      { name: "ThreeFingerUp", value: 4 },
      { name: "FourFingerSlideEnabled", value: 0xffff },
    ]);
    assert.deepStrictEqual(registry.deletes, [{ name: "FourFingerRight" }]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: true, zoomEnabled: true }]);
  }

  {
    const registry = fakeAdapter({
      PanEnabled: 0,
      ZoomEnabled: 0,
      ThreeFingerSlideEnabled: 0,
    }, {
      failWrites: new Set(["ThreeFingerSlideEnabled"]),
    });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot({
      ThreeFingerSlideEnabled: { exists: true, type: "REG_DWORD", value: 1 },
    }));

    assert.strictEqual(result.success, true, "legacy cleanup failure must not block Pan/Zoom recovery");
    assert.deepStrictEqual(registry.writes.slice(0, 2), [
      { name: "PanEnabled", value: 0xffffffff },
      { name: "ZoomEnabled", value: 0xffffffff },
    ]);
    assert.deepStrictEqual(result.failed, []);
    assert.deepStrictEqual(result.legacyFailed, [{ name: "ThreeFingerSlideEnabled", message: "write failed: ThreeFingerSlideEnabled" }]);
    assert.deepStrictEqual(refresh.calls, [{ panEnabled: true, zoomEnabled: true }]);
  }

  {
    const registry = fakeAdapter({ PanEnabled: 0, ZoomEnabled: 0 });
    const refresh = fakeRefreshAdapter();
    const manager = createWindowsTouchpadSettingsManager(registry.adapter, refresh.adapter);
    const result = await manager.restorePreviousSettings(twoFingerSnapshot());

    assert.strictEqual(result.success, true);
    assert(!registry.writes.some((write) => LEGACY_NAMES.includes(write.name)), "future restore must not write legacy 3/4 settings without legacy snapshot entries");
    assert(!registry.deletes.some((item) => LEGACY_NAMES.includes(item.name)), "future restore must not delete legacy 3/4 settings without legacy snapshot entries");
  }

  console.log("windowsTouchpadSettingsManager tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
