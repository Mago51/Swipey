const swipeStore = require("./swipeStore.js");
const { signatureForSwipe, validateBinding } = require("./swipeValidator.js");

let flowStore = null;
let flowExecutor = null;
let notifyRenderer = () => {};
let debugEnabled = false;
let isSwipesEnabled = () => true;

function configureSwipeManager(options = {}) {
  flowStore = options.flowStore;
  flowExecutor = options.flowExecutor;
  notifyRenderer = options.notifyRenderer || notifyRenderer;
  debugEnabled = !!options.debug;
  isSwipesEnabled = options.isSwipesEnabled || isSwipesEnabled;
}

async function initializeSwipeManager(userDataPath) {
  await swipeStore.initializeSwipeStore(userDataPath);
}

function listBindings() {
  return swipeStore.getBindings().map(withStatus);
}

async function createBinding(binding) {
  const saved = await swipeStore.createBinding(binding, contextFor(binding));
  return withStatus(saved);
}

async function updateBinding(binding) {
  const saved = await swipeStore.updateBinding(binding, contextFor(binding));
  return withStatus(saved);
}

async function deleteBinding(id) {
  return swipeStore.deleteBinding(id);
}

async function deleteBindingsForFlow(flowId) {
  return swipeStore.deleteBindingsForFlow(flowId);
}

async function setEnabled(id, enabled) {
  const existing = swipeStore.getBindings().find((binding) => binding.id === id);
  const saved = await swipeStore.setEnabled(id, enabled, contextFor({ ...existing, enabled }));
  return withStatus(saved);
}

async function handleGesture(event) {
  if (!event || event.type !== "gestureRecognized" || event.gesture !== "swipe") return null;
  // Unterstützt werden nur 2-Finger-Swipes.
  if (Number(event.fingers) !== 2) {
    debugLog(`gesture ignored because ${event.fingers}-finger swipes are unsupported`);
    return null;
  }
  // Ist der Swipe-Modus aus, passiert nichts, auch wenn es passende Bindings gibt.
  if (!isSwipesEnabled()) {
    debugLog("gesture ignored because master Swipes mode is off");
    return null;
  }
  const signature = signatureForSwipe(event);
  debugLog(`gesture received ${signature}`);
  debugLog(`generated signature ${signature}`);
  const binding = swipeStore.getBindings().find((item) => item.enabled && signatureForSwipe(item) === signature);
  if (!binding) {
    debugLog(`binding not found ${signature}`);
    return null;
  }
  debugLog(`binding found ${binding.id}`);
  debugLog(`flowId ${binding.flowId}`);
  const flow = flowStore?.findFlow?.(binding.flowId);
  if (!flow) {
    const result = failureResult(binding.flowId, "FLOW_NOT_FOUND", "Flow was not found.");
    debugLog("executor skipped FLOW_NOT_FOUND");
    emitFlowResult(binding, event, result);
    console.warn("[swipes] Triggered Flow missing", result);
    return result;
  }
  console.log(`[swipes] Triggered ${binding.displayName} -> ${binding.flowId}`);
  debugLog("executor started");
  const result = await flowExecutor.runFlow(binding.flowId);
  debugLog(result.success ? "executor success" : `executor failure ${result.reason || result.message || "unknown"}`);
  emitFlowResult(binding, event, result);
  if (!result.success) console.warn("[swipes] Triggered Flow failed", result);
  return result;
}

function emitFlowResult(binding, gesture, result) {
  debugLog("onFlowResult emitted");
  notifyRenderer("swipe-flow-result", { bindingId: binding.id, binding: withStatus(binding), gesture, result });
}

function withStatus(binding) {
  return { ...binding, ...registrationStatus(binding) };
}

function registrationStatus(binding) {
  const validation = validateBinding(binding, contextFor(binding));
  if (!validation.valid) {
    const first = validation.errors[0];
    return { status: statusForError(first.code), statusReason: first.message };
  }
  if (!binding.enabled) return { status: "disabled", statusReason: "" };
  return { status: "registered", statusReason: "" };
}

function statusForError(code) {
  if (code === "SWIPE_BINDING_CONFLICT") return "conflict";
  if (code === "MISSING_FLOW") return "missing-flow";
  if (code === "UNSUPPORTED_SWIPE") return "unsupported";
  return "error";
}

function contextFor(binding) {
  return {
    bindings: swipeStore.getBindings(),
    flowExists: !!flowStore?.findFlow?.(binding?.flowId),
  };
}

function failureResult(flowId, reason, message) {
  return {
    success: false,
    flowId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    reason,
    message,
    actions: [],
  };
}

function debugLog(message) {
  if (debugEnabled || process.env.SWIPEY_SWIPE_DEBUG === "1") console.log(`[swipe-debug] ${message}`);
}

module.exports = {
  configureSwipeManager,
  createBinding,
  deleteBinding,
  deleteBindingsForFlow,
  handleGesture,
  initializeSwipeManager,
  listBindings,
  setEnabled,
  updateBinding,
};
