const crypto = require("crypto");
const { configureActionRegistry, getActionDefinition } = require("./actionRegistry.js");
const { evaluateCondition } = require("./conditionRegistry.js");
const { findFlow } = require("./flowStore.js");
const {
  MAX_FLOW_NODE_COUNT,
  MAX_FLOW_NODE_DEPTH,
  legacyActionToNode,
} = require("./flowNodes.js");
const { validateFlow } = require("./flowValidator.js");
const { ExecutionVariables, resolveActionFields } = require("./variables.js");

// Jeder Flow darf nur einmal gleichzeitig laufen.
const runningFlows = new Set();
const MAX_NESTED_FLOW_DEPTH = 10;
let flowStore = { findFlow };
let rng = Math.random;
let delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function configureFlowExecutor(options = {}) {
  if (options.flowStore && typeof options.flowStore.findFlow === "function") flowStore = options.flowStore;
  if (typeof options.rng === "function") rng = options.rng;
  if (typeof options.delay === "function") delay = options.delay;
}

async function runFlow(flowId, context = {}) {
  const executionId = context.executionId || `exec_${crypto.randomUUID()}`;
  const startedAt = nowIso();
  const ancestry = Array.isArray(context.ancestry) ? context.ancestry : [];
  const depth = Number.isInteger(context.depth) ? context.depth : 0;
  const flow = flowStore.findFlow(flowId);

  if (!flow) return failureResult({ executionId, flowId, startedAt, reason: "FLOW_NOT_FOUND", message: "Flow was not found." });
  if (!flow.enabled) return failureResult({ executionId, flowId, startedAt, reason: "FLOW_DISABLED", message: "Disabled Flows cannot run." });
  if (depth > MAX_NESTED_FLOW_DEPTH) {
    return failureResult({ executionId, flowId, startedAt, reason: "FLOW_NESTING_LIMIT_EXCEEDED", message: `Nested Flow depth cannot exceed ${MAX_NESTED_FLOW_DEPTH}.` });
  }
  // Ein Flow darf sich nicht selbst starten, auch nicht über andere Flows (A -> B -> A).
  if (ancestry.includes(flowId)) {
    return failureResult({ executionId, flowId, startedAt, reason: "FLOW_RECURSION_DETECTED", message: "Flow recursion was detected." });
  }
  if (runningFlows.has(flowId)) {
    return failureResult({ executionId, flowId, startedAt, reason: "FLOW_ALREADY_RUNNING", message: "This Flow is already running." });
  }

  const validation = validateFlow(flow);
  if (!validation.valid) {
    return failureResult({
      executionId,
      flowId,
      startedAt,
      reason: "FLOW_INVALID",
      message: validation.errors[0]?.message || "Flow is invalid.",
      validationErrors: validation.errors,
    });
  }

  const execution = context.execution || {
    executionId,
    signal: context.signal || null,
    executedNodeCount: 0,
    actions: [],
    variables: context.variables || new ExecutionVariables(),
    lastResult: null,
    lastError: null,
  };
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : (flow.actions || []).map(legacyActionToNode);
  runningFlows.add(flowId);
  console.log(`[flows] Flow started: ${flow.name} (${flow.id})`);

  try {
    const status = await runNodeList(nodes, {
      execution,
      currentFlowId: flow.id,
      ancestry: [...ancestry, flow.id],
      depth,
      nodeDepth: 0,
    });
    const finishedAt = nowIso();
    if (status.stopFlow) {
      console.log(`[flows] Flow stopped: ${flow.name} (${flow.id})`);
      return successResult({ executionId, flow, startedAt, finishedAt, actions: execution.actions, reason: "STOP_FLOW", message: "Flow stopped." });
    }
    console.log(`[flows] Flow finished: ${flow.name} (${flow.id})`);
    return successResult({ executionId, flow, startedAt, finishedAt, actions: execution.actions });
  } catch (error) {
    return flowFailureFromError({ error, executionId, flow, startedAt, actions: execution.actions });
  } finally {
    runningFlows.delete(flowId);
  }
}

async function runNodeList(nodes, context, scopedDelayMs = 0) {
  for (const [index, node] of nodes.entries()) {
    checkCancellation(context);
    const status = await runNode(node, context);
    if (status?.stopFlow) return status;
    if (index < nodes.length - 1 && scopedDelayMs > 0) await cancellableDelay(scopedDelayMs, context);
  }
  return {};
}

async function runNode(node, context) {
  checkExecutionGuard(context, node);
  if (context.nodeDepth > MAX_FLOW_NODE_DEPTH) throw structuredError("FLOW_NODE_DEPTH_EXCEEDED", `Flow nesting depth cannot exceed ${MAX_FLOW_NODE_DEPTH}.`, { nodeId: node.id });
  if (node.type === "action") return runActionNode(node, context);
  if (node.type === "repeat") return runRepeatNode(node, context);
  if (node.type === "if") return runIfNode(node, context);
  if (node.type === "wait-until") return runWaitUntilNode(node, context);
  if (node.type === "delay-between-actions") return runDelayBetweenActionsNode(node, context);
  if (node.type === "run-after-delay") return runAfterDelayNode(node, context);
  if (node.type === "random-choice") return runRandomChoiceNode(node, context);
  if (node.type === "try") return runTryNode(node, context);
  if (node.type === "continue-on-error") return runContinueOnErrorNode(node, context);
  throw structuredError("UNKNOWN_NODE_TYPE", `Unknown Flow node type: ${node.type}.`, { nodeId: node.id });
}

async function runActionNode(node, context) {
  const result = await runAction(
    { id: node.id, type: node.actionId, params: node.config || {} },
    {
      executionId: context.execution.executionId,
      currentFlowId: context.currentFlowId,
      ancestry: context.ancestry,
      depth: context.depth,
      execution: context.execution,
      signal: context.execution.signal,
    }
  );
  result.nodeId = node.id;
  context.execution.actions.push(result);
  context.execution.lastResult = {
    ok: result.success,
    code: result.success ? null : result.error.code,
    actionId: node.actionId,
    nodeId: node.id,
  };
  if (Array.isArray(result.details?.nestedResult?.actions)) {
    result.details.nestedResult.actions.forEach((nestedAction) => context.execution.actions.push({ ...nestedAction, parentNodeId: node.id }));
  }
  if (!result.success) {
    context.execution.lastError = { code: result.error.code, message: result.error.message, actionId: node.actionId, nodeId: node.id };
    throw structuredError(result.error.code, result.error.message, { ...(result.error.details || {}), nodeId: node.id, actionId: node.actionId });
  }
  if (result.details?.stopFlow) return { stopFlow: true };
  return {};
}

async function runRepeatNode(node, context) {
  for (let iteration = 0; iteration < node.count; iteration += 1) {
    checkCancellation(context);
    const status = await runNodeList(node.children || [], childContext(context));
    if (status?.stopFlow) return status;
  }
  return {};
}

async function runIfNode(node, context) {
  const matched = await evaluateCondition(node.condition, context);
  return runNodeList(matched ? node.then || [] : node.else || [], childContext(context));
}

async function runWaitUntilNode(node, context) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= node.timeoutMs) {
    checkCancellation(context);
    if (await evaluateCondition(node.condition, context)) return {};
    await cancellableDelay(node.pollIntervalMs, context);
  }
  throw structuredError("WAIT_UNTIL_TIMEOUT", "Condition did not become true before the timeout.", { nodeId: node.id });
}

async function runTryNode(node, context) {
  try {
    const status = await runNodeList(node.children || [], childContext(context));
    if (status?.stopFlow) return status;
    return {};
  } catch (error) {
    context.execution.lastError = errorToLastError(error);
    return runNodeList(node.onError || [], childContext(context));
  }
}

async function runContinueOnErrorNode(node, context) {
  for (const child of node.children || []) {
    checkCancellation(context);
    try {
      const status = await runNode(child, childContext(context));
      if (status?.stopFlow) return status;
    } catch (error) {
      context.execution.lastError = errorToLastError(error);
    }
  }
  return {};
}

function errorToLastError(error) {
  return {
    code: error.code || "ACTION_ERROR",
    message: error.message || "Action failed.",
    nodeId: error.details?.nodeId || null,
    actionId: error.details?.actionId || null,
  };
}

async function runDelayBetweenActionsNode(node, context) {
  return runNodeList(node.children || [], childContext(context), node.delayMs);
}

async function runAfterDelayNode(node, context) {
  await cancellableDelay(node.delayMs, context);
  return runNodeList(node.children || [], childContext(context));
}

async function runRandomChoiceNode(node, context) {
  const branchIndex = Math.min(node.branches.length - 1, Math.floor(rng() * node.branches.length));
  return runNodeList(node.branches[branchIndex] || [], childContext(context));
}

async function runAction(action, context = {}) {
  const startedAt = nowIso();
  const startMs = Date.now();
  const definition = getActionDefinition(action.type);

  if (!definition) {
    return actionFailure(action, startedAt, startMs, "UNKNOWN_ACTION_TYPE", `Unknown action type: ${action.type}.`);
  }

  console.log(`[flows] Action started: ${action.type} (${action.id})`);
  if (definition.executable === false) {
    return actionFailure(action, startedAt, startMs, "ACTION_UNAVAILABLE", definition.unavailableReason || `${definition.label} is not available yet.`);
  }

  let resolvedAction = action;
  if (Array.isArray(definition.templatableFields) && definition.templatableFields.length > 0) {
    try {
      const resolvedParams = resolveActionFields(action.params || {}, definition.templatableFields, context.execution?.variables);
      resolvedAction = { ...action, params: resolvedParams };
    } catch (templateError) {
      return actionFailure(action, startedAt, startMs, templateError.code || "VARIABLE_NOT_FOUND", templateError.message);
    }
  }

  const validation = definition.validate(resolvedAction.params || {}, context);
  if (!validation.valid) {
    return actionFailure(resolvedAction, startedAt, startMs, validation.code, validation.message);
  }

  try {
    const details = await definition.execute(resolvedAction, context);
    console.log(`[flows] Action succeeded: ${action.type} (${action.id})`);
    const result = {
      actionId: action.id,
      type: action.type,
      success: true,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startMs,
    };
    if (details) result.details = details;
    return result;
  } catch (error) {
    return actionFailure(resolvedAction, startedAt, startMs, error.code || "ACTION_ERROR", readableError(error), error.details || null);
  }
}

function checkExecutionGuard(context, node) {
  context.execution.executedNodeCount += 1;
  // Schutz vor Endlosläufen, zum Beispiel bei verschachtelten Repeats.
  if (context.execution.executedNodeCount > MAX_FLOW_NODE_COUNT) {
    throw structuredError("FLOW_NODE_LIMIT_EXCEEDED", `Flow execution cannot exceed ${MAX_FLOW_NODE_COUNT} nodes.`, { nodeId: node.id });
  }
  checkCancellation(context);
}

// Abbrechen können wir nur zwischen den Nodes. Eine Aktion, die schon läuft,
// lässt sich nicht mittendrin stoppen.
function checkCancellation(context) {
  if (context.execution.signal?.aborted) throw structuredError("FLOW_CANCELLED", "Flow execution was cancelled.", { reason: "FLOW_CANCELLED" });
}

async function cancellableDelay(milliseconds, context) {
  checkCancellation(context);
  await delay(milliseconds);
  checkCancellation(context);
}

function childContext(context) {
  return { ...context, nodeDepth: context.nodeDepth + 1 };
}

function actionFailure(action, startedAt, startMs, code, message, details = null) {
  const result = {
    actionId: action.id,
    type: action.type,
    success: false,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startMs,
    error: { code, message },
  };
  if (details) result.error.details = details;
  return result;
}

function failureResult({ executionId, flowId, startedAt, reason, message, validationErrors = [] }) {
  return {
    success: false,
    executionId,
    flowId,
    startedAt,
    finishedAt: nowIso(),
    reason,
    message,
    validationErrors,
    actions: [],
  };
}

function successResult({ executionId, flow, startedAt, finishedAt, actions, reason = null, message = null }) {
  const result = {
    success: true,
    executionId,
    flowId: flow.id,
    flowName: flow.name,
    startedAt,
    finishedAt,
    actions,
  };
  if (reason) result.reason = reason;
  if (message) result.message = message;
  return result;
}

function flowFailureFromError({ error, executionId, flow, startedAt, actions }) {
  const details = error.details || {};
  const failedAction = actions.find((action) => action.nodeId === details.nodeId || action.actionId === details.actionId);
  console.warn(`[flows] Flow failed: ${flow.name} (${flow.id}) ${error.message || ""}`);
  return {
    success: false,
    executionId,
    flowId: flow.id,
    flowName: flow.name,
    startedAt,
    finishedAt: nowIso(),
    reason: details.reason || "ACTION_FAILED",
    failedNodeId: details.nodeId || null,
    failedActionId: failedAction?.actionId || details.actionId || null,
    failedActionType: failedAction?.type || null,
    message: error.message || "Flow failed.",
    actions,
    error: {
      code: error.code || "FLOW_ERROR",
      message: error.message || "Flow failed.",
      details,
    },
  };
}

function readableError(error) {
  if (!error) return "Action failed.";
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return "Action failed.";
}

function structuredError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  MAX_NESTED_FLOW_DEPTH,
  configureFlowExecutor,
  runAction,
  runFlow,
};

configureActionRegistry({ runFlow });
