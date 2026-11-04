#!/usr/bin/env python3
"""Fallback zero-dependency server (used when Node.js is not installed): serves public/ and the
Coach API (same endpoints and data layout as server.js). Usage: python serve.py [port]"""
import functools, hashlib, http.server, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request, webbrowser
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
HERE = Path(__file__).resolve().parent
ROOT = HERE / "public"
DATA = Path(os.environ["TERMINAL_DATA_DIR"]).resolve() if os.environ.get("TERMINAL_DATA_DIR") else HERE / "data"
API_BASE = os.environ.get("CHESSCOM_API_BASE", "https://api.chess.com").rstrip("/")
UA = "stockfish-elo-terminal/1.0 (personal game analysis tool)"
USER_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
YM_RE = re.compile(r"^\d{4}/\d{2}$")
STORE_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_BODY = 32 * 1024 * 1024
KEEP = ("uuid", "url", "pgn", "time_class", "time_control", "rules", "rated", "end_time", "eco", "accuracies")
EXPLORER = os.environ.get("LICHESS_EXPLORER_BASE", "https://explorer.lichess.ovh").rstrip("/")
FEN_RE = re.compile(r"^[1-8pnbrqkPNBRQK/]+ [wb] [KQkq-]+ [a-h1-8-]+( \d+ \d+)?$")
EXPLORER_TTL = 30 * 86400


def token_file():
    return DATA / "lichess-token.txt"


def fetch(url, extra=None):
    for attempt in range(4):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(extra or {})})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("chess.com kept refusing the request")


def slim(g):
    o = {k: g[k] for k in KEEP if k in g}
    for c in ("white", "black"):
        p = g.get(c, {})
        o[c] = {"username": p.get("username", ""), "rating": p.get("rating", 0), "result": p.get("result", "")}
    return o


def user_dir(user):
    d = DATA / "users" / user.lower()
    d.mkdir(parents=True, exist_ok=True)
    return d


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript",
                      ".onnx": "application/octet-stream", ".json": "application/json",
                      ".svg": "image/svg+xml", ".css": "text/css"}

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def local_ok(self):
        return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def send_json(self, obj, code=200):
        b = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if not self.local_ok():
            return self.send_error(403)
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith("/api/"):
            return super().do_GET()
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            return self.api_get(u.path, q)
        except urllib.error.HTTPError as e:
            msg = "chess.com has no player with that name." if e.code == 404 else f"chess.com answered with error {e.code}."
            return self.send_json({"error": msg}, 502)
        except Exception as e:  # network trouble
            return self.send_json({"error": f"Could not reach chess.com: {e}"}, 502)

    def api_get(self, path, q):
        if path == "/api/store":
            name = q.get("name", "")
            if not STORE_RE.match(name):
                return self.send_json({"error": "bad name"}, 400)
            f = DATA / "store" / f"{name}.json"
            return self.send_json(json.loads(f.read_text("utf-8")) if f.exists() else None)
        if path == "/api/lichess-status":
            f = token_file()
            return self.send_json({"token": bool(os.environ.get("LICHESS_EXPLORER_BASE")) or (f.exists() and len(f.read_text().strip()) > 0)})
        if path == "/api/lichess":
            fen = q.get("fen", "")
            ratings = re.sub(r"[^0-9,]", "", q.get("ratings", ""))
            speeds = re.sub(r"[^a-z,]", "", q.get("speeds", ""))
            if not FEN_RE.match(fen):
                return self.send_json({"error": "bad fen"}, 400)
            qs = f"variant=standard&fen={urllib.parse.quote(fen)}&ratings={ratings}&speeds={speeds}&moves=12&topGames=0&recentGames=0"
            d = DATA / "cache" / "explorer"
            d.mkdir(parents=True, exist_ok=True)
            f = d / (hashlib.sha1(qs.encode()).hexdigest() + ".json")
            if f.exists() and time.time() - f.stat().st_mtime < EXPLORER_TTL:
                return self.send_json(json.loads(f.read_text("utf-8")))
            tok = token_file().read_text().strip() if token_file().exists() else ""
            if not tok and not os.environ.get("LICHESS_EXPLORER_BASE"):
                return self.send_json({"error": "no-token"}, 401)
            try:
                j = fetch(f"{EXPLORER}/lichess?{qs}", {"Authorization": f"Bearer {tok}"} if tok else None)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    return self.send_json({"error": "bad-token"}, 401)
                if e.code == 429:
                    return self.send_json({"error": "Lichess is rate-limiting; try again in a minute."}, 429)
                raise
            f.write_text(json.dumps(j), "utf-8")
            return self.send_json(j)
        user = q.get("user", "")
        if not USER_RE.match(user):
            return self.send_json({"error": "That does not look like a chess.com username."}, 400)
        if path == "/api/player":
            u0 = urllib.parse.quote(user.lower())
            profile = fetch(f"{API_BASE}/pub/player/{u0}")
            try:
                stats = fetch(f"{API_BASE}/pub/player/{u0}/stats")
            except Exception:
                stats = {}
            return self.send_json({"profile": {"username": profile.get("username"), "name": profile.get("name", ""), "avatar": profile.get("avatar", ""),
                                               "country": profile.get("country", "").split("/")[-1], "joined": profile.get("joined", 0),
                                               "last_online": profile.get("last_online", 0), "title": profile.get("title", "")}, "stats": stats})
        u = urllib.parse.quote(user.lower())
        if path == "/api/archives":
            arch = fetch(f"{API_BASE}/pub/player/{u}/games/archives").get("archives", [])
            yms = [a.split("/games/")[1] for a in arch if YM_RE.match(a.split("/games/")[-1])]
            d = user_dir(user)
            cached = {p.stem.replace("-", "/") for p in d.glob("*.json")}
            recent = set(yms[-2:])
            return self.send_json({"months": yms, "todo": [y for y in yms if y not in cached or y in recent]})
        if path == "/api/month":
            ym = q.get("ym", "")
            if not YM_RE.match(ym):
                return self.send_json({"error": "bad month"}, 400)
            games = [slim(g) for g in fetch(f"{API_BASE}/pub/player/{u}/games/{ym}").get("games", [])]
            (user_dir(user) / (ym.replace("/", "-") + ".json")).write_text(json.dumps(games), "utf-8")
            return self.send_json({"count": len(games)})
        if path == "/api/games":
            games = []
            for p in sorted(user_dir(user).glob("*.json")):
                games += json.loads(p.read_text("utf-8"))
            return self.send_json({"games": games})
        return self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        origin = urllib.parse.urlparse(self.headers.get("Origin", "")).hostname
        if not self.local_ok() or origin not in (None, "127.0.0.1", "localhost") or u.path not in ("/api/store", "/api/lichess-token"):
            return self.send_error(403)
        if u.path == "/api/lichess-token":
            n = int(self.headers.get("Content-Length", 0))
            if n > 4096:
                return self.send_json({"error": "too large"}, 413)
            try:
                tok = str(json.loads(self.rfile.read(n) or b"{}").get("token", "")).strip()
            except ValueError:
                return self.send_json({"error": "not JSON"}, 400)
            if tok and not re.match(r"^[A-Za-z0-9_-]{8,200}$", tok):
                return self.send_json({"error": "That does not look like a Lichess token."}, 400)
            DATA.mkdir(parents=True, exist_ok=True)
            if tok:
                token_file().write_text(tok)
                os.chmod(token_file(), 0o600)
            elif token_file().exists():
                token_file().unlink()
            return self.send_json({"ok": True})
        name = urllib.parse.parse_qs(u.query).get("name", [""])[0]
        if not STORE_RE.match(name):
            return self.send_json({"error": "bad name"}, 400)
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            return self.send_json({"error": "too large"}, 413)
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except ValueError:
            return self.send_json({"error": "not JSON"}, 400)
        d = DATA / "store"
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / f"{name}.{os.getpid()}.tmp"
        tmp.write_bytes(body)
        tmp.replace(d / f"{name}.json")
        self.send_json({"ok": True})


def main():
    url = f"http://localhost:{PORT}/"
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(ROOT))) as httpd:
        print(f"\n  Rokade running at {url}\n  Press Ctrl+C to stop.\n")
        if not os.environ.get("NO_OPEN"):
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
