const crypto = require("crypto");
const { validateVariableName, validateVariableValue } = require("./variables.js");

const MAX_FLOW_NODE_DEPTH = 10;
const MAX_REPEAT_COUNT = 100;
const MAX_RANDOM_BRANCHES = 10;
const MIN_RANDOM_BRANCHES = 2;
const MAX_FLOW_NODE_COUNT = 5000;
const MAX_WAIT_UNTIL_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_WAIT_UNTIL_TIMEOUT_MS = 250;
const DEFAULT_WAIT_UNTIL_POLL_MS = 500;

const VARIABLE_CONDITION_TYPES = new Set([
  "variable.equals",
  "variable.not-equals",
  "variable.greater-than",
  "variable.greater-or-equal",
  "variable.less-than",
  "variable.less-or-equal",
  "variable.contains",
  "variable.is-true",
  "variable.is-false",
  "variable.exists",
]);
const VARIABLE_CONDITIONS_WITHOUT_COMPARE_VALUE = new Set(["variable.exists", "variable.is-true", "variable.is-false"]);
const NUMBER_ONLY_VARIABLE_CONDITIONS = new Set(["variable.greater-than", "variable.greater-or-equal", "variable.less-than", "variable.less-or-equal"]);
const EXECUTION_CONDITION_TYPES = new Set(["execution.last-action-succeeded", "execution.last-action-failed"]);

function createNodeId(prefix = "node") {
  return `${prefix}_${crypto.randomUUID()}`;
}

// Ältere Flows speichern eine flache Liste von Aktionen. Hier wird jede davon
// in einen action-Node umgewandelt.
function legacyActionToNode(action) {
  return {
    id: String(action.id || createNodeId("node")),
    type: "action",
    actionId: action.type || action.commandId,
    config: { ...(action.params || action.config || {}) },
  };
}

function nodeToLegacyAction(node) {
  if (!node || node.type !== "action") return null;
  return {
    id: node.id,
    type: node.actionId,
    params: { ...(node.config || {}) },
  };
}

function normalizeNodes(nodes, normalizeActionParams, depth = 0) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => normalizeNode(node, normalizeActionParams, depth)).filter(Boolean);
}

function normalizeNode(node, normalizeActionParams, depth = 0) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const id = String(node.id || createNodeId("node"));
  if (node.type === "action" || node.actionId) {
    const actionId = String(node.actionId || node.type || "");
    return {
      id,
      type: "action",
      actionId,
      config: normalizeActionParams(actionId, node.config || node.params || {}),
    };
  }
  if (node.type === "repeat") {
    return {
      id,
      type: "repeat",
      count: Number(node.count ?? node.config?.count ?? 1),
      children: normalizeNodes(node.children || node.actions || [], normalizeActionParams, depth + 1),
    };
  }
  if (node.type === "if") {
    return {
      id,
      type: "if",
      condition: normalizeCondition(node.condition || node.config?.condition || {}),
      then: normalizeNodes(node.then || node.children || [], normalizeActionParams, depth + 1),
      else: normalizeNodes(node.else || node.elseChildren || [], normalizeActionParams, depth + 1),
    };
  }
  if (node.type === "wait-until") {
    return {
      id,
      type: "wait-until",
      condition: normalizeCondition(node.condition || node.config?.condition || {}),
      timeoutMs: Number(node.timeoutMs ?? node.config?.timeoutMs ?? 30000),
      pollIntervalMs: Number(node.pollIntervalMs ?? node.config?.pollIntervalMs ?? DEFAULT_WAIT_UNTIL_POLL_MS),
    };
  }
  if (node.type === "delay-between-actions") {
    return {
      id,
      type: "delay-between-actions",
      delayMs: Number(node.delayMs ?? node.milliseconds ?? node.config?.delayMs ?? node.config?.milliseconds ?? 250),
      children: normalizeNodes(node.children || node.actions || [], normalizeActionParams, depth + 1),
    };
  }
  if (node.type === "run-after-delay") {
    return {
      id,
      type: "run-after-delay",
      delayMs: Number(node.delayMs ?? node.config?.delayMs ?? 5000),
      children: normalizeNodes(node.children || node.actions || [], normalizeActionParams, depth + 1),
    };
  }
  if (node.type === "random-choice") {
    const branches = Array.isArray(node.branches) ? node.branches : [node.optionA || [], node.optionB || []];
    return {
      id,
      type: "random-choice",
      branches: branches.map((branch) => normalizeNodes(branch, normalizeActionParams, depth + 1)),
    };
  }
  if (node.type === "try") {
    return {
      id,
      type: "try",
      children: normalizeNodes(node.children || [], normalizeActionParams, depth + 1),
      onError: normalizeNodes(node.onError || [], normalizeActionParams, depth + 1),
    };
  }
  if (node.type === "continue-on-error") {
    return {
      id,
      type: "continue-on-error",
      children: normalizeNodes(node.children || node.actions || [], normalizeActionParams, depth + 1),
    };
  }
  return { id, type: String(node.type || "unknown") };
}

function normalizeCondition(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return { type: "", target: {} };
  const type = String(condition.type || "");
  if (VARIABLE_CONDITION_TYPES.has(type)) return normalizeVariableCondition(type, condition);
  if (EXECUTION_CONDITION_TYPES.has(type)) return { type };
  const mappedType = type === "app.not-running" ? "app-not-running" : type;
  const target = condition.target && typeof condition.target === "object" && !Array.isArray(condition.target)
    ? condition.target
    : condition;
  return {
    type: String(mappedType || ""),
    target: {
      processName: typeof target.processName === "string" ? target.processName : "",
      executablePath: typeof target.executablePath === "string" ? target.executablePath : "",
      windowTitle: typeof target.windowTitle === "string" ? target.windowTitle : "",
      displayName: typeof target.displayName === "string" ? target.displayName : "",
    },
  };
}

function normalizeVariableCondition(type, condition) {
  const compareType = ["string", "number", "boolean"].includes(condition.compareType) ? condition.compareType : "string";
  return {
    type,
    variableName: typeof condition.variableName === "string" ? condition.variableName : "",
    compareType,
    compareValue: normalizeCompareValue(compareType, condition.compareValue),
  };
}

function normalizeCompareValue(compareType, value) {
  if (compareType === "number") {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  if (compareType === "boolean") return value === true || value === "true";
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : String(value);
}

function validateNodes(nodes, options = {}) {
  const errors = [];
  const seen = new Set();
  const stats = { nodeCount: 0 };
  if (!Array.isArray(nodes)) {
    return { valid: false, errors: [error("FLOW_NODES_INVALID", "Flow nodes must be an array.")] };
  }
  validateNodeList(nodes, { ...options, path: "nodes", depth: 0, seen, stats }, errors);
  if (stats.nodeCount > MAX_FLOW_NODE_COUNT) {
    errors.push(error("FLOW_NODE_LIMIT_EXCEEDED", `Flow cannot contain more than ${MAX_FLOW_NODE_COUNT} nodes.`));
  }
  return { valid: errors.length === 0, errors };
}

function validateNodeList(nodes, context, errors) {
  if (!Array.isArray(nodes)) {
    errors.push(error("NODE_CHILDREN_INVALID", `${context.path} must be an array.`, { path: context.path }));
    return;
  }
  if (context.depth > MAX_FLOW_NODE_DEPTH) {
    errors.push(error("FLOW_NODE_DEPTH_EXCEEDED", `Flow nesting depth cannot exceed ${MAX_FLOW_NODE_DEPTH}.`, { path: context.path }));
    return;
  }
  nodes.forEach((node, index) => validateNode(node, { ...context, path: `${context.path}.${index}` }, errors));
}

function validateNode(node, context, errors) {
  context.stats.nodeCount += 1;
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    errors.push(error("INVALID_NODE", "Flow node is malformed.", { path: context.path }));
    return;
  }
  if (typeof node.id !== "string" || node.id.trim() === "") {
    errors.push(error("NODE_ID_REQUIRED", "Flow node id is required.", { path: context.path }));
  } else if (context.seen.has(node.id)) {
    errors.push(error("DUPLICATE_NODE_ID", `Duplicate node id: ${node.id}.`, { nodeId: node.id, path: context.path }));
  } else {
    context.seen.add(node.id);
  }
  if (typeof node.type !== "string" || node.type.trim() === "") {
    errors.push(error("NODE_TYPE_REQUIRED", "Flow node type is required.", { nodeId: node.id, path: context.path }));
    return;
  }
  if (node.type === "action") {
    validateActionNode(node, context, errors);
    return;
  }
  if (node.type === "repeat") {
    if (!Number.isInteger(node.count) || node.count < 1 || node.count > MAX_REPEAT_COUNT) {
      errors.push(error("INVALID_REPEAT_COUNT", `Repeat count must be 1 through ${MAX_REPEAT_COUNT}.`, { nodeId: node.id, path: context.path }));
    }
    validateNodeList(node.children, childContext(context, "children"), errors);
    return;
  }
  if (node.type === "if") {
    validateCondition(node.condition, context, errors);
    validateNodeList(node.then, childContext(context, "then"), errors);
    validateNodeList(node.else, childContext(context, "else"), errors);
    return;
  }
  if (node.type === "wait-until") {
    validateCondition(node.condition, context, errors);
    validateWaitUntilTiming(node, context, errors);
    return;
  }
  if (node.type === "delay-between-actions" || node.type === "run-after-delay") {
    if (!Number.isInteger(node.delayMs) || node.delayMs < 0 || node.delayMs > MAX_WAIT_UNTIL_TIMEOUT_MS) {
      errors.push(error("INVALID_DELAY", "Delay must be 0ms through 600000ms.", { nodeId: node.id, path: context.path }));
    }
    validateNodeList(node.children, childContext(context, "children"), errors);
    return;
  }
  if (node.type === "random-choice") {
    if (!Array.isArray(node.branches) || node.branches.length < MIN_RANDOM_BRANCHES || node.branches.length > MAX_RANDOM_BRANCHES) {
      errors.push(error("INVALID_RANDOM_BRANCHES", `Random Choice needs ${MIN_RANDOM_BRANCHES} through ${MAX_RANDOM_BRANCHES} branches.`, { nodeId: node.id, path: context.path }));
      return;
    }
    node.branches.forEach((branch, index) => validateNodeList(branch, childContext(context, `branches.${index}`), errors));
    return;
  }
  if (node.type === "try") {
    validateNodeList(node.children, childContext(context, "children"), errors);
    validateNodeList(node.onError, childContext(context, "onError"), errors);
    return;
  }
  if (node.type === "continue-on-error") {
    validateNodeList(node.children, childContext(context, "children"), errors);
    return;
  }
  errors.push(error("UNKNOWN_NODE_TYPE", `Unknown Flow node type: ${node.type}.`, { nodeId: node.id, path: context.path }));
}

function validateActionNode(node, context, errors) {
  if (typeof node.actionId !== "string" || node.actionId.trim() === "") {
    errors.push(error("ACTION_TYPE_REQUIRED", "Action node actionId is required.", { nodeId: node.id, path: context.path }));
    return;
  }
  if (typeof context.validateAction === "function") {
    context.validateAction({ id: node.id, type: node.actionId, params: node.config || {} }, context.path).forEach((item) => errors.push(item));
  }
}

function validateWaitUntilTiming(node, context, errors) {
  if (!Number.isInteger(node.timeoutMs) || node.timeoutMs < MIN_WAIT_UNTIL_TIMEOUT_MS || node.timeoutMs > MAX_WAIT_UNTIL_TIMEOUT_MS) {
    errors.push(error("INVALID_WAIT_UNTIL_TIMEOUT", `Wait Until timeout must be ${MIN_WAIT_UNTIL_TIMEOUT_MS}ms through ${MAX_WAIT_UNTIL_TIMEOUT_MS}ms.`, { nodeId: node.id, path: context.path }));
  }
  if (!Number.isInteger(node.pollIntervalMs) || node.pollIntervalMs < 50 || node.pollIntervalMs > 5000) {
    errors.push(error("INVALID_WAIT_UNTIL_INTERVAL", "Wait Until poll interval must be 50ms through 5000ms.", { nodeId: node.id, path: context.path }));
  }
}

function validateCondition(condition, context, errors) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    errors.push(error("INVALID_CONDITION", "Condition is malformed.", { path: context.path }));
    return;
  }
  if (VARIABLE_CONDITION_TYPES.has(condition.type)) {
    validateVariableCondition(condition, context, errors);
    return;
  }
  if (EXECUTION_CONDITION_TYPES.has(condition.type)) return;
  if (!["app-running", "app-not-running"].includes(condition.type)) {
    errors.push(error("UNKNOWN_CONDITION_TYPE", "Condition type is not supported.", { path: context.path, type: condition.type }));
    return;
  }
  const target = condition.target || {};
  if (!target.processName && !target.executablePath && !target.windowTitle) {
    errors.push(error("APP_TARGET_REQUIRED", "Condition app target is required.", { path: context.path }));
  }
}

function validateVariableCondition(condition, context, errors) {
  const nameCheck = validateVariableName(condition.variableName);
  if (!nameCheck.valid) {
    errors.push(error(nameCheck.code, nameCheck.message, { path: context.path }));
  }
  if (VARIABLE_CONDITIONS_WITHOUT_COMPARE_VALUE.has(condition.type)) return;
  if (!["string", "number", "boolean"].includes(condition.compareType)) {
    errors.push(error("INVALID_COMPARE_TYPE", "Comparison type must be string, number, or boolean.", { path: context.path }));
    return;
  }
  if (condition.type === "variable.contains" && condition.compareType !== "string") {
    errors.push(error("INVALID_CONDITION_OPERATOR", "Contains requires a string comparison value.", { path: context.path }));
    return;
  }
  if (NUMBER_ONLY_VARIABLE_CONDITIONS.has(condition.type) && condition.compareType !== "number") {
    errors.push(error("INVALID_CONDITION_OPERATOR", "This comparison requires a number value.", { path: context.path }));
    return;
  }
  const valueCheck = validateVariableValue(condition.compareType, condition.compareValue);
  if (!valueCheck.valid) {
    errors.push(error(valueCheck.code, valueCheck.message, { path: context.path }));
  }
}

function childContext(context, suffix) {
  return { ...context, path: `${context.path}.${suffix}`, depth: context.depth + 1 };
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

module.exports = {
  DEFAULT_WAIT_UNTIL_POLL_MS,
  MAX_FLOW_NODE_COUNT,
  MAX_FLOW_NODE_DEPTH,
  MAX_RANDOM_BRANCHES,
  MAX_REPEAT_COUNT,
  MAX_WAIT_UNTIL_TIMEOUT_MS,
  MIN_RANDOM_BRANCHES,
  MIN_WAIT_UNTIL_TIMEOUT_MS,
  createNodeId,
  legacyActionToNode,
  nodeToLegacyAction,
  normalizeCondition,
  normalizeNodes,
  validateNodes,
};
