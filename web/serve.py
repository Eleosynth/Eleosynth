#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Eleosynth local launcher: serves the page at http://localhost:8752 so the browser allows
# guitar/microphone input, MIDI and AudioWorklet. Nothing is sent anywhere; it only listens on this computer.
import http.server, os, socketserver, threading, webbrowser
PORT = 8752
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), H) as httpd:
    url = 'http://localhost:%d/eleosynth.html' % PORT
    print('Eleosynth is running at', url, '\nClose this window to stop it.')
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    httpd.serve_forever()
