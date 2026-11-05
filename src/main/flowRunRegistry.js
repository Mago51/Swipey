const flowExecutor = require("./flowExecutor.js");

// Ein AbortController pro laufendem Flow. Derselbe Flow kann nicht zweimal gleichzeitig
// laufen (das verhindert schon flowExecutor mit FLOW_ALREADY_RUNNING), deshalb reicht
// ein Controller pro flowId. Verschiedene Flows stören sich nicht gegenseitig.
const activeControllers = new Map();

async function runFlowWithAbort(flowId, extraContext = {}) {
  if (activeControllers.has(flowId)) {
    return {
      success: false,
      flowId,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      reason: "FLOW_ALREADY_RUNNING",
      message: "This Flow is already running.",
      actions: [],
    };
  }
  const controller = new AbortController();
  activeControllers.set(flowId, controller);
  try {
    return await flowExecutor.runFlow(flowId, { ...extraContext, signal: controller.signal });
  } finally {
    activeControllers.delete(flowId);
  }
}

function stopRun(flowId) {
  const controller = activeControllers.get(flowId);
  if (!controller) return { stopped: false };
  controller.abort();
  return { stopped: true };
}

function isRunning(flowId) {
  return activeControllers.has(flowId);
}

module.exports = {
  runFlowWithAbort,
  stopRun,
  isRunning,
};
