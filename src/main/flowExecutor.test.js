const assert = require("assert");
const actionRegistry = require("./actionRegistry.js");
const flowExecutor = require("./flowExecutor.js");

function configureTestRuntime(options = {}) {
  const openedUrls = options.openedUrls || [];
  const delays = options.delays || [];
  const execCalls = options.execCalls || [];
  const spawnCalls = options.spawnCalls || [];
  const clipboardWrites = options.clipboardWrites || [];
  actionRegistry.configureActionRegistry({
    browserResolver: options.browserResolver || (async (browserId) => ({ id: browserId, path: `C:\\Browsers\\${browserId}.exe` })),
    clipboard: {
      readText: () => "example.com",
      writeText: (text) => clipboardWrites.push(text),
    },
    delay: async (milliseconds) => delays.push(milliseconds),
    execFile: (file, args, _options, callback) => {
      execCalls.push({ file, args });
      callback(null, "", "");
    },
    flowStore: options.flowStore || null,
    presetStore: options.presetStore || { findPreset: () => ({ id: "preset-a", name: "Preset A", text: "Hello preset" }) },
    shell: { openExternal: async (url) => openedUrls.push(url) },
    spawn: (file, args) => {
      spawnCalls.push({ file, args });
      return {
      once: (event, callback) => {
        if (event === "spawn") queueMicrotask(callback);
      },
      unref: () => {},
      };
    },
    windowsAutomation: options.windowsAutomation || { run: async (args) => ({ args }) },
  });
  return { openedUrls, delays, execCalls, spawnCalls, clipboardWrites };
}

async function testRunActionExecutesImplementedAction() {
  const openedUrls = [];
  configureTestRuntime({ openedUrls });
  const result = await flowExecutor.runAction({ id: "a1", type: "web.searchGoogle", params: { query: "hello world" } });
  assert.strictEqual(result.success, true, "implemented action should execute");
  assert.deepStrictEqual(openedUrls, ["https://www.google.com/search?q=hello%20world"], "search query should be URL encoded");
}

async function testInvalidConfigFailsCleanly() {
  configureTestRuntime();
  const result = await flowExecutor.runAction({ id: "a1", type: "web.openWebsite", params: { url: "notaurl" } });
  assert.strictEqual(result.success, false, "invalid action config should fail");
  assert.strictEqual(result.error.code, "INVALID_URL");
}

async function testUnknownActionFailsCleanly() {
  configureTestRuntime();
  const result = await flowExecutor.runAction({ id: "a1", type: "made.up", params: {} });
  assert.strictEqual(result.success, false, "unknown action should fail");
  assert.strictEqual(result.error.code, "UNKNOWN_ACTION_TYPE");
}

async function testUnavailableActionCannotExecute() {
  configureTestRuntime();
  const result = await flowExecutor.runAction({ id: "a1", type: "app.ifRunning", params: { appName: "Code" } });
  assert.strictEqual(result.success, false, "unavailable action should not execute");
  assert.strictEqual(result.error.code, "ACTION_UNAVAILABLE");
}

async function testWaitIsAsync() {
  const delays = [];
  configureTestRuntime({ delays });
  const result = await flowExecutor.runAction({ id: "a1", type: "event.wait", params: { milliseconds: 250 } });
  assert.strictEqual(result.success, true, "wait should execute");
  assert.deepStrictEqual(delays, [250], "wait should use async delay");
}

async function testStopFlowStopsCurrentFlow() {
  const openedUrls = [];
  configureTestRuntime({ openedUrls });
  flowExecutor.configureFlowExecutor({
    flowStore: {
      findFlow: () => ({
        id: "flow-a",
        name: "Flow A",
        enabled: true,
        actions: [
          { id: "a1", type: "event.stopFlow", params: {} },
          { id: "a2", type: "web.searchGoogle", params: { query: "should not run" } },
        ],
      }),
    },
  });

  const result = await flowExecutor.runFlow("flow-a");
  assert.strictEqual(result.success, true, "Stop Flow should complete the Flow cleanly");
  assert.strictEqual(result.reason, "STOP_FLOW");
  assert.strictEqual(result.actions.length, 1, "actions after Stop Flow should not execute");
  assert.deepStrictEqual(openedUrls, [], "later actions must not run");
}

async function testRunFlowPreventsRecursion() {
  const store = {
    findFlow: () => ({ id: "flow-a", name: "Flow A", enabled: true, actions: [] }),
  };
  configureTestRuntime({ flowStore: store });
  const result = await flowExecutor.runAction(
    { id: "a1", type: "event.runFlow", params: { flowId: "flow-a" } },
    { currentFlowId: "flow-a", ancestry: ["flow-a"] }
  );
  assert.strictEqual(result.success, false, "Run Another Flow should reject recursion");
  assert.strictEqual(result.error.code, "FLOW_RECURSION_DETECTED");
}

async function testWindowActionsUseWindowsAutomation() {
  const calls = [];
  configureTestRuntime({ windowsAutomation: { run: async (args) => { calls.push(args); return { ok: true }; } } });

  const focus = await flowExecutor.runAction({ id: "a1", type: "app.focus", params: { processName: "notepad.exe", windowTitle: "Notes" } });
  const minimize = await flowExecutor.runAction({ id: "a2", type: "app.minimize", params: { processName: "notepad.exe" } });
  const maximize = await flowExecutor.runAction({ id: "a3", type: "app.maximize", params: { processName: "notepad.exe" } });
  const move = await flowExecutor.runAction({ id: "a4", type: "app.moveToPosition", params: { processName: "notepad.exe", position: "left-half" } });

  assert.strictEqual(focus.success, true);
  assert.strictEqual(minimize.success, true);
  assert.strictEqual(maximize.success, true);
  assert.strictEqual(move.success, true);
  assert.deepStrictEqual(calls[0], ["window", "--operation", "focus", "--process-name", "notepad.exe", "--window-title", "Notes"]);
  assert.deepStrictEqual(calls[1], ["window", "--operation", "minimize", "--process-name", "notepad.exe"]);
  assert.deepStrictEqual(calls[2], ["window", "--operation", "maximize", "--process-name", "notepad.exe"]);
  assert.deepStrictEqual(calls[3], ["window", "--operation", "move-position", "--process-name", "notepad.exe", "--position", "left-half"]);
}

async function testWaitUntilAppOpensPollsUntilFound() {
  const calls = [];
  const delays = [];
  configureTestRuntime({
    delays,
    windowsAutomation: {
      run: async (args) => {
        calls.push(args);
        if (calls.length === 1) {
          const error = new Error("not running");
          error.code = "APP_NOT_RUNNING";
          throw error;
        }
        return { found: true };
      },
    },
  });

  const result = await flowExecutor.runAction({
    id: "a1",
    type: "app.waitUntilOpens",
    params: { processName: "notepad.exe", timeoutMs: 1000, pollIntervalMs: 250 },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(delays, [250]);
}

async function testSetVolumeUsesNativeHelper() {
  const calls = [];
  configureTestRuntime({ windowsAutomation: { run: async (args) => { calls.push(args); return { percent: 50 }; } } });
  const result = await flowExecutor.runAction({ id: "a1", type: "pc.setVolume", params: { percent: 50 } });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(calls, [["volume", "--percent", "50"]]);

  const invalid = await flowExecutor.runAction({ id: "a2", type: "pc.setVolume", params: { percent: 101 } });
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.error.code, "INVALID_VOLUME_PERCENT");
}

async function testPastePresetTextResolvesPresetAndPastes() {
  const runtime = configureTestRuntime({
    presetStore: { findPreset: (id) => (id === "preset-a" ? { id, name: "Preset A", text: "Saved text" } : null) },
  });
  const result = await flowExecutor.runAction({ id: "a1", type: "pc.pastePresetText", params: { presetId: "preset-a" } });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.clipboardWrites, ["Saved text"]);
  assert.strictEqual(runtime.execCalls.at(-1).file, "powershell.exe");
  assert.match(runtime.execCalls.at(-1).args.at(-1), /SendWait\('\^v'\)/);

  const missing = await flowExecutor.runAction({ id: "a2", type: "pc.pastePresetText", params: { presetId: "missing" } });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.error.code, "PRESET_NOT_FOUND");
}

async function testKeyboardSequenceExecutesInOrder() {
  const runtime = configureTestRuntime();
  const result = await flowExecutor.runAction({
    id: "a1",
    type: "pc.keyboardSequence",
    params: {
      steps: [
        { type: "combo", combination: "CTRL+L", delayAfterMs: 100 },
        { type: "text", text: "example.com", delayAfterMs: 0 },
        { type: "key", key: "ENTER", delayAfterMs: 0 },
      ],
    },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(runtime.execCalls.length, 3);
  assert.match(runtime.execCalls[0].args.at(-1), /SendWait\('\^l'\)/);
  assert.match(runtime.execCalls[1].args.at(-1), /example\.com/);
  assert.match(runtime.execCalls[2].args.at(-1), /SendWait\('\{ENTER\}'\)/);
  assert.deepStrictEqual(runtime.delays, [100]);
}

async function testOpenInBrowserAndOpenMultiple() {
  const runtime = configureTestRuntime();
  const opened = await flowExecutor.runAction({ id: "a1", type: "web.openInBrowser", params: { url: "example.com", browserId: "edge" } });
  assert.strictEqual(opened.success, true);
  assert.deepStrictEqual(runtime.spawnCalls[0], { file: "C:\\Browsers\\edge.exe", args: ["https://example.com/"] });

  const multiple = await flowExecutor.runAction({
    id: "a2",
    type: "web.openMultiple",
    params: { urls: ["example.com", "https://openai.com"], browserId: "default", delayMs: 25 },
  });
  assert.strictEqual(multiple.success, true);
  assert.deepStrictEqual(runtime.openedUrls, ["https://example.com/", "https://openai.com/"]);
  assert.deepStrictEqual(runtime.delays, [25]);

  const invalid = await flowExecutor.runAction({
    id: "a3",
    type: "web.openMultiple",
    params: { urls: ["example.com", "not a url"], browserId: "default" },
  });
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.error.code, "INVALID_URL");
  assert.deepStrictEqual(runtime.openedUrls, ["https://example.com/", "https://openai.com/"], "invalid URL lists must fail before opening anything");
}

async function testNoActionOrLogicNodeIsGated() {
  const store = {
    findFlow: () => ({
      id: "flow-if",
      name: "Flow If",
      enabled: true,
      nodes: [{ id: "n1", type: "if", condition: { type: "execution.last-action-succeeded" }, then: [], else: [] }],
    }),
  };
  configureTestRuntime({ flowStore: store, windowsAutomation: { run: async () => ({ percent: 50 }) } });
  flowExecutor.configureFlowExecutor({ flowStore: store });

  const action = await flowExecutor.runAction({ id: "a1", type: "pc.setVolume", params: { percent: 50 } });
  assert.strictEqual(action.success, true, "every implemented action must run without any plan check");
  const flow = await flowExecutor.runFlow("flow-if");
  assert.strictEqual(flow.success, true, "If / Else nodes must run without any plan check");
}

async function run() {
  await testRunActionExecutesImplementedAction();
  await testInvalidConfigFailsCleanly();
  await testUnknownActionFailsCleanly();
  await testUnavailableActionCannotExecute();
  await testWaitIsAsync();
  await testStopFlowStopsCurrentFlow();
  await testRunFlowPreventsRecursion();
  await testWindowActionsUseWindowsAutomation();
  await testWaitUntilAppOpensPollsUntilFound();
  await testSetVolumeUsesNativeHelper();
  await testPastePresetTextResolvesPresetAndPastes();
  await testKeyboardSequenceExecutesInOrder();
  await testOpenInBrowserAndOpenMultiple();
  await testNoActionOrLogicNodeIsGated();
  console.log("flow executor tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
