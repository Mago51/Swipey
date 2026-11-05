const { helperPath } = require("../nativeHelpers.js");
const { spawn } = require("child_process");
const readline = require("readline");

const helperExe = helperPath("Swipey.TouchpadProbe");
const eventThrottleMs = 33;

let helper = null;
let helperReadline = null;
let lastMoveEventAt = 0;

function isMonitorRunning() {
  return !!helper && !helper.killed;
}

async function listDevices() {
  const result = await runHelper(["enumerate"], 10000);
  const message = result.messages.find((item) => item.type === "deviceList");
  if (!message) throw structuredError("NATIVE_HELPER_FAILED", "Touchpad helper did not return a device list.");
  return message.devices || [];
}

function startMonitor({ onEvent, onExit } = {}) {
  if (isMonitorRunning()) throw structuredError("TOUCHPAD_MONITOR_ALREADY_RUNNING", "Touchpad monitor is already running.");
  // Der Helper ist eine eigenständige exe. In der Entwicklung muss sie vorher mit `npm run build:native` gebaut werden.
  helper = spawn(helperExe, ["monitor", "--raw-preview-limit", "80"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  helper.once("error", (error) => {
    onEvent?.({ type: "error", code: "NATIVE_HELPER_FAILED", message: error.message });
  });

  helper.once("exit", (code, signal) => {
    helper = null;
    helperReadline?.close();
    helperReadline = null;
    onExit?.({ code, signal });
  });

  helper.stderr.on("data", (chunk) => {
    const message = chunk.toString("utf8").trim();
    if (message) onEvent?.({ type: "error", code: "NATIVE_HELPER_STDERR", message });
  });

  helperReadline = readline.createInterface({ input: helper.stdout });
  helperReadline.on("line", (line) => {
    const parsed = parseJsonLine(line);
    if (!parsed) return;
    if (shouldForward(parsed)) onEvent?.(parsed);
  });
}

function stopMonitor() {
  if (!helper) return { stopped: false };
  const pid = helper.pid;
  helper.kill();
  helper = null;
  helperReadline?.close();
  helperReadline = null;
  return { stopped: true, pid };
}

// Rohdaten kommen sehr oft. Davon geben wir nur alle paar Millisekunden eins weiter,
// alle anderen Events (Kontakte, Fehler, ...) gehen immer durch.
function shouldForward(event) {
  if (event.type !== "mouseRaw" && event.type !== "hidRawFrame" && event.type !== "touchpadRawHidFrame") return true;
  const now = Date.now();
  if (now - lastMoveEventAt < eventThrottleMs) return false;
  lastMoveEventAt = now;
  return true;
}

function runHelper(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperExe, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const messages = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(structuredError("NATIVE_HELPER_TIMEOUT", "Touchpad helper timed out."));
    }, timeoutMs);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const parsed = parseJsonLine(line);
      if (parsed) messages.push(parsed);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(structuredError("NATIVE_HELPER_FAILED", error.message));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code && code !== 0) {
        reject(structuredError("NATIVE_HELPER_FAILED", stderr.trim() || `Touchpad helper exited with code ${code}.`));
        return;
      }
      resolve({ messages });
    });
  });
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (_error) {
    return null;
  }
}

function structuredError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  isMonitorRunning,
  listDevices,
  startMonitor,
  stopMonitor,
};
