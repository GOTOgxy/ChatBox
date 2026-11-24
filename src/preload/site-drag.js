const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatboxDrag', {
  stripStart: (screenX, screenY) => ipcRenderer.send('drag-strip:start', { screenX, screenY }),
  stripEnd: () => ipcRenderer.send('drag-strip:end')
});
