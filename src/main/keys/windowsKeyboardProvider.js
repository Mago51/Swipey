const { helperPath } = require("../nativeHelpers.js");
const { spawn } = require("child_process");
const readline = require("readline");

const helperExe = helperPath("Swipey.KeyboardProbe");

let helper = null;
let helperReadline = null;

function isSupported() {
  return process.platform === "win32";
}

function isRunning() {
  return !!helper && !helper.killed;
}

function start({ codes, onEvent, onExit } = {}) {
  stop();
  if (!isSupported() || !Array.isArray(codes) || codes.length === 0) return { started: false };

  helper = spawn(helperExe, ["monitor", "--codes", codes.join(",")], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  helper.once("error", (error) => {
    onEvent?.({ type: "error", code: "KEYBOARD_HELPER_FAILED", message: error.message });
  });

  helper.once("exit", (code, signal) => {
    helper = null;
    helperReadline?.close();
    helperReadline = null;
    onExit?.({ code, signal });
  });

  helper.stderr.on("data", (chunk) => {
    const message = chunk.toString("utf8").trim();
    if (message) onEvent?.({ type: "error", code: "KEYBOARD_HELPER_STDERR", message });
  });

  helperReadline = readline.createInterface({ input: helper.stdout });
  helperReadline.on("line", (line) => {
    const parsed = parseJsonLine(line);
    if (parsed) onEvent?.(parsed);
  });

  return { started: true, path: helperExe };
}

function stop() {
  if (!helper) return { stopped: false };
  const pid = helper.pid;
  helper.kill();
  helper = null;
  helperReadline?.close();
  helperReadline = null;
  return { stopped: true, pid };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  helperPath: () => helperExe,
  isSupported,
  isRunning,
  start,
  stop,
};
