// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Josh Wilk. Part of Eleosynth (DAWters and Son suite); see LICENSE for terms (no warranty).
// Eleosynth — desktop shell (Electron) for macOS, Windows and Linux. The instrument itself is eleosynth.html.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('Eleosynth');

let win = null;
const statePath = () => path.join(app.getPath('userData'), 'window.json');
const loadState = () => { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return { width: 1480, height: 940 }; } };
const saveState = () => { if (!win || win.isDestroyed()) return; try { fs.writeFileSync(statePath(), JSON.stringify(Object.assign(win.getNormalBounds(), { max: win.isMaximized() }))); } catch (e) { /* ignore */ } };

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1480, height: st.height || 940, minWidth: 820, minHeight: 600,
    title: 'Eleosynth', backgroundColor: '#140C08', show: false,
    autoHideMenuBar: process.platform !== 'darwin', icon: process.platform === 'darwin' ? undefined : path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveState);
  const tab = ['synth', 'fx', 'pedals', 'takes'].find((t) => process.argv.includes('--' + t));
  win.loadFile(path.join(__dirname, 'eleosynth.html'), tab ? { hash: tab } : undefined);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
}

const send = (cmd) => { if (win) win.webContents.send('menu', cmd); };
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tpl = [
    ...(isMac ? [{ label: 'Eleosynth', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Sound', submenu: [
      { label: 'Browse Sounds…', accelerator: 'CmdOrCtrl+B', click: () => send('browse') },
      { label: 'Save Sound…', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Previous Sound', accelerator: 'CmdOrCtrl+[', click: () => send('prev') },
      { label: 'Next Sound', accelerator: 'CmdOrCtrl+]', click: () => send('next') },
      { type: 'separator' },
      { label: 'Surprise Me', accelerator: 'CmdOrCtrl+R', click: () => send('surprise') },
      { label: 'Record / Stop', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('record') },
      { label: 'All Notes Off', accelerator: 'CmdOrCtrl+.', click: () => send('panic') },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Synth', accelerator: 'CmdOrCtrl+1', click: () => send('tab:synth') },
      { label: 'FX Rack', accelerator: 'CmdOrCtrl+2', click: () => send('tab:fx') },
      { label: 'Pedalboard', accelerator: 'CmdOrCtrl+3', click: () => send('tab:pedals') },
      { label: 'Takes & Files', accelerator: 'CmdOrCtrl+4', click: () => send('tab:takes') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Eleosynth Website', click: () => shell.openExternal('https://eleosynth.github.io/Eleosynth/') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

ipcMain.handle('save-file', async (e, name, data) => {
  const base = (() => { try { return app.getPath('music'); } catch (x) { return app.getPath('documents'); } })();
  const dir = path.join(base, 'Eleosynth');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (x) { /* ignore */ }
  const ext = path.extname(name).slice(1) || '*';
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(dir, name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('mic-access', async () => {
  if (process.platform !== 'darwin') return true;
  try { return await systemPreferences.askForMediaAccess('microphone'); } catch (e) { return false; }
});

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (!win) return; if (win.isMinimized()) win.restore(); win.focus(); });
if (process.platform === 'win32') app.setAppUserModelId('com.wilk.eleosynth');

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'midi', 'midiSysex', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection'].includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => ['media', 'midi', 'midiSysex', 'speaker-selection'].includes(perm));
  ses.setDevicePermissionHandler(() => true);
  app.setAboutPanelOptions({ applicationName: 'Eleosynth', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 Josh Wilk. Free software under the GNU GPL v3 or later.', website: 'https://eleosynth.github.io/Eleosynth/' });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
