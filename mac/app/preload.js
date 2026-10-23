// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Josh Wilk. Part of Eleosynth (DAWters and Son suite); see LICENSE for terms (no warranty).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('eleoNative', {
  platform: process.platform,
  saveFile: (name, data) => ipcRenderer.invoke('save-file', name, data),
  micAccess: () => ipcRenderer.invoke('mic-access'),
  onMenu: (fn) => ipcRenderer.on('menu', (e, cmd) => fn(cmd)),
});
