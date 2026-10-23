#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Josh Wilk. Part of Eleosynth; see LICENSE for terms (no warranty).
# Build dist/Eleosynth-<V>-amd64.deb from linux/out (run linux/pack.js first). Needs dpkg-deb.
set -e
cd "$(dirname "$0")/.."
V=${1:-$(node -p "require('./mac/app/package.json').version")}
SRC="linux/out/Eleosynth-linux-x64"
R=linux/deb-root
rm -rf "$R"; mkdir -p "$R/DEBIAN" "$R/opt" "$R/usr/bin" "$R/usr/share/applications" "$R/etc/apparmor.d" "$R/usr/share/doc/eleosynth" "$R/usr/share/icons/hicolor/scalable/apps"
cp -a "$SRC" "$R/opt/eleosynth"
chmod -R u=rwX,go=rX "$R/opt/eleosynth"; chmod 755 "$R/opt/eleosynth/eleosynth" "$R/opt/eleosynth/chrome_crashpad_handler"
ln -s /opt/eleosynth/eleosynth "$R/usr/bin/eleosynth"
for s in 16 32 48 64 128 256 512; do d="$R/usr/share/icons/hicolor/${s}x${s}/apps"; mkdir -p "$d"; cp build/icons/icon-$s.png "$d/eleosynth.png"; done
cp build/icon.svg "$R/usr/share/icons/hicolor/scalable/apps/eleosynth.svg"
cat > "$R/usr/share/applications/eleosynth.desktop" <<D
[Desktop Entry]
Type=Application
Name=Eleosynth
GenericName=Synthesizer and Guitar Pedalboard
Comment=Wavetable, analog and tine-piano synth with 39 effects and a guitar pedalboard
Exec=/opt/eleosynth/eleosynth
Icon=eleosynth
Terminal=false
Categories=AudioVideo;Audio;Music;Midi;
Keywords=synth;synthesizer;wavetable;guitar;pedal;effects;rhodes;midi;
StartupWMClass=eleosynth
Actions=pedals;

[Desktop Action pedals]
Name=Pedalboard
Exec=/opt/eleosynth/eleosynth --pedals
D
cat > "$R/etc/apparmor.d/eleosynth" <<D
abi <abi/4.0>,
include <tunables/global>

profile eleosynth /opt/eleosynth/eleosynth flags=(unconfined) {
  userns,
  include if exists <local/eleosynth>
}
D
{ cat <<D
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Eleosynth
Upstream-Contact: Josh Wilk
Source: https://github.com/Eleosynth/eleosynth

Files: *
Copyright: 2026 Josh Wilk
License: GPL-3.0+

Files: opt/eleosynth/*.so opt/eleosynth/*.pak opt/eleosynth/eleosynth opt/eleosynth/LICENSE*
Copyright: GitHub Inc., the Electron and Chromium authors
License: MIT and others
 See /opt/eleosynth/LICENSE and /opt/eleosynth/LICENSES.chromium.html.

License: GPL-3.0+
 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 .
 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.
 .
 On Debian systems, the complete text of the GNU General Public
 License version 3 can be found in "/usr/share/common-licenses/GPL-3".
D
} > "$R/usr/share/doc/eleosynth/copyright"
SIZE=$(du -sk "$R" | cut -f1)
cat > "$R/DEBIAN/control" <<D
Package: eleosynth
Version: $V
Section: sound
Priority: optional
Architecture: amd64
Installed-Size: $SIZE
Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2, libgbm1, libxss1, libxtst6, libatspi2.0-0t64 | libatspi2.0-0, libdrm2, libsecret-1-0, xdg-utils
Recommends: pulseaudio | pipewire-pulse
Maintainer: Josh Wilk <noreply@eleosynth.invalid>
Homepage: https://eleosynth.github.io/eleosynth/
Description: Synthesizer and guitar pedal studio
 Eleosynth combines two wavetable oscillators, a tine electric-piano
 engine, a granular layer, drifting ladder and state-variable filters,
 a modulation matrix and an arpeggiator with a guitar pedalboard,
 tuner and guitar-to-synth pitch tracking. 39 effects are shared by the
 synth FX rack and the pedalboard. Part of the DAWters and Son suite.
D
echo /etc/apparmor.d/eleosynth > "$R/DEBIAN/conffiles"
cat > "$R/DEBIAN/postinst" <<'D'
#!/bin/sh
set -e
chown root:root /opt/eleosynth/chrome-sandbox 2>/dev/null || true
chmod 4755 /opt/eleosynth/chrome-sandbox 2>/dev/null || true
if [ -x /usr/sbin/apparmor_parser ] && [ -e /etc/apparmor.d/abi/4.0 ] && aa-enabled --quiet 2>/dev/null; then
  apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/eleosynth 2>/dev/null || true
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
D
cat > "$R/DEBIAN/postrm" <<'D'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  [ -x /usr/sbin/apparmor_parser ] && apparmor_parser --remove /etc/apparmor.d/eleosynth 2>/dev/null || true
  command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
D
chmod 755 "$R/DEBIAN/postinst" "$R/DEBIAN/postrm"
OUT="dist/Eleosynth-$V-amd64.deb"
dpkg-deb --root-owner-group -Zxz --build "$R" "$OUT" >/dev/null
rm -rf "$R"
ls -la "$OUT"
