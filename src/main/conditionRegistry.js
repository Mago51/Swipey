const { checkAppRunning } = require("./actionRegistry.js");

const conditionCatalog = {
  "app.running": {
    id: "app.running",
    category: "app",
    name: "App is running",
  },
  "app.not-running": {
    id: "app.not-running",
    category: "app",
    name: "App is not running",
  },
  "variable.equals": { id: "variable.equals", category: "variable", name: "Variable equals" },
  "variable.not-equals": { id: "variable.not-equals", category: "variable", name: "Variable does not equal" },
  "variable.greater-than": { id: "variable.greater-than", category: "variable", name: "Variable is greater than" },
  "variable.greater-or-equal": { id: "variable.greater-or-equal", category: "variable", name: "Variable is greater than or equal to" },
  "variable.less-than": { id: "variable.less-than", category: "variable", name: "Variable is less than" },
  "variable.less-or-equal": { id: "variable.less-or-equal", category: "variable", name: "Variable is less than or equal to" },
  "variable.contains": { id: "variable.contains", category: "variable", name: "Variable contains" },
  "variable.is-true": { id: "variable.is-true", category: "variable", name: "Variable is true" },
  "variable.is-false": { id: "variable.is-false", category: "variable", name: "Variable is false" },
  "variable.exists": { id: "variable.exists", category: "variable", name: "Variable exists" },
  "execution.last-action-succeeded": { id: "execution.last-action-succeeded", category: "execution", name: "Last action succeeded" },
  "execution.last-action-failed": { id: "execution.last-action-failed", category: "execution", name: "Last action failed" },
};

function normalizeConditionType(type) {
  if (type === "app.running") return "app-running";
  if (type === "app.not-running") return "app-not-running";
  return type;
}

async function evaluateCondition(condition, context = {}) {
  const type = normalizeConditionType(condition?.type);
  if (type === "app-running") return checkAppRunning(condition.target || {});
  if (type === "app-not-running") return !(await checkAppRunning(condition.target || {}));
  if (typeof type === "string" && type.startsWith("variable.")) return evaluateVariableCondition(condition, context);
  if (type === "execution.last-action-succeeded") return context.execution?.lastResult?.ok === true;
  if (type === "execution.last-action-failed") return context.execution?.lastResult != null && context.execution.lastResult.ok === false;
  const error = new Error("Condition type is not supported.");
  error.code = "UNKNOWN_CONDITION_TYPE";
  throw error;
}

function evaluateVariableCondition(condition, context) {
  const variables = context.execution?.variables;
  const name = condition.variableName;
  const exists = !!(variables && variables.has(name));
  if (condition.type === "variable.exists") return exists;
  if (!exists) throw variableNotFound(name);

  const actual = variables.get(name);
  if (condition.type === "variable.is-true") return requireType(actual, "boolean", name) === true;
  if (condition.type === "variable.is-false") return requireType(actual, "boolean", name) === false;

  const compareType = condition.compareType;
  const compareValue = condition.compareValue;
  requireType(actual, compareType, name);

  if (condition.type === "variable.equals") return actual === compareValue;
  if (condition.type === "variable.not-equals") return actual !== compareValue;
  if (condition.type === "variable.contains") return typeof actual === "string" && actual.includes(String(compareValue));
  if (condition.type === "variable.greater-than") return actual > compareValue;
  if (condition.type === "variable.greater-or-equal") return actual >= compareValue;
  if (condition.type === "variable.less-than") return actual < compareValue;
  if (condition.type === "variable.less-or-equal") return actual <= compareValue;

  const error = new Error("Condition type is not supported.");
  error.code = "UNKNOWN_CONDITION_TYPE";
  throw error;
}

function requireType(value, expectedType, name) {
  if (typeof value !== expectedType) {
    const error = new Error(`Variable "${name}" is not a ${expectedType}.`);
    error.code = "VARIABLE_TYPE_MISMATCH";
    error.details = { variableName: name, expectedType, actualType: typeof value };
    throw error;
  }
  return value;
}

function variableNotFound(name) {
  const error = new Error(`Variable "${name}" was not found.`);
  error.code = "VARIABLE_NOT_FOUND";
  error.details = { variableName: name };
  return error;
}

module.exports = {
  conditionCatalog,
  evaluateCondition,
  normalizeConditionType,
};
