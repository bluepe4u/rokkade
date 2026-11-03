// Client for the local server's store and chess.com endpoints. If the page is served by something
// without the API (a plain static server), documents fall back to this browser's localStorage.
export async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  let j = null;
  try { j = await r.json(); } catch { throw new Error('The local server did not answer. Start the app with start.bat / start.sh.'); }
  if (!r.ok || (j && j.error)) throw new Error((j && j.error) || 'Request failed');
  return j;
}

const LS = 'sfet.store.';
let serverOk = null;

async function probe() {
  if (serverOk != null) return serverOk;
  try {
    const r = await fetch('/api/store?name=probe', { cache: 'no-store' });
    serverOk = r.ok && (r.headers.get('content-type') || '').includes('json');
  } catch { serverOk = false; }
  return serverOk;
}

export const store = {
  async get(name) {
    if (await probe()) return api(`/api/store?name=${encodeURIComponent(name)}`);
    try { return JSON.parse(localStorage.getItem(LS + name)); } catch { return null; }
  },
  async set(name, value) {
    const body = JSON.stringify(value);
    if (await probe()) {
      const r = await fetch(`/api/store?name=${encodeURIComponent(name)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error(`Saving ${name} failed (${r.status})`);
      return;
    }
    try { localStorage.setItem(LS + name, body); } catch (e) { throw new Error(`Saving ${name} failed: ${e.message}`); }
  },
  hasServer: probe,
};

/** localStorage JSON helpers that never throw. */
export const ls = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
