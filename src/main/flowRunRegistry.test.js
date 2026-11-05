const assert = require("assert");
const actionRegistry = require("./actionRegistry.js");
const flowExecutor = require("./flowExecutor.js");
const flowRunRegistry = require("./flowRunRegistry.js");

function flow(id, actionCount = 2) {
  return {
    id,
    name: id,
    enabled: true,
    actions: Array.from({ length: actionCount }, (_, index) => ({
      id: `${id}-a${index}`,
      type: "event.wait",
      params: { milliseconds: 10 },
    })),
  };
}

function configureStore(flows) {
  const store = { findFlow: (flowId) => flows[flowId] || null };
  flowExecutor.configureFlowExecutor({ flowStore: store });
  actionRegistry.configureActionRegistry({ flowStore: store });
  return store;
}

// Ein Flow braucht mindestens 2 Aktionen, damit man einen sauberen Stopp sieht:
// flowExecutor prüft das Abbruch-Signal nur zwischen den Nodes (checkCancellation in
// runNodeList), nie mitten in einer Aktion. Bricht man bei Aktion 1 von 2 ab, läuft
// Aktion 1 zu Ende und Aktion 2 startet nicht mehr. Genau das passiert auch bei einem
// Klick auf "Stop", weil sich eine laufende Aktion nicht unterbrechen lässt.

async function testStopAbortsARunningFlowCleanly() {
  configureStore({ "flow-a": flow("flow-a") });
  actionRegistry.configureActionRegistry({ delay: async () => flowRunRegistry.stopRun("flow-a") });

  const result = await flowRunRegistry.runFlowWithAbort("flow-a");
  assert.strictEqual(result.success, false, "a stopped flow should not report success");
  assert.strictEqual(result.error.code, "FLOW_CANCELLED", "stop should surface as a clean cancellation, not a generic action failure");
  assert.strictEqual(result.reason, "FLOW_CANCELLED");
  assert.strictEqual(result.actions.length, 1, "only the first action should have run before the stop took effect");
}

async function testFlowRunsNormallyAgainAfterBeingStopped() {
  configureStore({ "flow-a": flow("flow-a") });
  actionRegistry.configureActionRegistry({ delay: async () => {} });

  const result = await flowRunRegistry.runFlowWithAbort("flow-a");
  assert.strictEqual(result.success, true, "a fresh run of the same flow after a stop should complete normally");
  assert.strictEqual(result.actions.length, 2, "both actions should run when nothing stops the flow");
}

function testStoppingANonRunningFlowIsANoOp() {
  const outcome = flowRunRegistry.stopRun("flow-does-not-exist");
  assert.deepStrictEqual(outcome, { stopped: false });
}

async function testTwoDifferentFlowsRunIndependently() {
  configureStore({ "flow-a": flow("flow-a"), "flow-b": flow("flow-b") });
  // Jeder Delay-Aufruf stoppt gezielt flow-a, egal welcher Flow ihn auslöst.
  // Der Controller von flow-b darf davon nie berührt werden.
  actionRegistry.configureActionRegistry({ delay: async () => flowRunRegistry.stopRun("flow-a") });

  const [resultA, resultB] = await Promise.all([
    flowRunRegistry.runFlowWithAbort("flow-a"),
    flowRunRegistry.runFlowWithAbort("flow-b"),
  ]);

  assert.strictEqual(resultA.error.code, "FLOW_CANCELLED", "flow-a should be cancelled");
  assert.strictEqual(resultB.success, true, "flow-b must complete normally and not be affected by stopping flow-a");
  assert.strictEqual(resultB.actions.length, 2, "flow-b should run all of its own actions");
}

async function testConcurrentStartOfSameFlowIsRejectedWithoutOverwritingTheActiveRun() {
  configureStore({ "flow-a": flow("flow-a") });
  let releaseFirstAction;
  const firstActionBlocked = new Promise((resolve) => {
    releaseFirstAction = resolve;
  });
  actionRegistry.configureActionRegistry({ delay: () => firstActionBlocked });

  const firstRun = flowRunRegistry.runFlowWithAbort("flow-a");
  await Promise.resolve(); // den ersten Lauf bis zu seinem Delay kommen lassen
  await Promise.resolve();

  const secondRun = await flowRunRegistry.runFlowWithAbort("flow-a");
  assert.strictEqual(secondRun.success, false, "a second concurrent start of the same flow must be rejected");
  assert.strictEqual(secondRun.reason, "FLOW_ALREADY_RUNNING");

  releaseFirstAction();
  const firstResult = await firstRun;
  assert.strictEqual(firstResult.success, true, "the original run must complete normally, unaffected by the rejected second start");
}

async function run() {
  await testStopAbortsARunningFlowCleanly();
  await testFlowRunsNormallyAgainAfterBeingStopped();
  testStoppingANonRunningFlowIsANoOp();
  await testTwoDifferentFlowsRunIndependently();
  await testConcurrentStartOfSameFlowIsRejectedWithoutOverwritingTheActiveRun();
  console.log("flow run registry tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
