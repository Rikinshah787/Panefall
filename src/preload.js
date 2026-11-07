// Bridges the main process into Panefall's pages as `window.panefall`.
// Overlays use the on* listeners; the Control Center also reads state and sends changes.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('panefall', {
  // overlays
  onDisplay: listen('panefall:display'),
  onSettings: listen('panefall:settings'),
  onWindows: listen('panefall:windows'),
  onCommand: listen('panefall:command'),
  onPointer: listen('panefall:pointer'),
  onSound: listen('panefall:sound'),
  onPanelShown: listen('panefall:panel-shown'),
  onPlay: listen('panefall:play'),
  // Control Center
  getState: () => ipcRenderer.invoke('panefall:getState'),
  update: (patch) => ipcRenderer.invoke('panefall:update', patch),
  command: (name, arg) => ipcRenderer.invoke('panefall:command', name, arg),
  searchPlaces: (query) => ipcRenderer.invoke('panefall:searchPlaces', query),
  onState: listen('panefall:state'),
});
