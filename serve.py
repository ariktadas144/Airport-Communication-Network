"""Tiny local web server for the Airport Network Simulator (standard library only)."""
import http.server, socketserver, webbrowser, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler) as srv:
    url = f"http://localhost:{PORT}"
    print(f"Serving on {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
