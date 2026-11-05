const { canonicalizeInput } = require("./keyCanonicalizer.js");

const EMERGENCY_SIGNATURE = "ctrl+alt+shift:KeyS:standard";
const RESERVED_SIGNATURES = new Set(["ctrl+alt:Delete:standard"]);

function validateBinding(binding, context = {}) {
  const errors = [];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return { valid: false, errors: [error("INVALID_BINDING", "Key binding is malformed.")] };
  }
  if (typeof binding.id !== "string" || binding.id.trim() === "") errors.push(error("BINDING_ID_REQUIRED", "Key binding id is required."));
  if (binding.type !== "key") errors.push(error("BINDING_TYPE_INVALID", "Key binding type must be key."));
  if (typeof binding.flowId !== "string" || binding.flowId.trim() === "") errors.push(error("FLOW_ID_REQUIRED", "A Flow must be selected."));
  if (typeof binding.enabled !== "boolean") errors.push(error("BINDING_ENABLED_INVALID", "Enabled state must be boolean."));

  const canonical = canonicalizeInput(binding.input, binding.modifiers);
  if (!canonical.valid) errors.push(error(canonical.code, canonical.message));
  else {
    if (canonical.signature === EMERGENCY_SIGNATURE) errors.push(error("EMERGENCY_HOTKEY_RESERVED", "This shortcut is reserved as Swipey's emergency hotkey."));
    if (RESERVED_SIGNATURES.has(canonical.signature)) errors.push(error("RESERVED_WINDOWS_SHORTCUT", "This Windows shortcut cannot be assigned."));
    if (binding.enabled && context.bindings) {
      const conflict = context.bindings.find((item) => item.id !== binding.id && item.enabled && item.signature === canonical.signature);
      if (conflict) errors.push(error("KEY_BINDING_CONFLICT", `${canonical.displayName} is already assigned to another Flow.`, { conflictId: conflict.id }));
    }
    if (context.flowExists === false) errors.push(error("MISSING_FLOW", "The selected Flow no longer exists."));
  }

  return { valid: errors.length === 0, errors, canonical: canonical.valid ? canonical : null };
}

function error(code, message, details = {}) {
  return { code, message, ...details };
}

module.exports = {
  EMERGENCY_SIGNATURE,
  validateBinding,
};
