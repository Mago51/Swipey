const windowsProvider = require("./windowsTouchpadProvider.js");
const { GestureRecognizer } = require("./gestureRecognizer.js");

let onGestureRecognized = () => {};
let timestampFrequency = 10000000;
let debugEnabled = false;
const gestureRecognizer = new GestureRecognizer();

function configureTouchpadManager(options = {}) {
  onGestureRecognized = options.onGestureRecognized || onGestureRecognized;
  debugEnabled = !!options.debug;
}

async function startRuntime() {
  // Schlägt fehl, wenn der Helper nicht gebaut ist. So merken wir das gleich beim Start.
  await windowsProvider.listDevices();
  if (windowsProvider.isMonitorRunning()) return;
  windowsProvider.startMonitor({
    onEvent: handleRuntimeEvent,
    onExit: () => gestureRecognizer.reset(),
  });
  debugLog("runtime monitor started");
}

async function stopRuntime() {
  const result = windowsProvider.stopMonitor();
  gestureRecognizer.reset();
  return result;
}

function handleRuntimeEvent(event) {
  if (event.type === "diagnosticStarted" || event.type === "deviceChanged") {
    if (event.timestampFrequency) timestampFrequency = event.timestampFrequency;
    if (event.type === "diagnosticStarted") gestureRecognizer.reset();
  }
  if (event.type === "touchpadFrame") recognizeGestures(event);
}

function recognizeGestures(event) {
  const results = gestureRecognizer.processEvent({ ...event, timestampFrequency });
  for (const result of results) {
    if (result.type !== "gestureRecognized") continue;
    console.log(`[gesture] ${result.fingers}-finger swipe ${result.direction} distance=${result.distance} duration=${result.durationMs}ms`);
    debugLog(`gestureRecognized emit ${result.fingers}:${result.direction}`);
    onGestureRecognized(result);
  }
}

function debugLog(message) {
  if (debugEnabled || process.env.SWIPEY_SWIPE_DEBUG === "1") console.log(`[swipe-debug] ${message}`);
}

module.exports = {
  configureTouchpadManager,
  startRuntime,
  stopRuntime,
};
