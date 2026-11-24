const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatbox', {
  onTitlebarShow: (callback) => ipcRenderer.on('titlebar:show', (_event, data) => callback(data)),
  onUrl: (callback) => ipcRenderer.on('titlebar:url', (_event, data) => callback(data)),
  onThemeUpdate: (callback) => ipcRenderer.on('theme:update', (_event, data) => callback(data)),
  closeTitlebar: () => ipcRenderer.send('titlebar:close'),
  navigate: (url) => ipcRenderer.send('titlebar:navigate', url),
  goBack: () => ipcRenderer.send('titlebar:back'),
  goForward: () => ipcRenderer.send('titlebar:forward'),
  reload: () => ipcRenderer.send('titlebar:reload'),
  goHome: () => ipcRenderer.send('titlebar:home'),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  dockedDragStart: (screenX, screenY) => ipcRenderer.send('titlebar:docked-drag-start', { screenX, screenY }),
  dockedDragEnd: () => ipcRenderer.send('titlebar:docked-drag-end')
});
