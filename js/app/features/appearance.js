// ── Appearance / per-login theme ────────────────────────────────────────────
// Each front-desk user picks a Light/Dark base + a custom accent color. The theme
// is stored on their synced fd_user record (so it follows their login to any
// device); the fallback Manager (no fd_user) stores it device-locally. Applied on
// login, reset to the default light palette on logout / before login.
//
// Only the chrome is themed (surfaces/text/outline via [data-appearance], accent
// via --primary*). Semantic status colors (waiting/in-service/complete) live in JS
// and stay fixed — they carry meaning, not branding.
import { getState } from '../store.js';
import { dispatch } from '../sync.js';
import { getActiveUser } from '../session.js';
import { showToast } from '../utils.js';

const cfg = () => getState().config;
const ROOT = document.documentElement;
const FALLBACK_KEY = 'muse_theme_fallback';
const DEFAULT_ACCENT = '#2f80d8';
const ACCENT_VARS = ['--primary', '--primary-dim', '--primary-container', '--on-primary', '--on-primary-container'];
const CUSTOMER_VARS = ['--customer', '--on-customer'];
const PRESETS = ['#2f80d8', '#1a5252', '#7048e8', '#c2255c', '#e8590c', '#2b8a3e', '#5c4010', '#0f172a'];

let _draft = null;   // { base, accent, custom, recents } while editing in Settings

// ── Color helpers ─────────────────────────────────
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const isHex = h => /^#?[0-9a-fA-F]{6}$/.test(String(h || ''));
const norm = h => (String(h).startsWith('#') ? h : '#' + h).toLowerCase();
function hexToRgb(h) { const n = parseInt(norm(h).slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join(''); }
function mix(hex, target, t) { const a = hexToRgb(hex), b = hexToRgb(target); return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t); }
const darken  = (h, t) => mix(h, '#000000', t);
const lighten = (h, t) => mix(h, '#ffffff', t);
function luminance(h) { const { r, g, b } = hexToRgb(h); const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
const contrastText = h => (luminance(h) > 0.45 ? '#0a0a0a' : '#ffffff');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ── Apply / clear ─────────────────────────────────
export function applyTheme(theme) {
  const base = theme && theme.base === 'dark' ? 'dark' : 'light';
  ROOT.setAttribute('data-appearance', base);
  // Customer-facing button color — independent of the accent.
  const custom = theme && isHex(theme.custom) ? norm(theme.custom) : null;
  if (custom) { ROOT.style.setProperty('--customer', custom); ROOT.style.setProperty('--on-customer', contrastText(custom)); }
  else CUSTOMER_VARS.forEach(v => ROOT.style.removeProperty(v));

  const accent = theme && isHex(theme.accent) ? norm(theme.accent) : null;
  if (!accent) { ACCENT_VARS.forEach(v => ROOT.style.removeProperty(v)); return; }
  const map = {
    '--primary': accent,
    '--primary-dim': darken(accent, 0.22),
    '--primary-container': base === 'dark' ? darken(accent, 0.45) : lighten(accent, 0.55),
    '--on-primary': contrastText(accent),
    '--on-primary-container': base === 'dark' ? lighten(accent, 0.6) : darken(accent, 0.4),
  };
  Object.entries(map).forEach(([k, v]) => ROOT.style.setProperty(k, v));
}
export function clearTheme() {
  ROOT.removeAttribute('data-appearance');
  [...ACCENT_VARS, ...CUSTOMER_VARS].forEach(v => ROOT.style.removeProperty(v));
}

function currentUserTheme() {
  const au = getActiveUser();
  if (!au) return null;
  if (au.id === 'fallback') { try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null'); } catch { return null; } }
  return (cfg().fd_users || []).find(u => u.id === au.id)?.theme || null;
}

// Apply the logged-in user's saved theme (or the default light palette if none).
export function applyUserTheme() {
  const t = currentUserTheme();
  if (t) applyTheme(t); else clearTheme();
}

function persistTheme(theme) {
  const au = getActiveUser();
  if (!au) return;
  if (au.id === 'fallback') {
    if (theme) localStorage.setItem(FALLBACK_KEY, JSON.stringify(theme)); else localStorage.removeItem(FALLBACK_KEY);
  } else {
    const fd = (cfg().fd_users || []).map(u => u.id === au.id ? { ...u, theme: theme || undefined } : u);
    dispatch('config.set', { key: 'fd_users', value: fd });
  }
}

// ── Settings UI ───────────────────────────────────
export function renderAppearanceSettings(reinit = true) {
  const el = document.getElementById('settings-appearance-section'); if (!el) return;
  const au = getActiveUser();
  // Fresh open (called by the nav, no arg) seeds the draft from the saved theme;
  // internal re-renders (base/swatch tap) pass false to keep the in-progress draft.
  if (reinit || !_draft) _draft = { ...(currentUserTheme() || { base: 'light', accent: DEFAULT_ACCENT }) };
  if (!isHex(_draft.accent)) _draft.accent = DEFAULT_ACCENT;
  if (!isHex(_draft.custom)) _draft.custom = _draft.accent;        // customer color defaults to the accent
  if (!Array.isArray(_draft.recents)) _draft.recents = [];
  const who = au?.name || 'this device';
  const baseBtn = (val, label) => `<button onclick="appearanceSetBase('${val}')"
    class="flex-1 py-2 rounded-lg font-headline font-bold text-sm transition-all ${_draft.base === val ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}">${label}</button>`;
  // One swatch; `pickFn` is the handler so the same row drives either color picker.
  const swatch = (current, pickFn) => c => `<button onclick="${pickFn}('${c}')" title="${c}" class="w-8 h-8 rounded-full border-2 ${current.toLowerCase() === c.toLowerCase() ? 'border-on-surface' : 'border-surface-container-high'}" style="background:${c}"></button>`;
  const swatchRow = (current, pickFn) => {
    const presets = PRESETS.map(swatch(current, pickFn)).join('');
    const recents = _draft.recents.length
      ? `<span class="w-px h-6 self-center bg-surface-container-high mx-1" title="Recent custom colors"></span>` + _draft.recents.map(swatch(current, pickFn)).join('')
      : '';
    return `<div class="flex flex-wrap items-center gap-2">${presets}${recents}</div>`;
  };
  const colorBlock = (label, sub, inputId, hexId, value, previewFn, pickFn) => `
    <div class="mb-4">
      <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-2">${label}${sub ? ` <span class="normal-case tracking-normal text-on-surface-variant font-normal">${sub}</span>` : ''}</label>
      <div class="flex items-center gap-3 mb-3">
        <input type="color" id="${inputId}" value="${value}" oninput="${previewFn}()" class="w-12 h-10 rounded-lg border border-surface-container-high bg-transparent cursor-pointer">
        <span class="font-body text-sm text-on-surface-variant" id="${hexId}">${value}</span>
      </div>
      ${swatchRow(value, pickFn)}
    </div>`;
  el.innerHTML = `
    <p class="text-xs font-body text-on-surface-variant mb-4">Personalize the dashboard for <b>${esc(who)}</b>. Your theme follows your login on any device. Status colors (waiting / in&nbsp;service / complete) stay the same so the floor stays readable. Custom colors you use are remembered (up to 5) as quick swatches.</p>
    <div class="mb-4">
      <label class="text-[11px] font-body font-semibold text-outline uppercase tracking-widest block mb-2">Base</label>
      <div class="flex gap-2">${baseBtn('light', 'Light')}${baseBtn('dark', 'Dark')}</div>
    </div>
    ${colorBlock('Accent color', '', 'appearance-accent', 'appearance-accent-hex', _draft.accent, 'appearancePreview', 'appearancePick')}
    ${colorBlock('Customer button color', '— walk-in &amp; check-in screens', 'appearance-custom', 'appearance-custom-hex', _draft.custom, 'appearancePreviewCustom', 'appearancePickCustom')}
    <div class="flex gap-2 pt-2">
      <button onclick="appearanceSave()" class="cta flex-1 py-3 rounded-xl font-headline font-bold transition-all active:scale-95">Save my theme</button>
      <button onclick="appearanceReset()" class="px-4 py-3 rounded-xl border-2 border-outline-variant text-on-surface-variant font-headline font-semibold text-sm hover:bg-surface-container transition-colors">Reset</button>
    </div>`;
  applyTheme(_draft);   // live preview reflects the editor immediately
}
export function appearanceSetBase(base) { if (!_draft) return; _draft.base = base; applyTheme(_draft); renderAppearanceSettings(false); }
export function appearancePick(color) { if (!_draft) return; _draft.accent = norm(color); applyTheme(_draft); renderAppearanceSettings(false); }
export function appearancePickCustom(color) { if (!_draft) return; _draft.custom = norm(color); applyTheme(_draft); renderAppearanceSettings(false); }
export function appearancePreview() {
  if (!_draft) return;
  const v = document.getElementById('appearance-accent')?.value;
  if (isHex(v)) { _draft.accent = norm(v); applyTheme(_draft); const hx = document.getElementById('appearance-accent-hex'); if (hx) hx.textContent = _draft.accent; }
}
export function appearancePreviewCustom() {
  if (!_draft) return;
  const v = document.getElementById('appearance-custom')?.value;
  if (isHex(v)) { _draft.custom = norm(v); applyTheme(_draft); const hx = document.getElementById('appearance-custom-hex'); if (hx) hx.textContent = _draft.custom; }
}
export function appearanceSave() {
  if (!_draft) return;
  // Remember up to 5 custom (non-preset) colors as quick swatches.
  const used = [_draft.accent, _draft.custom].map(norm).filter(c => isHex(c) && !PRESETS.includes(c));
  _draft.recents = [...used, ...(_draft.recents || [])].filter((c, i, a) => a.indexOf(c) === i).slice(0, 5);
  persistTheme(_draft); applyTheme(_draft); renderAppearanceSettings(false); showToast('Theme saved');
}
export function appearanceReset() { _draft = { base: 'light', accent: DEFAULT_ACCENT, custom: DEFAULT_ACCENT, recents: [] }; persistTheme(null); clearTheme(); renderAppearanceSettings(); showToast('Theme reset to default'); }
