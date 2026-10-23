#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Josh Wilk. Part of Eleosynth; see LICENSE for terms (no warranty).
# Assemble the public website into _site/: the product page at / and the instrument at /app/.
set -e
cd "$(dirname "$0")/.."
python3 build.py
rm -rf _site && mkdir -p _site/app
cp -r site/. _site/
cp dist/eleosynth.html _site/app/index.html
cp LICENSE _site/LICENSE.txt
touch _site/.nojekyll
du -sh _site
