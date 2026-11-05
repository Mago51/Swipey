const SUPPORTED_FINGERS = new Set([2]);
const SUPPORTED_DIRECTIONS = new Set(["left", "right", "up", "down"]);

function signatureForSwipe(binding) {
  return `${Number(binding?.fingers)}:${String(binding?.direction || "").toLowerCase()}`;
}

function validateBinding(binding, context = {}) {
  const errors = [];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return { valid: false, errors: [error("INVALID_BINDING", "Swipe binding is malformed.")] };
  }
  if (typeof binding.id !== "string" || binding.id.trim() === "") errors.push(error("BINDING_ID_REQUIRED", "Swipe binding id is required."));
  if (binding.type !== "swipe") errors.push(error("BINDING_TYPE_INVALID", "Swipe binding type must be swipe."));
  if (!SUPPORTED_FINGERS.has(Number(binding.fingers))) errors.push(error("UNSUPPORTED_SWIPE", "Choose 2 fingers."));
  if (!SUPPORTED_DIRECTIONS.has(String(binding.direction || "").toLowerCase())) errors.push(error("UNSUPPORTED_SWIPE", "Swipe direction must be left, right, up, or down."));
  if (typeof binding.flowId !== "string" || binding.flowId.trim() === "") errors.push(error("FLOW_ID_REQUIRED", "A Flow must be selected."));
  if (typeof binding.enabled !== "boolean") errors.push(error("BINDING_ENABLED_INVALID", "Enabled state must be boolean."));

  if (context.flowExists === false) errors.push(error("MISSING_FLOW", "The selected Flow no longer exists."));
  if (context.bindings) {
    const signature = signatureForSwipe(binding);
    const conflict = context.bindings.find((item) => item.id !== binding.id && signatureForSwipe(item) === signature);
    if (conflict) errors.push(error("SWIPE_BINDING_CONFLICT", `${displaySwipe(binding)} is already assigned to another Flow.`, { conflictId: conflict.id }));
  }

  return { valid: errors.length === 0, errors };
}

function displaySwipe(binding) {
  const fingers = Number(binding?.fingers);
  const direction = String(binding?.direction || "").toLowerCase();
  return `${fingers} Fingers - Swipe ${capitalize(direction)}`;
}

function normalizeDirection(direction) {
  return String(direction || "").toLowerCase();
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

module.exports = {
  SUPPORTED_DIRECTIONS,
  SUPPORTED_FINGERS,
  displaySwipe,
  normalizeDirection,
  signatureForSwipe,
  validateBinding,
};
