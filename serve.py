#!/usr/bin/env python3
"""Fallback zero-dependency server (used when Node.js is not installed).
Usage: python serve.py [port]"""
import http.server, os, sys, webbrowser, functools

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript",
                      ".svg": "image/svg+xml", ".css": "text/css"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

url = f"http://localhost:{PORT}/"
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
    print(f"\n  Stockfish Elo Terminal running at {url}\n  Press Ctrl+C to stop.\n")
    if not os.environ.get("NO_OPEN"):
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
