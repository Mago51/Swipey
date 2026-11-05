const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const RESERVED_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const MAX_STRING_LENGTH = 10000;
const TEMPLATE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,31})\s*\}\}/g;

function isValidVariableName(name) {
  return typeof name === "string" && NAME_PATTERN.test(name) && !RESERVED_NAMES.has(name);
}

function validateVariableName(name) {
  if (typeof name !== "string" || name.trim() === "") {
    return { valid: false, code: "VARIABLE_NAME_REQUIRED", message: "Variable name is required." };
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      valid: false,
      code: "INVALID_VARIABLE_NAME",
      message: "Variable name must start with a letter and contain only letters, numbers, and underscores (1-32 characters).",
    };
  }
  if (RESERVED_NAMES.has(name)) {
    return { valid: false, code: "RESERVED_VARIABLE_NAME", message: `"${name}" is a reserved name and cannot be used.` };
  }
  return { valid: true };
}

function validateVariableValue(valueType, value) {
  if (valueType === "string") {
    if (typeof value !== "string") return { valid: false, code: "INVALID_VARIABLE_VALUE", message: "Value must be a string." };
    if (value.length > MAX_STRING_LENGTH) {
      return { valid: false, code: "VARIABLE_STRING_TOO_LONG", message: `String value cannot exceed ${MAX_STRING_LENGTH} characters.` };
    }
    return { valid: true, value };
  }
  if (valueType === "number") {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return { valid: false, code: "INVALID_VARIABLE_VALUE", message: "Value must be a finite number." };
    return { valid: true, value: num };
  }
  if (valueType === "boolean") {
    if (typeof value === "boolean") return { valid: true, value };
    if (value === "true") return { valid: true, value: true };
    if (value === "false") return { valid: true, value: false };
    return { valid: false, code: "INVALID_VARIABLE_VALUE", message: "Value must be true or false." };
  }
  if (valueType === "null") {
    return { valid: true, value: null };
  }
  return { valid: false, code: "INVALID_VARIABLE_TYPE", message: "Variable type must be string, number, or boolean." };
}

// Variablen für genau einen Flow-Durchlauf. Eine Map, damit Namen wie "__proto__"
// oder "constructor" nie an Object.prototype herankommen.
class ExecutionVariables {
  constructor() {
    this._map = new Map();
  }

  has(name) {
    return this._map.has(name);
  }

  get(name) {
    return this._map.get(name);
  }

  set(name, value) {
    this._map.set(name, value);
  }

  names() {
    return [...this._map.keys()];
  }
}

// Ersetzt `{{name}}` durch den Wert der Variable. Es zählen nur exakte
// `{{name}}`-Platzhalter, keine Ausdrücke, kein Property-Zugriff, keine Verschachtelung.
function resolveTemplate(template, variables) {
  if (typeof template !== "string" || template.indexOf("{{") === -1) return template;
  let missingName = null;
  const resolved = template.replace(TEMPLATE_PATTERN, (match, name) => {
    if (missingName) return match;
    if (!variables || !variables.has(name)) {
      missingName = name;
      return match;
    }
    const value = variables.get(name);
    return value === null || value === undefined ? "" : String(value);
  });
  if (missingName) {
    const error = new Error(`Variable "${missingName}" was not found.`);
    error.code = "VARIABLE_NOT_FOUND";
    error.details = { variableName: missingName };
    throw error;
  }
  return resolved;
}

// Mit Platzhalter lässt sich ein Feld (z. B. eine URL) erst nach dem Ersetzen genau prüfen.
function hasTemplatePlaceholder(value) {
  if (typeof value !== "string") return false;
  TEMPLATE_PATTERN.lastIndex = 0;
  return TEMPLATE_PATTERN.test(value);
}

// Ersetzt Platzhalter nur in den Feldern, die die Aktion dafür freigegeben hat.
function resolveActionFields(params, fields, variables) {
  if (!Array.isArray(fields) || fields.length === 0) return params;
  const resolved = { ...params };
  for (const field of fields) {
    if (typeof resolved[field] === "string") resolved[field] = resolveTemplate(resolved[field], variables);
  }
  return resolved;
}

module.exports = {
  MAX_STRING_LENGTH,
  RESERVED_NAMES,
  ExecutionVariables,
  hasTemplatePlaceholder,
  isValidVariableName,
  resolveActionFields,
  resolveTemplate,
  validateVariableName,
  validateVariableValue,
};
