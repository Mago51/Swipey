const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const actionRegistry = require("./actionRegistry.js");
const flowExecutor = require("./flowExecutor.js");
const flowStore = require("./flowStore.js");
const { validateFlow } = require("./flowValidator.js");

function configureRuntime({ flows = {}, appRunningSequence = [true], delays = [], rng = () => 0 } = {}) {
  let conditionCalls = 0;
  const execCalls = [];
  const openedUrls = [];
  const store = {
    findFlow: (flowId) => flows[flowId] || null,
  };
  actionRegistry.configureActionRegistry({
    delay: async (milliseconds) => delays.push(milliseconds),
    execFile: (file, args, _options, callback) => {
      execCalls.push({ file, args });
      callback(null, "", "");
    },
    flowStore: store,
    shell: { openExternal: async (url) => openedUrls.push(url) },
    spawn: () => ({ once: (event, callback) => event === "spawn" && queueMicrotask(callback), unref: () => {} }),
    windowsAutomation: {
      run: async () => {
        const result = appRunningSequence[Math.min(conditionCalls, appRunningSequence.length - 1)];
        conditionCalls += 1;
        if (result) return { found: true };
        const error = new Error("not running");
        error.code = "APP_NOT_RUNNING";
        throw error;
      },
    },
  });
  flowExecutor.configureFlowExecutor({ flowStore: store, delay: async (milliseconds) => delays.push(milliseconds), rng });
  return { delays, execCalls, openedUrls };
}

function actionNode(id, actionId, config = {}) {
  return { id, type: "action", actionId, config };
}

function flow(id, nodes, enabled = true) {
  return { id, name: id, enabled, nodes };
}

async function testOldLinearFlowExecutes() {
  const flows = {
    a: { id: "a", name: "A", enabled: true, actions: [{ id: "old-1", type: "event.wait", params: { milliseconds: 10 } }] },
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("a");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.delays, [10]);
}

async function testStoredFlowMigrationPreservesActions() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swipey-flow-logic-"));
  try {
    await flowStore.initializeFlowStore(dir);
    const saved = await flowStore.createFlow({
      id: "legacy",
      name: "Legacy",
      enabled: true,
      actions: [{ id: "legacy-action", type: "event.wait", params: { milliseconds: 5 } }],
    });
    assert.strictEqual(saved.nodes[0].type, "action");
    assert.strictEqual(saved.nodes[0].actionId, "event.wait");
    assert.strictEqual(saved.actions[0].type, "event.wait");
    const raw = JSON.parse(await fs.readFile(path.join(dir, flowStore.STORAGE_FILE), "utf8"));
    assert.ok(raw.flows.find((item) => item.id === "legacy").nodes, "saved storage should use current nodes schema");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testRepeatCountsAndCancellation() {
  const flows = {
    repeat: flow("repeat", [{ id: "r1", type: "repeat", count: 3, children: [actionNode("a1", "event.wait", { milliseconds: 1 })] }]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("repeat");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.delays, [1, 1, 1]);

  const cancelled = await flowExecutor.runFlow("repeat", { signal: { aborted: true } });
  assert.strictEqual(cancelled.success, false);
  assert.strictEqual(cancelled.error.code, "FLOW_CANCELLED");
}

async function testIfElseConditions() {
  const baseNode = {
    id: "if1",
    type: "if",
    condition: { type: "app-running", target: { processName: "notepad.exe" } },
    then: [actionNode("then", "event.wait", { milliseconds: 10 })],
    else: [actionNode("else", "event.wait", { milliseconds: 20 })],
  };
  const thenRuntime = configureRuntime({ flows: { f: flow("f", [baseNode]) }, appRunningSequence: [true] });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(thenRuntime.delays, [10]);

  const elseRuntime = configureRuntime({ flows: { f: flow("f", [baseNode]) }, appRunningSequence: [false] });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(elseRuntime.delays, [20]);
}

async function testRunAnotherFlowRecursion() {
  const flows = {
    a: flow("a", [actionNode("run-b", "event.runFlow", { flowId: "b" })]),
    b: flow("b", [actionNode("wait-b", "event.wait", { milliseconds: 1 })]),
  };
  configureRuntime({ flows });
  const ok = await flowExecutor.runFlow("a");
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.actions.length, 2);

  const recursiveFlows = {
    a: flow("a", [actionNode("run-b", "event.runFlow", { flowId: "b" })]),
    b: flow("b", [actionNode("run-a", "event.runFlow", { flowId: "a" })]),
  };
  configureRuntime({ flows: recursiveFlows });
  const blocked = await flowExecutor.runFlow("a");
  assert.strictEqual(blocked.success, false);
  assert.strictEqual(blocked.error.code, "FLOW_RECURSION_DETECTED");
}

async function testWaitUntil() {
  const waitNode = {
    id: "wait-until",
    type: "wait-until",
    condition: { type: "app-running", target: { processName: "notepad.exe" } },
    timeoutMs: 1000,
    pollIntervalMs: 100,
  };
  const runtime = configureRuntime({ flows: { f: flow("f", [waitNode]) }, appRunningSequence: [false, false, true] });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.delays, [100, 100]);

  configureRuntime({ flows: { f: flow("f", [{ ...waitNode, timeoutMs: 250 }]) }, appRunningSequence: [false] });
  const timeout = await flowExecutor.runFlow("f");
  assert.strictEqual(timeout.success, false);
  assert.strictEqual(timeout.error.code, "WAIT_UNTIL_TIMEOUT");
}

async function testRandomChoice() {
  const node = {
    id: "random",
    type: "random-choice",
    branches: [
      [actionNode("one", "event.wait", { milliseconds: 1 })],
      [actionNode("two", "event.wait", { milliseconds: 2 })],
    ],
  };
  const runtime = configureRuntime({ flows: { f: flow("f", [node]) }, rng: () => 0.75 });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.delays, [2]);
}

function testStructuralValidation() {
  assert.strictEqual(validateFlow(flow("bad", [{ id: "r", type: "repeat", count: 0, children: [] }])).valid, false);
  assert.strictEqual(validateFlow(flow("bad", [{ id: "r", type: "repeat", count: 101, children: [] }])).valid, false);
  assert.strictEqual(validateFlow(flow("bad", [{ id: "x", type: "random-choice", branches: [[]] }])).valid, false);
  assert.strictEqual(validateFlow(flow("bad", [{ id: "x", type: "unknown" }])).valid, false);
  assert.strictEqual(validateFlow(flow("bad", [actionNode("dup", "event.wait", { milliseconds: 1 }), actionNode("dup", "event.wait", { milliseconds: 1 })])).valid, false);
}

async function testExecutionGuard() {
  const nested = {
    id: "outer",
    type: "repeat",
    count: 100,
    children: [{ id: "middle", type: "repeat", count: 100, children: [{ id: "inner", type: "repeat", count: 1, children: [] }] }],
  };
  configureRuntime({ flows: { f: flow("f", [nested]) } });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.code, "FLOW_NODE_LIMIT_EXCEEDED");
}

async function testSetIncrementDecrementVariable() {
  const flows = {
    f: flow("f", [
      actionNode("set", "event.setVariable", { name: "counter", valueType: "number", value: 10 }),
      actionNode("inc", "event.incrementVariable", { name: "counter", amount: 5 }),
      actionNode("dec", "event.decrementVariable", { name: "counter" }),
      actionNode("search", "web.searchGoogle", { query: "value is {{counter}}" }),
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.openedUrls, ["https://www.google.com/search?q=value%20is%2014"]);
}

async function testIncrementRejectsMissingOrNonNumber() {
  configureRuntime({
    flows: { f: flow("f", [actionNode("inc", "event.incrementVariable", { name: "ghost" })]) },
  });
  const missingResult = await flowExecutor.runFlow("f");
  assert.strictEqual(missingResult.success, false);
  assert.strictEqual(missingResult.error.code, "VARIABLE_NOT_FOUND");

  configureRuntime({
    flows: {
      f: flow("f", [
        actionNode("set", "event.setVariable", { name: "name", valueType: "string", value: "Swipey" }),
        actionNode("inc", "event.incrementVariable", { name: "name" }),
      ]),
    },
  });
  const typeResult = await flowExecutor.runFlow("f");
  assert.strictEqual(typeResult.success, false);
  assert.strictEqual(typeResult.error.code, "VARIABLE_NOT_NUMBER");
}

async function testVariableConditionInIf() {
  const node = {
    id: "if1",
    type: "if",
    condition: { type: "variable.greater-than", variableName: "score", compareType: "number", compareValue: 5 },
    then: [actionNode("high", "event.wait", { milliseconds: 1 })],
    else: [actionNode("low", "event.wait", { milliseconds: 2 })],
  };
  const highRuntime = configureRuntime({
    flows: { f: flow("f", [actionNode("set", "event.setVariable", { name: "score", valueType: "number", value: 10 }), node]) },
  });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(highRuntime.delays, [1]);

  const lowRuntime = configureRuntime({
    flows: { f: flow("f", [actionNode("set", "event.setVariable", { name: "score", valueType: "number", value: 1 }), node]) },
  });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(lowRuntime.delays, [2]);
}

async function testMissingVariableInTemplateFailsAction() {
  configureRuntime({ flows: { f: flow("f", [actionNode("say", "web.searchGoogle", { query: "hi {{ghost}}" })]) } });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.code, "VARIABLE_NOT_FOUND");
}

async function testTryOnErrorRunsFallback() {
  const flows = {
    f: flow("f", [
      { id: "try1", type: "try", children: [actionNode("bad", "event.incrementVariable", { name: "ghost" })], onError: [actionNode("fallback", "event.wait", { milliseconds: 7 })] },
      actionNode("after", "event.wait", { milliseconds: 9 }),
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true, "Try should catch the failure and let the Flow continue");
  assert.deepStrictEqual(runtime.delays, [7, 9]);
}

async function testTrySkipsOnErrorWhenSuccessful() {
  const flows = {
    f: flow("f", [
      { id: "try1", type: "try", children: [actionNode("ok", "event.wait", { milliseconds: 3 })], onError: [actionNode("fallback", "event.wait", { milliseconds: 99 })] },
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(runtime.delays, [3]);
}

async function testOnErrorFailurePropagates() {
  const flows = {
    f: flow("f", [
      { id: "try1", type: "try", children: [actionNode("bad", "event.incrementVariable", { name: "ghost" })], onError: [actionNode("alsobad", "event.incrementVariable", { name: "ghost2" })] },
    ]),
  };
  configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, false, "a failing On Error branch must fail the Flow");
  assert.strictEqual(result.error.code, "VARIABLE_NOT_FOUND");
}

async function testNestedTryAndTryInsideRepeat() {
  const flows = {
    f: flow("f", [
      {
        id: "repeat1",
        type: "repeat",
        count: 2,
        children: [
          { id: "try1", type: "try", children: [actionNode("bad", "event.incrementVariable", { name: "ghost" })], onError: [actionNode("fallback", "event.wait", { milliseconds: 1 })] },
        ],
      },
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true, "Try inside Repeat should catch each iteration's failure");
  assert.deepStrictEqual(runtime.delays, [1, 1]);
}

async function testContinueOnErrorRunsRemainingActions() {
  const flows = {
    f: flow("f", [
      {
        id: "coe1",
        type: "continue-on-error",
        children: [
          actionNode("bad", "event.incrementVariable", { name: "ghost" }),
          actionNode("good", "event.wait", { milliseconds: 5 }),
        ],
      },
      actionNode("after", "event.wait", { milliseconds: 6 }),
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true, "Continue On Error must not stop the Flow");
  assert.deepStrictEqual(runtime.delays, [5, 6]);
}

async function testFailureOutsideContinueOnErrorStopsFlow() {
  const flows = {
    f: flow("f", [
      actionNode("bad", "event.incrementVariable", { name: "ghost" }),
      actionNode("after", "event.wait", { milliseconds: 6 }),
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, false);
  assert.deepStrictEqual(runtime.delays, [], "a plain failing action must stop the Flow");
}

async function testStopFlowWithError() {
  configureRuntime({ flows: { f: flow("f", [actionNode("stop", "event.stopWithError", { message: "Custom failure" })]) } });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.code, "FLOW_STOPPED_WITH_ERROR");
  assert.strictEqual(result.error.message, "Custom failure");
}

async function testStopFlowWithErrorTemplatedMessage() {
  const flows = {
    f: flow("f", [
      actionNode("set", "event.setVariable", { name: "appName", valueType: "string", value: "Spotify" }),
      { id: "try1", type: "try", children: [actionNode("stop", "event.stopWithError", { message: "Could not open {{appName}}" })], onError: [actionNode("fallback", "event.wait", { milliseconds: 2 })] },
    ]),
  };
  const runtime = configureRuntime({ flows });
  const result = await flowExecutor.runFlow("f");
  assert.strictEqual(result.success, true, "Try should catch Stop Flow with Error");
  assert.deepStrictEqual(runtime.delays, [2]);
}

async function testLastActionResultConditions() {
  const succeededNode = {
    id: "if1",
    type: "if",
    condition: { type: "execution.last-action-succeeded" },
    then: [actionNode("yes", "event.wait", { milliseconds: 1 })],
    else: [actionNode("no", "event.wait", { milliseconds: 2 })],
  };
  const okRuntime = configureRuntime({
    flows: { f: flow("f", [actionNode("ok", "event.wait", { milliseconds: 0 }), succeededNode]) },
  });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(okRuntime.delays, [0, 1]);

  const failedNode = {
    id: "if2",
    type: "if",
    condition: { type: "execution.last-action-failed" },
    then: [actionNode("yes", "event.wait", { milliseconds: 3 })],
    else: [actionNode("no", "event.wait", { milliseconds: 4 })],
  };
  const failRuntime = configureRuntime({
    flows: {
      f: flow("f", [
        { id: "coe1", type: "continue-on-error", children: [actionNode("bad", "event.incrementVariable", { name: "ghost" })] },
        failedNode,
      ]),
    },
  });
  assert.strictEqual((await flowExecutor.runFlow("f")).success, true);
  assert.deepStrictEqual(failRuntime.delays, [3]);
}

async function testRunAnotherFlowSharesVariablesButIsolatesBetweenRuns() {
  const flows = {
    a: flow("a", [
      actionNode("set", "event.setVariable", { name: "project", valueType: "string", value: "Swipey" }),
      actionNode("run-b", "event.runFlow", { flowId: "b" }),
    ]),
    b: flow("b", [actionNode("search", "web.searchGoogle", { query: "{{project}}" })]),
  };
  const first = configureRuntime({ flows });
  const firstResult = await flowExecutor.runFlow("a");
  assert.strictEqual(firstResult.success, true);
  assert.deepStrictEqual(first.openedUrls, ["https://www.google.com/search?q=Swipey"]);

  const independentFlows = {
    b: flow("b", [actionNode("search", "web.searchGoogle", { query: "{{project}}" })]),
  };
  configureRuntime({ flows: independentFlows });
  const independentResult = await flowExecutor.runFlow("b");
  assert.strictEqual(independentResult.success, false, "a separate Flow run must not inherit variables from a prior run");
  assert.strictEqual(independentResult.error.code, "VARIABLE_NOT_FOUND");
}

async function run() {
  await testOldLinearFlowExecutes();
  await testStoredFlowMigrationPreservesActions();
  await testRepeatCountsAndCancellation();
  await testIfElseConditions();
  await testRunAnotherFlowRecursion();
  await testWaitUntil();
  await testRandomChoice();
  testStructuralValidation();
  await testExecutionGuard();
  await testSetIncrementDecrementVariable();
  await testIncrementRejectsMissingOrNonNumber();
  await testVariableConditionInIf();
  await testMissingVariableInTemplateFailsAction();
  await testTryOnErrorRunsFallback();
  await testTrySkipsOnErrorWhenSuccessful();
  await testOnErrorFailurePropagates();
  await testNestedTryAndTryInsideRepeat();
  await testContinueOnErrorRunsRemainingActions();
  await testFailureOutsideContinueOnErrorStopsFlow();
  await testStopFlowWithError();
  await testStopFlowWithErrorTemplatedMessage();
  await testLastActionResultConditions();
  await testRunAnotherFlowSharesVariablesButIsolatesBetweenRuns();
  console.log("flow logic tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
