#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Josh Wilk. Part of Eleosynth; see LICENSE for terms (no warranty).
# Build every Eleosynth package into dist/ (same toolchain as DAWters and Son).
#   web:     python3 only
#   mac:     node + npm (Electron is downloaded once), rcodesign (cargo install apple-codesign),
#            libdmg-hfsplus "hfsplus" + "dmg" tools (HFSPLUS / DMGTOOL), hfsprogs (mkfs.hfsplus).
#            On a Mac: node mac/pack.js, then codesign --force --deep -s - and hdiutil create.
#   windows: makensis (apt install nsis); Electron for win32 is downloaded once
#   linux:   dpkg-deb; Electron for linux is downloaded once
#   android: see android/build-apk.sh (release key from ELEO_KEYSTORE + ELEO_KS_PASS)
set -e
cd "$(dirname "$0")"
V=0.1.1
python3 build.py
rm -rf dist/web && mkdir -p dist/web && cp dist/eleosynth.html web/* LICENSE dist/web/ && rm -rf dist/web/__pycache__
python3 tools/make_web_zip.py dist/web "dist/Eleosynth-$V-web.zip"
cp dist/eleosynth.html mac/app/eleosynth.html; cp LICENSE mac/app/LICENSE
(cd mac && [ -d node_modules/@electron/packager ] || npm i -D @electron/packager@20 electron@45.0.0 --ignore-scripts)
if [ "$SKIP_MAC" != 1 ]; then
  node mac/pack.js
  APP="mac/out/Eleosynth-darwin-arm64/Eleosynth.app"
  ${RCODESIGN:-rcodesign} sign "$APP" >/dev/null
  cp LICENSE build/LICENSE.txt
  rm -f "dist/Eleosynth-$V-arm64.dmg"
  python3 tools/make_dmg.py "$APP" "dist/Eleosynth-$V-arm64.dmg" "Eleosynth" "build/Read Me First.txt" build/LICENSE.txt
fi
if [ "$SKIP_WIN" != 1 ]; then
  node win/pack.js
  cp LICENSE "win/out/Eleosynth-win32-x64/LICENSE-Eleosynth.txt"; cp win/README-Windows.txt "win/out/Eleosynth-win32-x64/Read Me.txt"
  (cd win && makensis -V2 -DVERSION=$V "-DOUTFILE=../dist/Eleosynth-$V-Setup-x64.exe" installer.nsi)
  rm -f "dist/Eleosynth-$V-win-x64-portable.zip"
  (cd win/out && zip -qr -9 "../../dist/Eleosynth-$V-win-x64-portable.zip" "Eleosynth-win32-x64")
fi
if [ "$SKIP_LINUX" != 1 ]; then
  node linux/pack.js
  cp LICENSE "linux/out/Eleosynth-linux-x64/LICENSE-Eleosynth.txt"
  sh linux/make_deb.sh $V
fi
if [ "$SKIP_ANDROID" != 1 ]; then
  sh android/build-apk.sh
  cp android/build/Eleosynth.apk "dist/Eleosynth-$V.apk"
fi
ls -la dist
