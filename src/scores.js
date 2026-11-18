/* Talks to /api/scores. Every call fails quietly (returns null) so the game never waits on the network. */
const KEY = 'standstill-name';
let name = '';
try { name = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode */ }

const clean = n => String(n || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);

async function call(url, opts) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

export const Scores = {
  get name() { return name || 'ANON'; },
  setName(n) { name = clean(n); try { localStorage.setItem(KEY, name); } catch (e) { /* ignore */ } return name; },
  top(board) { return call(`/api/scores?board=${board}`); },
  submit(board, value) {
    return call('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, name: this.name, value }) });
  },
  /** Best-effort local record, used when the leaderboard is unreachable. */
  local(board, value, lowerIsBetter) {
    const k = 'standstill-best-' + board; let best = null;
    try { best = JSON.parse(localStorage.getItem(k)); } catch (e) { /* ignore */ }
    const isNew = best == null || (lowerIsBetter ? value < best : value > best);
    if (isNew) { try { localStorage.setItem(k, JSON.stringify(value)); } catch (e) { /* ignore */ } best = value; }
    return { best, isNew };
  },
};
