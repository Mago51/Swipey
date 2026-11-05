const modifierOrder = ["ctrl", "alt", "shift", "win"];

const keyMap = {
  Backquote: { acceleratorKey: "`", displayName: "`" },
  Minus: { acceleratorKey: "-", displayName: "-" },
  Equal: { acceleratorKey: "=", displayName: "=" },
  BracketLeft: { acceleratorKey: "[", displayName: "[" },
  BracketRight: { acceleratorKey: "]", displayName: "]" },
  Backslash: { acceleratorKey: "\\", displayName: "\\" },
  Semicolon: { acceleratorKey: ";", displayName: ";" },
  Quote: { acceleratorKey: "'", displayName: "'" },
  Comma: { acceleratorKey: ",", displayName: "," },
  Period: { acceleratorKey: ".", displayName: "." },
  Slash: { acceleratorKey: "/", displayName: "/" },
  Space: { acceleratorKey: "Space", displayName: "Space", commonTyping: true },
  Tab: { acceleratorKey: "Tab", displayName: "Tab", commonTyping: true },
  Backspace: { acceleratorKey: "Backspace", displayName: "Backspace", commonTyping: true },
  Delete: { acceleratorKey: "Delete", displayName: "Delete" },
  Insert: { acceleratorKey: "Insert", displayName: "Insert" },
  Enter: { acceleratorKey: "Enter", displayName: "Enter", commonTyping: true },
  Escape: { acceleratorKey: "Escape", displayName: "Escape" },
  Home: { acceleratorKey: "Home", displayName: "Home" },
  End: { acceleratorKey: "End", displayName: "End" },
  PageUp: { acceleratorKey: "PageUp", displayName: "Page Up" },
  PageDown: { acceleratorKey: "PageDown", displayName: "Page Down" },
  ArrowUp: { acceleratorKey: "Up", displayName: "Arrow Up" },
  ArrowDown: { acceleratorKey: "Down", displayName: "Arrow Down" },
  ArrowLeft: { acceleratorKey: "Left", displayName: "Arrow Left" },
  ArrowRight: { acceleratorKey: "Right", displayName: "Arrow Right" },
  CapsLock: { acceleratorKey: "Capslock", displayName: "Caps Lock", commonTyping: true },
  Pause: { acceleratorKey: "Pause", displayName: "Pause" },
  NumLock: { acceleratorKey: "Numlock", displayName: "Num Lock" },
  ScrollLock: { acceleratorKey: "Scrolllock", displayName: "Scroll Lock" },
  NumpadAdd: { acceleratorKey: "numadd", displayName: "Numpad Add", location: "numpad" },
  NumpadSubtract: { acceleratorKey: "numsub", displayName: "Numpad Subtract", location: "numpad" },
  NumpadMultiply: { acceleratorKey: "nummult", displayName: "Numpad Multiply", location: "numpad" },
  NumpadDivide: { acceleratorKey: "numdiv", displayName: "Numpad Divide", location: "numpad" },
  NumpadDecimal: { acceleratorKey: "numdec", displayName: "Numpad Decimal", location: "numpad" },
  NumpadEnter: { acceleratorKey: "", displayName: "Numpad Enter", location: "numpad" },
};

for (let index = 0; index <= 9; index += 1) {
  keyMap[`Digit${index}`] = { acceleratorKey: String(index), displayName: String(index), commonTyping: true };
  keyMap[`Numpad${index}`] = { acceleratorKey: `num${index}`, displayName: `Numpad ${index}`, location: "numpad" };
}

for (let code = 65; code <= 90; code += 1) {
  const letter = String.fromCharCode(code);
  keyMap[`Key${letter}`] = { acceleratorKey: letter, displayName: letter, commonTyping: true };
}

for (let index = 1; index <= 24; index += 1) {
  keyMap[`F${index}`] = { acceleratorKey: `F${index}`, displayName: `F${index}` };
}

function canonicalizeInput(input, modifiers = {}) {
  if (!input || typeof input.code !== "string") {
    return { valid: false, code: "KEY_CODE_REQUIRED", message: "A physical key code is required." };
  }

  const mapped = keyMap[input.code];
  if (!mapped) {
    return { valid: false, code: "UNSUPPORTED_KEY", message: `${input.displayName || input.code} is not supported yet.` };
  }

  const normalizedModifiers = normalizeModifiers(modifiers);
  const location = mapped.location || normalizeLocation(input.location);
  const canonicalInput = {
    code: input.code,
    key: typeof input.key === "string" ? input.key : "",
    location,
    displayName: mapped.displayName,
    acceleratorKey: mapped.acceleratorKey,
  };
  const signature = `${modifierOrder.filter((name) => normalizedModifiers[name]).join("+") || "none"}:${canonicalInput.code}:${canonicalInput.location}`;
  const accelerator = mapped.acceleratorKey
    ? [...modifierOrder.filter((name) => normalizedModifiers[name]).map(modifierToAccelerator), mapped.acceleratorKey].join("+")
    : "";

  return {
    valid: true,
    input: canonicalInput,
    modifiers: normalizedModifiers,
    signature,
    accelerator,
    displayName: displayBinding(canonicalInput, normalizedModifiers),
    commonTyping: !!mapped.commonTyping && !modifierOrder.some((name) => normalizedModifiers[name]),
  };
}

function displayBinding(input, modifiers = {}) {
  return [...modifierOrder.filter((name) => modifiers[name]).map((name) => name.toUpperCase()), input.displayName].join(" + ");
}

function normalizeModifiers(modifiers = {}) {
  return {
    ctrl: !!modifiers.ctrl,
    alt: !!modifiers.alt,
    shift: !!modifiers.shift,
    win: !!modifiers.win,
    left: modifiers.left && typeof modifiers.left === "object" ? { ...modifiers.left } : {},
    right: modifiers.right && typeof modifiers.right === "object" ? { ...modifiers.right } : {},
  };
}

function normalizeLocation(location) {
  if (location === "numpad" || location === 3) return "numpad";
  if (location === "left" || location === 1) return "left";
  if (location === "right" || location === 2) return "right";
  return "standard";
}

function modifierToAccelerator(modifier) {
  if (modifier === "ctrl") return "Control";
  if (modifier === "alt") return "Alt";
  if (modifier === "shift") return "Shift";
  return "Super";
}

function isModifierCode(code) {
  return ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(code);
}

module.exports = {
  canonicalizeInput,
  displayBinding,
  isModifierCode,
};
