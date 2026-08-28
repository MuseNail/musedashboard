// Pure helpers for the check-in service waiver. No browser/Cloudflare APIs →
// unit-testable in node AND served to the browser (client-consumed: the client builds
// the acceptance record, the Worker just persists it as its own DO key `waiver:<id>`,
// never in buildSnapshot, never broadcast). This module owns the record shape, the text
// hash, and the re-sign rule.

export const WAIVER_METHODS = ['self-kiosk', 'front-desk-kiosk'];
export const WAIVER_MAX_TEXT = 200000;   // generous cap on the stored agreement text

// Deterministic 32-bit FNV-1a → hex. Not cryptographic — a checksum to detect drift/
// tampering; exact reproduction relies on the full text stored inline on the record.
export function textHash(text) {
  const s = String(text == null ? '' : text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// id generated ONCE before dispatch (stable across an offline-outbox replay → the
// mutationId dedup keeps replays from creating duplicate waiver rows).
export function newWaiverId(now, rand) { return 'wv-' + now + '-' + rand; }

export function signerDisplayName(firstName, lastName) {
  const f = String(firstName || '').trim();
  const l = String(lastName || '').trim();
  return l ? (f + ' ' + l[0] + '.').trim() : f;
}

// The feature is active only when enabled AND a non-empty agreement text exists for the
// current version — otherwise check-in must proceed (never hard-block behind empty terms).
export function waiverActive(config) {
  const c = config || {};
  if (!c.waiver_enabled) return false;
  if (!c.waiver_version) return false;
  if (!String(c.waiver_text || '').trim()) return false;
  return true;
}

// The re-sign rule: the party is covered ONLY when every guest resolves to a customer
// stamped at the current version. A phone-less guest can never be proven covered → gate.
// `coveredByPhoneKey` maps phoneKey → the customer's stamped waiverVersion.
export function partyNeedsWaiver(guests, coveredByPhoneKey, currentVersion) {
  const map = coveredByPhoneKey || {};
  for (const g of (guests || [])) {
    const pk = g && g.phoneKey;
    if (!pk) return true;                          // no phone → cannot prove coverage
    if (map[pk] !== currentVersion) return true;   // missing or older version
  }
  return false;
}

export function buildWaiverRecord({
  id, now, primary, guests, waiverVersion, text, method, deviceId, byUser, optIns, arbitrationOptOut, bypassed, ip,
}) {
  const p = primary || {};
  return {
    id,
    customerId: p.customerId || null,
    phoneKey: p.phoneKey || '',
    signerFullName: [String(p.firstName || '').trim(), String(p.lastName || '').trim()].filter(Boolean).join(' '),
    signerDisplay: signerDisplayName(p.firstName, p.lastName),
    signerPhone: p.phone || '',
    guests: (guests || []).map(g => ({ name: g.name || '', phoneKey: g.phoneKey || null })),
    waiverVersion: String(waiverVersion || ''),
    textHash: textHash(text),
    text: String(text == null ? '' : text).slice(0, WAIVER_MAX_TEXT),   // full signed text inline = system of record
    acceptedAt: now,
    method: WAIVER_METHODS.includes(method) ? method : 'self-kiosk',
    deviceId: deviceId || '',
    byUser: byUser || null,
    optIns: { marketing: !!(optIns && optIns.marketing), media: !!(optIns && optIns.media) },
    arbitrationOptOut: !!arbitrationOptOut,
    bypassed: !!bypassed,
    ip: ip || null,
  };
}
