"""Tiny dev HTTP server with no-cache headers (defeats aggressive browser ES module caching)."""
import http.server
import socketserver
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 沉默化, 避免 IDE 卡住
        pass


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


with ThreadedServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Dev server (no-cache, threaded) on http://localhost:{PORT}", flush=True)
    httpd.serve_forever()
