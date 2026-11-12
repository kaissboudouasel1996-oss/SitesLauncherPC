'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bar', {
  use: (id) => ipcRenderer.invoke('codebar:use', id),
  onUpdate: (fn) => ipcRenderer.on('codebar:update', (_e, data) => fn(data))
});
