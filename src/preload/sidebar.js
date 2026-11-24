const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatbox', {
  onInit: (callback) => ipcRenderer.on('init', (_event, data) => callback(data)),
  onActive: (callback) => ipcRenderer.on('site:active', (_event, data) => callback(data)),
  onUnread: (callback) => ipcRenderer.on('site:unread', (_event, data) => callback(data)),
  onHotkeysUpdate: (callback) => ipcRenderer.on('hotkeys:update', (_event, data) => callback(data)),
  onSitesUpdate: (callback) => ipcRenderer.on('sites:update', (_event, data) => callback(data)),
  onOpened: (callback) => ipcRenderer.on('sites:opened', (_event, data) => callback(data)),
  onAccentUpdate: (callback) => ipcRenderer.on('accent:update', (_event, data) => callback(data)),
  onThemeUpdate: (callback) => ipcRenderer.on('theme:update', (_event, data) => callback(data)),
  activate: (id) => ipcRenderer.send('site:activate', id),
  openExternal: (id) => ipcRenderer.send('site:open-external', id),
  reload: (id) => ipcRenderer.send('site:reload', id),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  openPanel: (mode) => ipcRenderer.send('panel:open', mode),
  toggleTitlebar: () => ipcRenderer.send('titlebar:toggle'),
  dockedDragStart: (screenX, screenY) => ipcRenderer.send('titlebar:docked-drag-start', { screenX, screenY }),
  dockedDragEnd: () => ipcRenderer.send('titlebar:docked-drag-end'),
  contextMenu: (id) => ipcRenderer.send('site:context-menu', id),
  reorderSites: (orderedIds) => ipcRenderer.invoke('sites:reorder', orderedIds),
  openSiteConfig: (id) => ipcRenderer.send('site:open-config', id),
  restoreSite: (id) => ipcRenderer.send('site:restore', id)
});
