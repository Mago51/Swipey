const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("swipey", {
  // Eigene Fensterleiste
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("window-maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  onWindowStateChanged: (cb) => ipcRenderer.on("window-state-changed", (_e, s) => cb(s)),

  // Gespeicherte Flows
  flows: {
    list: () => ipcRenderer.invoke("flows:list"),
    create: (flow) => ipcRenderer.invoke("flows:create", flow),
    update: (flow) => ipcRenderer.invoke("flows:update", flow),
    delete: (flowId) => ipcRenderer.invoke("flows:delete", flowId),
    duplicate: (flowId) => ipcRenderer.invoke("flows:duplicate", flowId),
    setEnabled: (flowId, enabled) => ipcRenderer.invoke("flows:set-enabled", flowId, enabled),
  },

  // Der Renderer darf nur gespeicherte Flows starten, keine einzelnen Aktionen.
  flowExecutor: {
    run: (flowId) => ipcRenderer.invoke("flow-executor:run", flowId),
    stop: (flowId) => ipcRenderer.invoke("flow-executor:stop", flowId),
  },

  presets: {
    list: () => ipcRenderer.invoke("presets:list"),
    create: (preset) => ipcRenderer.invoke("presets:create", preset),
  },

  keys: {
    list: () => ipcRenderer.invoke("keys:list"),
    create: (binding) => ipcRenderer.invoke("keys:create", binding),
    update: (binding) => ipcRenderer.invoke("keys:update", binding),
    delete: (id) => ipcRenderer.invoke("keys:delete", id),
    setEnabled: (id, enabled) => ipcRenderer.invoke("keys:set-enabled", id, enabled),
    onFlowResult: (cb) => ipcRenderer.on("key-flow-result", (_event, payload) => cb(payload)),
  },

  swipes: {
    list: () => ipcRenderer.invoke("swipes:list"),
    create: (binding) => ipcRenderer.invoke("swipes:create", binding),
    update: (binding) => ipcRenderer.invoke("swipes:update", binding),
    delete: (id) => ipcRenderer.invoke("swipes:delete", id),
    setEnabled: (id, enabled) => ipcRenderer.invoke("swipes:set-enabled", id, enabled),
    getMode: () => ipcRenderer.invoke("swipes:get-mode"),
    setModeEnabled: (enabled) => ipcRenderer.invoke("swipes:set-mode-enabled", enabled),
    onModeChanged: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on("swipes:mode-changed", listener);
      return () => ipcRenderer.removeListener("swipes:mode-changed", listener);
    },
    onFlowResult: (cb) => ipcRenderer.on("swipe-flow-result", (_event, payload) => cb(payload)),
  },
});
