// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Josh Wilk. Part of Eleosynth; see LICENSE for terms (no warranty).
// Eleosynth — Windows build (x64; also runs on Windows on ARM through emulation). Same Electron shell as the Mac app.
const path = require('path');
const { packager } = require(require.resolve('@electron/packager', { paths: [path.join(__dirname, '..', 'mac')] }));
const V = require(path.join(__dirname, '..', 'mac', 'app', 'package.json')).version;
(async () => {
  const out = await packager({
    dir: path.join(__dirname, '..', 'mac', 'app'), out: path.join(__dirname, 'out'), overwrite: true,
    platform: 'win32', arch: 'x64', electronVersion: '45.0.0',
    name: 'Eleosynth', executableName: 'Eleosynth', appVersion: V, buildVersion: V,
    icon: path.join(__dirname, '..', 'build', 'icons', 'eleosynth.ico'), asar: true, prune: false,
    appCopyright: 'Copyright © 2026 Josh Wilk. Free software under the GNU GPL v3 or later.',
    win32metadata: { CompanyName: 'Eleosynth', ProductName: 'Eleosynth', FileDescription: 'Eleosynth — synth and pedal studio', OriginalFilename: 'Eleosynth.exe', InternalName: 'Eleosynth' },
  });
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
