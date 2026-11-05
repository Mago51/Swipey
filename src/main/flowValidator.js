const { getActionDefinition } = require("./actionRegistry.js");
const { validateNodes } = require("./flowNodes.js");

function validateFlow(flow, options = {}) {
  const { validateParams = true, allowUnknown = false } = options;
  const errors = [];

  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    return { valid: false, errors: [error("INVALID_FLOW", "Flow is malformed.")] };
  }

  if (typeof flow.id !== "string" || flow.id.trim() === "") {
    errors.push(error("FLOW_ID_REQUIRED", "Flow id is required."));
  }
  if (typeof flow.name !== "string" || flow.name.trim() === "") {
    errors.push(error("FLOW_NAME_REQUIRED", "Flow name is required."));
  }
  if (typeof flow.enabled !== "boolean") {
    errors.push(error("FLOW_ENABLED_INVALID", "Flow enabled state must be boolean."));
  }
  if (Array.isArray(flow.nodes)) {
    const nodeValidation = validateNodes(flow.nodes, {
      validateAction: (action, path) => validateAction(action, 0, { validateParams, allowUnknown }).map((item) => ({ ...item, path })),
    });
    nodeValidation.errors.forEach((item) => errors.push(item));
  } else if (Array.isArray(flow.actions)) {
    flow.actions.forEach((action, index) => {
      validateAction(action, index, { validateParams, allowUnknown }).forEach((item) => errors.push(item));
    });
  } else {
    errors.push(error("FLOW_ACTIONS_INVALID", "Flow actions or nodes must be an array."));
  }

  return { valid: errors.length === 0, errors };
}

function validateAction(action, index = 0, options = {}) {
  const { validateParams = true, allowUnknown = false } = options;
  const errors = [];
  const prefix = `Action ${index + 1}`;

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return [error("INVALID_ACTION", `${prefix} is malformed.`, { index })];
  }
  if (typeof action.id !== "string" || action.id.trim() === "") {
    errors.push(error("ACTION_ID_REQUIRED", `${prefix} id is required.`, { index }));
  }
  if (typeof action.type !== "string" || action.type.trim() === "") {
    errors.push(error("ACTION_TYPE_REQUIRED", `${prefix} type is required.`, { index, actionId: action.id }));
    return errors;
  }

  const definition = getActionDefinition(action.type);
  if (!definition) {
    if (!allowUnknown) {
      errors.push(error("UNKNOWN_ACTION_TYPE", `${prefix} uses an unknown action type: ${action.type}.`, { index, actionId: action.id, type: action.type }));
    }
    return errors;
  }

  if (!validateParams) return errors;
  const params = action.params && typeof action.params === "object" && !Array.isArray(action.params) ? action.params : {};
  const validation = definition.validate(params);
  if (!validation.valid) {
    errors.push(error(validation.code, validation.message, { index, actionId: action.id, type: action.type }));
  }
  return errors;
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

module.exports = {
  validateAction,
  validateFlow,
};
