'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tb', {
  act: (a) => ipcRenderer.invoke('split:toolbar', a),
  texts: () => ipcRenderer.invoke('split:texts')
});
