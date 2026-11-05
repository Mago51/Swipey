/**
 * Swipey - Electron Main Process
 *
 * Hier liegen das Fenster ohne Rahmen, der Tray, der Notfall-Hotkey und die
 * IPC-Brücke zum Renderer. Die Touchpad-Daten kommen vom Helper unter
 * native/touchpad (Raw Input / HID). Erkannt werden 2-Finger-Swipes in vier
 * Richtungen, die dann den zugewiesenen Flow starten.
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  Notification,
  nativeImage,
} = require("electron");
const path = require("path");
const flowStore = require("./src/main/flowStore.js");
const flowExecutor = require("./src/main/flowExecutor.js");
const flowRunRegistry = require("./src/main/flowRunRegistry.js");
const presetStore = require("./src/main/presetStore.js");
const keyManager = require("./src/main/keys/keyManager.js");
const swipeManager = require("./src/main/swipes/swipeManager.js");
const swipeModeManager = require("./src/main/swipes/swipeModeManager.js");
const touchpadManager = require("./src/main/touchpad/touchpadManager.js");

let mainWindow = null;
let tray = null;

const EMERGENCY_HOTKEY = "CommandOrControl+Alt+Shift+S";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    backgroundColor: "#f8f8fc",
    frame: false,
    title: "Swipey",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile("index.html");
  // Das Fenster lädt immer nur index.html. Popups und Navigation blocken wir komplett.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.on("maximize", () => mainWindow.webContents.send("window-state-changed", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-state-changed", { maximized: false }));

  // Schließen versteckt das Fenster nur, damit Keys und Swipes im Hintergrund weiterlaufen.
  // Beendet wird über das Tray-Menü oder den Close-Button (quitApp).
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  app.isQuitting = true;
  app.quit();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  if (icon.isEmpty()) console.warn("[tray] Tray icon could not be loaded.");
  tray = new Tray(icon);
  tray.setToolTip("Swipey");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Swipey", click: showMainWindow },
    { type: "separator" },
    { label: "Quit Swipey", click: quitApp },
  ]));
  tray.on("click", showMainWindow);
}

// Beim Beenden geben wir die Touchpad-Einstellungen wieder an Windows zurück.
// Falls das hängt, beenden wir nach ein paar Sekunden trotzdem.
const SHUTDOWN_TIMEOUT_MS = 10000;

async function shutdown() {
  keyManager.shutdownKeyManager();
  globalShortcut.unregisterAll();
  await touchpadManager.stopRuntime().catch((error) => console.warn("[touchpad] Runtime stop failed", error));
  await swipeModeManager.suspendSwipeMode().catch((error) => console.warn("[swipes] Restoring touchpad settings failed", error));
}

function registerEmergencyHotkey(accelerator = EMERGENCY_HOTKEY) {
  globalShortcut.unregisterAll();
  globalShortcut.register(accelerator, () => {
    touchpadManager.stopRuntime().catch((error) => console.warn("[touchpad] Emergency runtime stop failed", error));
    new Notification({
      title: "Swipey gestures paused",
      body: "Touchpad gesture recognition stopped. Pointer behavior is unchanged.",
    }).show();
  });
}

function registerDevelopmentDevToolsShortcut() {
  if (app.isPackaged) return;
  const registered = globalShortcut.register("Control+Shift+I", () => {
    mainWindow?.webContents.toggleDevTools();
  });
  if (!registered) console.warn("[devtools] Ctrl+Shift+I could not be registered.");
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("window-minimize", () => mainWindow.minimize());
ipcMain.handle("window-maximize-toggle", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window-close", quitApp);

// Fehler in den Handlern geben wir als { success: false } zurück,
// statt sie bis in den Renderer durchzureichen.
function safeIpc(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("[ipc]", error);
      return {
        success: false,
        error: {
          code: error.code || "IPC_ERROR",
          message: error.message || "Operation failed.",
          details: error.details || null,
        },
      };
    }
  };
}

ipcMain.handle("flows:list", safeIpc(() => ({ success: true, flows: flowStore.getFlows() })));
ipcMain.handle("flows:create", safeIpc((_event, flow) => flowStore.createFlow(flow).then((saved) => ({ success: true, flow: saved }))));
ipcMain.handle("flows:update", safeIpc((_event, flow) => flowStore.updateFlow(flow).then((saved) => ({ success: true, flow: saved }))));
ipcMain.handle("flows:delete", safeIpc(async (_event, flowId) => {
  // Erst die Trigger löschen, sonst zeigen Keys und Swipes auf einen Flow,
  // den es nicht mehr gibt.
  const removedKeyBindings = await keyManager.deleteBindingsForFlow(flowId);
  const removedSwipeBindings = await swipeManager.deleteBindingsForFlow(flowId);
  await flowStore.deleteFlow(flowId);
  return { success: true, removedKeyBindings, removedSwipeBindings };
}));
ipcMain.handle("flows:duplicate", safeIpc((_event, flowId) => flowStore.duplicateFlow(flowId).then((flow) => ({ success: true, flow }))));
ipcMain.handle("flows:set-enabled", safeIpc((_event, flowId, enabled) => flowStore.setFlowEnabled(flowId, enabled).then((flow) => ({ success: true, flow }))));
ipcMain.handle("flow-executor:run", safeIpc((_event, flowId) => flowRunRegistry.runFlowWithAbort(flowId)));
ipcMain.handle("flow-executor:stop", safeIpc((_event, flowId) => ({ success: true, ...flowRunRegistry.stopRun(flowId) })));

ipcMain.handle("presets:list", safeIpc(() => ({ success: true, presets: presetStore.listPresets() })));
ipcMain.handle("presets:create", safeIpc((_event, preset) => presetStore.createPreset(preset).then((saved) => ({ success: true, preset: saved }))));

ipcMain.handle("keys:list", safeIpc(() => ({ success: true, bindings: keyManager.listBindings() })));
ipcMain.handle("keys:create", safeIpc((_event, binding) => keyManager.createBinding(binding).then((saved) => ({ success: true, binding: saved }))));
ipcMain.handle("keys:update", safeIpc((_event, binding) => keyManager.updateBinding(binding).then((saved) => ({ success: true, binding: saved }))));
ipcMain.handle("keys:delete", safeIpc((_event, id) => keyManager.deleteBinding(id).then(() => ({ success: true }))));
ipcMain.handle("keys:set-enabled", safeIpc((_event, id, enabled) => keyManager.setEnabled(id, enabled).then((binding) => ({ success: true, binding }))));

ipcMain.handle("swipes:list", safeIpc(() => ({ success: true, bindings: swipeManager.listBindings() })));
ipcMain.handle("swipes:create", safeIpc((_event, binding) => swipeManager.createBinding(binding).then((saved) => ({ success: true, binding: saved }))));
ipcMain.handle("swipes:update", safeIpc((_event, binding) => swipeManager.updateBinding(binding).then((saved) => ({ success: true, binding: saved }))));
ipcMain.handle("swipes:delete", safeIpc((_event, id) => swipeManager.deleteBinding(id).then(() => ({ success: true }))));
ipcMain.handle("swipes:set-enabled", safeIpc((_event, id, enabled) => swipeManager.setEnabled(id, enabled).then((binding) => ({ success: true, binding }))));
ipcMain.handle("swipes:get-mode", safeIpc(() => swipeModeManager.getSwipeModeState().then((mode) => ({ success: true, mode }))));
ipcMain.handle("swipes:set-mode-enabled", safeIpc(async (_event, enabled) => {
  const result = await swipeModeManager.setSwipeModeEnabled(enabled);
  return { success: true, modeResult: result, enabled: result.enabled, windows: result.windows, state: result.state };
}));

// Eine zweite Instanz würde Hooks und Hotkeys doppelt registrieren.
// Stattdessen holen wir das schon laufende Fenster nach vorne.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(startApp);
}

async function startApp() {
  await flowStore.initializeFlowStore(app.getPath("userData"));
  await presetStore.initializePresetStore(app.getPath("userData"));
  keyManager.configureKeyManager({
    flowStore,
    flowExecutor,
    notifyRenderer: (channel, payload) => mainWindow?.webContents.send(channel, payload),
  });
  swipeManager.configureSwipeManager({
    flowStore,
    flowExecutor,
    notifyRenderer: (channel, payload) => mainWindow?.webContents.send(channel, payload),
    debug: !app.isPackaged,
    isSwipesEnabled: () => swipeModeManager.areSwipesEnabled(),
  });
  swipeModeManager.configureSwipeModeManager({
    notifyRenderer: (channel, payload) => mainWindow?.webContents.send(channel, payload),
    debug: !app.isPackaged,
  });
  touchpadManager.configureTouchpadManager({
    debug: !app.isPackaged,
    onGestureRecognized: (event) => swipeManager.handleGesture(event).catch((error) => console.error("[swipes] Gesture handling failed", error)),
  });

  createWindow();
  createTray();
  registerEmergencyHotkey();
  await keyManager.initializeKeyManager(app.getPath("userData"));
  await swipeManager.initializeSwipeManager(app.getPath("userData"));
  await swipeModeManager.initializeSwipeModeManager(app.getPath("userData"));
  await touchpadManager.startRuntime().catch((error) => {
    console.warn("[touchpad] Runtime start failed", error);
  });
  registerDevelopmentDevToolsShortcut();
}

let shutdownDone = false;

// Der erste Aufruf wird angehalten, bis shutdown() durch ist. Danach beenden wir wirklich.
app.on("before-quit", (event) => {
  app.isQuitting = true;
  if (shutdownDone) return;
  event.preventDefault();
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));
  Promise.race([shutdown(), timeout]).finally(() => {
    shutdownDone = true;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // Swipey läuft im Tray weiter, deshalb beenden wir hier nichts.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showMainWindow();
});
