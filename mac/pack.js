// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Josh Wilk. Part of Eleosynth; see LICENSE for terms (no warranty).
// Eleosynth — macOS build (Apple Silicon).
const { packager } = require('@electron/packager');
const V = require(__dirname + '/app/package.json').version;
(async () => {
  const out = await packager({
    dir: __dirname + '/app', out: __dirname + '/out', overwrite: true,
    platform: 'darwin', arch: 'arm64', electronVersion: '45.0.0',
    name: 'Eleosynth', executableName: 'Eleosynth', appBundleId: 'com.wilk.eleosynth', appCategoryType: 'public.app-category.music',
    appVersion: V, buildVersion: '2', icon: __dirname + '/../build/icons/eleosynth.icns', asar: true, prune: false, osxSign: false,
    appCopyright: 'Copyright © 2026 Josh Wilk. Free software under the GNU GPL v3 or later.',
    extendInfo: { NSMicrophoneUsageDescription: 'Eleosynth plays your guitar or microphone through its pedalboard and synth.', LSMinimumSystemVersion: '12.0', NSHighResolutionCapable: true },
  });
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
