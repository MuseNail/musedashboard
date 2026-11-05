# Support tickets — stop accidental duplicate tickets + visible numeric ticket ID

**Date:** 2026-11-05 · **App:** Muse (`musedashboard`) · **Process:** rigorous-build
**Owner report:** "Replying to a ticket shows a new ticket with Hien's original + my response; also each ticket needs a unique numerical ID."
**Status:** v2 — rewritten after LIVE reproduction corrected the root cause. (v1 chased a compose-vs-reply UX theory; disproven on prod.)

---

## 0. Root cause — established by live reproduction on prod (not theory)

Signed in as Carlos (admin), reproduced the exact flow in the live app + pulled the raw ticket objects:

**The duplicate is a double-submit at FILING time, not anything to do with replying.** The two
"Clock in/out on ipad" tickets:
- `tk-1793737027863-…` createdAt **12:17:07.863** (Hien's message only)
- `tk-1793737029528-…` createdAt **12:17:09.528** (Hien's message, identical text)

Two `ticket:` records, **1.7 s apart**, same submitter, same content → Hien's "New message" **Send
was tapped twice**. Carlos replied a day later (Nov 4) to one of them.

**Why it LOOKED like the reply caused it:** the list sorts by `updatedAt` desc and each row prints
`_fmt(t.updatedAt)` (support.js:98, :1201 worker sort). Replying bumped that ticket to the **top**
with **today's** date, so it read as a brand-new ticket next to Hien's untouched Nov-3 copy. Proof:
(a) the "new" ticket's `createdAt` is Nov 3, a day before the reply; (b) a **live reply test kept the
total at 6 tickets** and simply appended a 2nd message — the reply path threads correctly.

**The real bug:** `supportSend()` (support.js:158-171) has **no in-flight guard** — the Send button
stays enabled through the ~1.5 s round-trip (create + `loadTickets`), and the offline-flaky
connection here lengthens that window. A second tap files a second ticket. Same gap in
`supportReplySend` / `supportInboxReply` (a double-tap there double-posts a message).

## 1. Goal
1. **Stop accidental duplicate tickets** — the demonstrated double-submit — robustly.
2. **Visible numeric ticket ID** `#YYMMDD-NN` (owner's pick) on every ticket. (Also fixes the
   "looks new" confusion: a stable number on each row makes a re-sorted ticket recognizable as the
   same one.)

## 2. Part A — kill the double-submit (the actual fix)

### 2a. Client in-flight guard (primary) — `js/app/features/support.js`
- Add a module-level re-entrancy guard to **all three** send paths: `supportSend`,
  `supportReplySend`, `supportInboxReply`. On entry: if already sending, return; else set a
  `_sending` flag **and disable the Send button** (so a second tap is a no-op); reset in a `finally`.
- Pattern (per function): capture the button el, `if (_sending) return; _sending = true;
  btn.disabled = true; try { …existing fetch… } finally { _sending = false; btn.disabled = false; }`.
  (After `supportSend` success the view switches to the thread so the button is gone anyway; the
  guard closes the in-flight window that the double-tap actually exploits.)
- Keeps all current behavior (toasts, offline catch) — purely additive.

### 2b. Server idempotency (safety net) — `cloudflare/worker.js` create branch + `support-util.js`
- The client guard stops the common double-tap, but a flaky network (two taps that each reach the
  server, or a retry across a reconnect) can still race two creates. Close it server-side — the
  root-cause-proof fix.
- **Pure helper** `findRecentDuplicate(existingTickets, {submitterKey, subject, message, now,
  windowMs})` (support-util.js) → returns an existing **non-archived** ticket with the **same
  submitter** (prefer `submitterPushId`, else `submittedBy`), **same trimmed subject**, **same first
  message text**, created within `windowMs` (default **60 s**); else null. 60 s is far longer than any
  double-tap yet far shorter than a deliberate identical re-file; a real second ticket differs in
  content or comes much later.
- **In the create branch** (worker.js:1206-1228): run `findRecentDuplicate` over the `ticket:` map;
  if it matches, **return the existing ticket** (sanitized) instead of creating — so a double-submit
  resolves to the one ticket the user meant. This sits **inside the same `blockConcurrencyWhile`** as
  the NN assignment (§3b), so even two truly-concurrent identical creates serialize: the second sees
  the first's `put` and returns it.
- `submitterKey`: the server already stamps `who` from the session → use `canonicalPushId(who)` (the
  same value stored as `submitterPushId`), falling back to `who.name`.

## 3. Part B — numeric ticket ID `#YYMMDD-NN` (review-hardened design, carried forward)

### 3a. One shared day-code helper (no 3-way drift)
- `ticketDayCode(ts, tz)` → `'YYMMDD'` in **salon tz**, added to **both** `cloudflare/support-util.js`
  (worker) **and** `js/app/utils.js` (client), mirroring `monthOfTs` (worker.js:266 / utils.js:240),
  pinned together by a test like `test/stage0-tz.test.js`. (The worker copy isn't importable by the
  browser — the client must have its own.) Salon tz = `config:salon_tz || 'America/Los_Angeles'`.

### 3b. Generation (Worker create path)
- Additive field `num = "YYMMDD-NN"` (no `#`; UI adds it). Pure `nextTicketSeq(existingTickets,
  dayCode, tz)` → `1 + count of existing tickets whose ticketDayCode(createdAt,tz)===dayCode` (counts
  the full unfiltered set incl. resolved/archived so numbers never repeat same-day; prune only
  touches >180-day-old tickets). Zero-pad 2, widen past 99.
- In the create branch: add a `config:salon_tz` read (worker reads it nowhere today), reuse the
  `ticket:` map already listed at line 1215. **Wrap the dedup-check → count → `buildTicket` → `put`
  span in `this.state.blockConcurrencyWhile`** so NN is truly unique and idempotency is race-proof.
  `buildTicket` (support-util.js:55) gains a `num` param → sets `t.num`.

### 3b-note. Reply double-posting — knowingly-accepted residual
Part A's idempotency is on the CREATE path only. Replies/dev-replies are guarded by the client
`_sending` flag (covers the common same-client double-tap) but have **no server-side idempotency** —
a reply re-sent across a lost-response retry or from a second device would append the message twice.
This is accepted: the proven, reported bug is duplicate FILING, and a repeated thread message is far
less harmful than a twin ticket. Add reply idempotency later only if it shows up in practice.

### 3c. Legacy backfill — in `alarm()`, opportunistic, fault-isolated; PLUS a prompt first-load kick
- `_backfillTicketNumbers()` runs inside the DO's existing `alarm()` (worker.js:~1949, already lists
  `ticket:` + chunk-deletes stale) as **its own `try{}`** (a throw can't break live support).
  **No one-shot flag:** each pass fills `num` for any ticket still missing one (all-numbered → list +
  no-op loop). **Clobber-safe:** process same-day tickets in `createdAt` order, **re-`get` each ticket
  immediately before `put`** and skip if it already has `num` or is gone (so a concurrent reply/status
  `put` is never overwritten). The running per-day counter counts **every** same-day ticket (numbered
  or not) so assignments **agree with the create path's count+1**.
- **Prompt first-load kick (added after review):** `alarm()` only fires every 6h, so to avoid legacy
  tickets showing the non-unique date-only fallback for hours, the `GET /support/tickets` handler runs
  `_backfillTicketNumbers` **once per DO lifetime** (in-memory `_ticketNumKicked` flag set synchronously
  before the await so concurrent first-loads can't double-run). The first support-UI open after deploy
  returns a fully-numbered list. Steady-state cost: one extra `ticket:` list on the first GET after a DO
  (re)start, then a no-op. `alarm()` remains the guaranteed backstop.

### 3d. Display (client `support.js`)
- `_ticketNo(t)` → `#${t.num}` when present, else `#${ticketDayCode(t.createdAt, tz)}` (date-only,
  **same YYMMDD shape**). tz via `getState().config.salon_tz || 'America/Los_Angeles'` — **import
  `getState` from `../store.js`** (NOT `cfg`, which is settings.js-local and not exported).
- Show `#NN` (escaped, one helper) in: staff list `_listHtml` (94), staff thread `_threadHtml` (138),
  admin inbox list `_inboxListHtml` (254) + thread `_inboxThreadHtml` (281); the `Sent ✓` toast
  (169 → `Sent ✓ — ticket #NN`, `j.ticket.num` is in the create response); the admin new-ticket toast
  (193); and the two push bodies (`_notifySupportAdmin` w.js:1273 / `_notifySupportSubmitter` 1279) —
  a number isn't sensitive, stays within the "generic body" rule.

## 4. Part C — pre-compose nudge — ❌ SKIPPED (owner, 2026-11-05)
Not building this now. A + B fix the real bug; revisit only if duplicates persist. (Design kept
below for reference.) It only helps the *rarer* deliberate case: someone with a different
subject/message who files anew instead of replying (idempotency won't catch different content):
- Pure `findRecentOwnTicket(tickets, myName, now)` (open/replied, or resolved within 7 days — a reply
  reopens it). In `_composeHtml` (110), if matched, show a tappable banner **above** the fields:
  *"Continue your ticket #NN — <subject>?"* → `supportOpenThread(match.id)`.
- **Dropped from v1:** the send-time overlay confirm + `_forceNew` (the review's HIGH risk of losing
  the typed text, and now redundant — the submit guard + idempotency already stop accidental dupes).

## 5. Data-safety (live, financial-adjacent app)
- `num` is additive; **no persisted key renamed/removed; no one-shot flag.** Idempotency only changes
  the create path to *return an existing* ticket (reads the already-loaded map; creates nothing new on
  a match) — it cannot corrupt or merge data (match requires same submitter+subject+first-message
  within 60 s).
- Backups (R2 full-object dump, w.js:1951), restore (carries `ticket:` as-is, 2082-2087), factory
  reset (wipes tickets): all unaffected; `num` rides along. `sanitizeTicket` keeps `num`.
- `applyReply` / threading / unread machine / `ticketKey` / stale-guards: **untouched** (the reply
  path is proven correct — do not change it).

## 6. TDD test plan
- **`support-util.test.js`** (pure): `findRecentDuplicate` (same submitter+subject+message in window →
  match; different content/submitter → null; outside window → null; archived excluded);
  `ticketDayCode` (salon-tz day, en-CA, midnight-vs-UTC crossing, YYMMDD); `nextTicketSeq`
  (empty→01, same-day count incl. resolved/archived, day reset, pad, >99); `buildTicket` sets `num`;
  (`findRecentOwnTicket` if Part C).
- **`support-tickets.test.js`** (DO routing): **two identical creates in-window → second returns the
  SAME id, count stays 1** (regression-lock the bug); different message → 2 tickets; outside window →
  2; create stamps `num=YYMMDD-01`, 2nd distinct same-day → `-02`; **a reply does NOT change `num` or
  the count** (lock the live finding); `_backfillTicketNumbers` numbers legacy tickets, agrees with
  create's count+1 for mixed same-day state, is idempotent, skips a ticket mutated mid-pass; restore
  carries `num`.
- **client**: `_ticketNo` fallback renders without `num`; the in-flight guard logic (extract the
  guard so a double-call fires one fetch — a small testable wrapper, or a focused smoke note).
- Windows: per-file `node --test-force-exit --test <file>`; full suite after.

## 7. Build sequence
1. `support-util.js`: `findRecentDuplicate`, `ticketDayCode`, `nextTicketSeq`, `buildTicket` num
   (+ `findRecentOwnTicket` if Part C). Tests red→green.
2. `js/app/utils.js`: mirror `ticketDayCode` (+ pin test).
3. `worker.js`: create branch — read `config:salon_tz`; `blockConcurrencyWhile`{ dedup via
   `findRecentDuplicate` → return existing; else `nextTicketSeq` → `buildTicket(num)` → put };
   `_backfillTicketNumbers` as a try-block in `alarm()`; `#NN` in the two push bodies. DO tests.
4. `support.js`: in-flight guard on the 3 send fns; `_ticketNo` + the display spots + Sent/admin
   toasts; import `getState`. (+ Part C banner if approved.)
5. Version trio (`config.js` APP_VERSION, `version.json`, `sw.js` CACHE_NAME) + What's-New. No new
   client files → PRECACHE unchanged.
6. 3-lens review → fixes → senior review → fixes.

## 8. Deploy
- Worker changed → `wrangler deploy` REQUIRED (account `info@musenailandspa.com`) + Pages push; each
  needs explicit owner OK. Order **non-critical** (client fallback + old-client-ignores-field both
  degrade safely); follow project default **Worker FIRST, then Pages**.
- **Rollback:** fully additive, no flag → redeploy prior worker + prior Pages commit; `num` ignored by
  old code; idempotency simply stops applying; zero data loss. Tickets made during a rollback window
  get numbered on the next alarm after roll-forward (opportunistic, no permanent gap).

## 9. Existing duplicates (operational cleanup — separate from the code)
- The live data already has the `…027863`/`…029528` "Clock in/out" twins (+ my clearly-marked
  "TEST REPLY" on `…027863`). After deploy, the owner can **Resolve/Archive the duplicate** from the
  admin inbox. I will NOT touch real tickets without an explicit go-ahead. (Not a migration — just
  tidying two records.)

## 10. TurnDesk parity
Muse-first. On the later port: `findRecentDuplicate` + `nextTicketSeq` must scope per-salon in TD's
`__registry__`/multi-tenant DO; submitter identity differs. Flagged; not built here.

## 11. Decisions — LOCKED (owner, 2026-11-05)
- **Part C (pre-compose nudge): SKIP** — build A + B only.
- **Idempotency window = 60 s.**
- `#YYMMDD-NN` with `#` shown everywhere — yes.
- Accepted/not-fixed: a device in another tz near midnight can show a `_fmt` date one day off the
  salon-tz `#YYMMDD` — cosmetic, documented.
- Build + commit on `dev`; `git push` / `wrangler deploy` need explicit owner OK (not covered by the
  earlier port-task autopilot).

---

## Change log (v1 → v2, after live repro)
- **Root cause corrected:** double-submit at FILING (proven on prod: twins 1.7 s apart, createdAt
  pre-dates the reply; live reply test kept count at 6). The reply path is innocent.
- **Primary fix replaced:** out goes the compose-vs-reply nudge-as-the-fix; in comes the **client
  in-flight guard + server 60 s content-idempotency**.
- **Dropped** the send-time overlay confirm + `_forceNew` (review HIGH + now redundant). Pre-compose
  banner demoted to optional Part C.
- **Kept** the full review-hardened numeric-ID design (shared `ticketDayCode`, `getState` tz,
  `blockConcurrencyWhile` create, opportunistic clobber-safe `alarm()` backfill, toast/push numbers).
