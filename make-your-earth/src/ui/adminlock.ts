/*
  The admin panel is locked with a PIN that only the world owner knows, and there's no button for it:
  press F2 three times quickly (or, on a phone, tap the coordinates in the top-left corner five times).
  The first time, you choose the PIN. It's stored on this device only, as a salted hash.
*/
import { t } from '../i18n/i18n';

const KEY = 'mye-admin-pin';
async function hash(pin: string) {
  const data = new TextEncoder().encode('mye-admin:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
let fails = 0, lockedUntil = 0;

/** ask for the PIN (or to create one); resolves true when unlocked */
export function unlockAdmin(): Promise<boolean> {
  return new Promise(res => {
    const stored = localStorage.getItem(KEY);
    const wrap = document.createElement('div'); wrap.className = 'overlay pinwrap';
    const create = !stored;
    wrap.innerHTML = `<div class="pinbox"><h3>🔒 ${t(create ? 'admin.pinCreate' : 'admin.pinEnter')}</h3>
      <input class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="••••">
      ${create ? `<input class="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="${t('admin.pinAgain')}">` : ''}
      <p class="msg muted">${t(create ? 'admin.pinHint' : 'admin.pinOwner')}</p>
      <div class="row"><button class="btn ghost" data-x>${t('admin.cancel')}</button><button class="btn" data-ok>${t('admin.unlock')}</button></div></div>`;
    document.body.appendChild(wrap);
    const pin = wrap.querySelector<HTMLInputElement>('.pin')!, pin2 = wrap.querySelector<HTMLInputElement>('.pin2'), msg = wrap.querySelector<HTMLElement>('.msg')!;
    const done = (ok: boolean) => { wrap.remove(); res(ok); };
    const go = async () => {
      if (Date.now() < lockedUntil) { msg.textContent = t('admin.pinWait'); return; }
      const v = pin.value.trim();
      if (!/^\d{4,12}$/.test(v)) { msg.textContent = t('admin.pinHint'); return; }
      if (create) {
        if (v !== pin2!.value.trim()) { msg.textContent = t('admin.pinMismatch'); return; }
        localStorage.setItem(KEY, await hash(v)); done(true); return;
      }
      if (await hash(v) === stored) { fails = 0; done(true); return; }
      fails++; pin.value = ''; msg.textContent = t('admin.pinWrong');
      if (fails >= 5) { lockedUntil = Date.now() + 60000; fails = 0; msg.textContent = t('admin.pinWait'); }
    };
    wrap.querySelector<HTMLElement>('[data-ok]')!.onclick = go;
    wrap.querySelector<HTMLElement>('[data-x]')!.onclick = () => done(false);
    wrap.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') done(false); });
    setTimeout(() => pin.focus(), 50);
  });
}

/** the secret ways in: F2 three times within 1.5 s, or five taps on the coordinates */
export function watchSecretOpen(open: () => void) {
  let presses: number[] = [];
  addEventListener('keydown', e => {
    if (e.code !== 'F2') return;
    e.preventDefault();
    const now = performance.now(); presses = presses.filter(p => now - p < 1500); presses.push(now);
    if (presses.length >= 3) { presses = []; open(); }
  });
  let taps: number[] = [];
  addEventListener('pointerdown', e => {
    if (!(e.target as HTMLElement)?.closest?.('.coords')) return;
    const now = performance.now(); taps = taps.filter(p => now - p < 2500); taps.push(now);
    if (taps.length >= 5) { taps = []; open(); }
  });
}
