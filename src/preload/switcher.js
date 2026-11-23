const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatbox', {
  onShow: (callback) => ipcRenderer.on('switcher:show', (_event, data) => callback(data)),
  onSites: (callback) => ipcRenderer.on('switcher:sites', (_event, data) => callback(data)),
  pick: (id) => ipcRenderer.send('switcher:pick', id),
  hide: () => ipcRenderer.send('switcher:hide')
});
