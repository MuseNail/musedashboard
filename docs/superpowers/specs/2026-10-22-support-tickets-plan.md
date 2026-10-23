# Support tickets for Muse — plan (Wave 3 #16)

**Status:** PLAN — awaiting adversarial review + owner sign-off. No code yet.
**Date:** 2026-10-22. Target repo: `musedashboard`. Adapts TurnDesk td-v0.49 help-desk.

---

## Goal

**Technical:** A durable, two-sided, in-app ticket channel. Staff file a ticket (bug / question /
request) from the dashboard; it persists as a first-class DO entity (`ticket:<id>`), surfaces to an
admin inbox in Settings; the admin replies and sets status; the submitter sees the reply. Threaded,
with a two-sided unread state machine, poll-driven unread badges, and best-effort push. Ports
TurnDesk's tenant-agnostic core (`support-util.js`, the `support.js` staff modal) and DROPS all its
multi-tenant plumbing (`__registry__` DO, per-salon keys, `operator.html`, cross-salon inbox).

**Plain English:** Right now, when someone at the front desk hits a problem or has a request, it gets
lost in chat or said out loud and forgotten. This adds a proper "Help & Feedback" button: a staffer
writes it up, it lands in a tracked list the manager sees in Settings with a little unread dot, the
manager writes back, and the staffer sees the reply — a real back-and-forth that doesn't disappear at
the end of the day. It's separate from the automatic error log (Diagnostics), which keeps doing its
own thing.

---

## ⭐ THE core decision for sign-off — who is the "dev" side?

TurnDesk is SaaS: salon staff file tickets to the **TurnDesk developer** (the vendor), who reads a
cross-salon inbox in `operator.html`. Muse is a **single salon with one Durable Object and no operator
page**. So "staff ⇄ dev" has to be re-mapped. Options:

- **(A) RECOMMENDED — Internal: staff → owner/manager (admin).** The admin IS the "dev" side. Front-desk
  staff file tickets; the owner/manager reads + replies + resolves them in an admin-only Settings
  section. Fully in-app, nothing external to host, immediately useful (out-of-stock, "card reader is
  acting up", "can we add X"). This is the faithful single-salon analogue — admin inbox stands in for
  `operator.html`.
- **(B) External: salon → the app developer (me).** The owner/staff file tickets to the software
  developer. Problem: single-salon Muse has no developer surface to reply from; I'd have to build/host
  an operator page or reply through an admin route only I can reach. Awkward, and overlaps the
  bug-reporter (which already pings the dev). Not recommended for single-salon.

**My recommendation: (A).** It needs no external host, reuses the whole two-sided machine with
admin = the responder, and is the thing a busy salon actually benefits from. (B) can be layered later
if you ever want a true owner→developer channel — the bug-reporter already covers urgent dev alerts.

**This plan assumes (A).** If you want (B), the storage/routes stay nearly identical but the "dev" surface
and push targeting change — say so and I'll re-scope.

---

## Decisions to confirm (beyond the big one above)

1. **Who can FILE?** TD v1 = front desk (dashboard) only; techs couldn't. 
   - **Recommend: front-desk/dashboard only for v1**, techs as a fast-follow. Keeps v1 tight (no
     staff.html modal + poll + push surface). You leaned toward including techs on the tasks feature,
     so if you want techs filing from their phones too, I'll add it — it's ~1 extra surface.
2. **Who SEES the ticket list on the staff side?** TD showed the whole salon's tickets to any staff
   member. 
   - **Recommend: match TD** — all front-desk staff see the shared list (small team; simpler). The
     admin inbox is the only place with reply-as-dev + status powers. (Alternative: staff see only
     their own tickets. More code, marginal benefit for one salon.)
3. **Ticket types.** Port TD's `bug / question / feedback`. 
   - **Recommend: `Problem / Question / Request`** (friendlier wording; same 3-way). Confirm or rename.
4. **Push.** Best-effort only (poll + unread dot is the reliable signal, as in TD). New ticket → push
   the admin; admin reply → push the submitter. **Recommend a new push id `'support'`** for the admin
   alert (keep it distinct from the bug-reporter's `'errors'` id so they can be silenced
   independently). Confirm.

---

## Data model — `ticket:<id>` (ported from TD `buildTicket`, salon field dropped)

```js
{
  id,                      // 'tk-<now>-<rand8>'
  submittedBy,            // display name, stamped SERVER-SIDE from the session
  submitterRole,          // e.g. 'frontdesk' | 'manager' — server-stamped
  submitterPushId,        // 'fd:<id>' | 'tech:<id>' | null — INTERNAL, stripped from client views
  appVersion,             // client APP_VERSION, ≤20 chars (diagnostic)
  type,                   // 'problem' | 'question' | 'request'  (confirm wording)
  subject,                // ≤120
  status,                 // 'open' | 'replied' | 'resolved' | 'archived'
  createdAt, updatedAt,   // epoch ms
  unreadForDev,           // admin has unseen activity (new ticket / staff reply)
  unreadForSalon,         // submitter/staff have an unseen dev reply
  messages: [ { from:'salon'|'dev', author, text, at } ],   // ≤100, newest kept
}
```
Caps (port verbatim): `MAX_MESSAGE=5000`, `MAX_SUBJECT=120`, `MAX_THREAD=100`.

> Note: the field names `unreadForDev` / `from:'dev'` are kept from TD to minimise port risk and keep the
> pure core + tests identical; "dev" means the admin/owner here. Documented in a header comment.

---

## Storage & durability (the data-safety heart — follows the `waiver:<id>` template exactly)

- **Key:** `ticket:<id>` in the salon's own DO. One prefix, no `<salon>:` segment.
- **NOT broadcast / not in `buildSnapshot`.** Like waivers, ticket threads can carry free-text
  complaints; they are fetched **on-demand** (`GET /support/tickets`, prefix-list) + polled, never
  synced into the cached state blob on every device. This is the privacy-preserving choice and matches
  both TD (fetch+poll) and the Muse waiver precedent.
- **Backup:** add a `backups/tickets-<ts>.json` dump in the DO `alarm()`, in its own `try` (a failure
  can't block the state backup), under its own prefix with an `isTicketDump(key)` guard so retention
  (keep newest ~30) never prunes it as a state snapshot and restore never restores FROM it. Mirrors the
  waiver dump at worker.js:1625-1633 / :780 / :1701.
- **Restore & factory-reset carry-through (HIGH-RISK edit):** in `restoreFromBackup` and `factoryReset`,
  list live `ticket:` keys BEFORE `deleteAll()` and merge them into the keep/puts set — exactly as
  waivers (worker.js:1745-1752) and `fleet:` are carried. Tickets survive a restore and a factory reset
  by design. **This is the one place that touches existing data-safety code and must be tested
  explicitly** (restore + reset both preserve tickets).
- **Additive:** `ticket:` is a brand-new prefix. No existing key is renamed or migrated. Nothing else
  changes. (Satisfies the CLAUDE.md persisted-data rules: additive, with backup + rollback below.)

---

## Routes (single-tenant, all behind the §13 `appAuthOk` gate; some admin-gated server-side)

Submitter identity + role resolved SERVER-SIDE from the session token (never trusted from the client
body) via an `authIdentity`-style helper that calls the DO `/auth/check` (returns
`{kind,id,name,role}` — confirmed at worker.js:1567). Mirrors TD's `authIdentity`.

| Method | Path | Who | Does |
|---|---|---|---|
| GET  | `/support/tickets` | any staff | list `ticket:` prefix, drop archived, newest-`updatedAt` first, **sanitized** (strip `submitterPushId`). Also returns an admin `unread` count. |
| POST | `/support/ticket` | any staff | `{type,subject,message,appVersion}` → `buildTicket` (submitter server-stamped) → put → push admin → return sanitized. Rate-limit `suprl:<ip>` 30/hr; open-ticket cap 100 → 429. |
| POST | `/support/ticket/<id>/reply` | any staff | `{message}` → `applyReply({from:'salon'})` → push admin. |
| POST | `/support/ticket/<id>/dev-reply` | **admin only** | `{message}` → `applyReply({from:'dev'})` + `markRead('dev')` → push submitter. |
| POST | `/support/ticket/<id>/status` | **admin only** | `{status}` (open/replied/resolved/archived) + `markRead('dev')`. |
| POST | `/support/ticket/<id>/read` | any staff | `{who}` — **server clamps**: non-admin may only clear `'salon'`; admin may clear `'dev'`. |

- **Admin-gating is SERVER-ENFORCED** on `dev-reply` + `status` (and the `'dev'` side of `read`): the
  route resolves the session user's role and rejects non-admins (403). Client hiding of the inbox is
  cosmetic only. (Exact admin role set — owner/manager — grounded against `fd_users` roles + the
  client `canDo('manageStaff')` mapping during build.)
- All `/support/*` are authed (NOT exempt like `/report`): only signed-in staff file tickets.
- These are **plain authed HTTP routes** (like TD), not `dispatch` mutate ops. Tickets don't need the
  offline-outbox replay that waivers do (a waiver must survive an offline kiosk; a ticket can require
  connectivity). This keeps `applyChange`/`store.js`/`sync.js` untouched — lower blast radius.

---

## Client surfaces

- **Staff modal — `features/support.js` (NEW, ported from TD almost verbatim):** overlay with the
  `_view` state machine (`'list' | 'compose' | 'thread'`), `_openId`, `_pollTimer`, the **`isEditing()`
  guard** (a background poll must never wipe what the user is typing), `paintUnreadDot`,
  `pollSupportUnread`, 20s in-modal poll, optimistic read-clear. Fetch paths lose the salon param;
  otherwise unchanged.
- **Settings nav — `Help & Feedback`** (all staff) → `openSupport()`. Mirror TD settings.js:383
  (`action:'openSupport'`, `icon:'support_agent'`).
- **Admin inbox — a new adminOnly Settings section `Support` (sibling to Diagnostics), standing in for
  `operator.html`:** reuses the Diagnostics server-fetch+render pattern (diagnostics.js). Lists ALL
  tickets with filters (type/status/unread), opens a thread, reply-as-dev, set status
  (open/replied/resolved/archived). `{ adminOnly:true, render:'renderSupportInbox', icon:'support_agent' }`.
- **`main.js`** — startup + 3-min `pollSupportUnread()` (gated on `!document.hidden && activeUser`),
  plus add `support` to the `window` glue list; add `renderSupportInbox` to the glue.
- **(If techs can file — decision #1)** a `staff.html` entry point + poll; otherwise untouched.

---

## Push + the one `sw.js` change

- Reuse the existing `/push/*` + VAPID stack wholesale (confirmed: `/push/subscribe|notify`,
  `sendPushToTech`, VAPID helpers). 
- **New ticket / staff reply → push admin** on push id `'support'` (new; the admin opts in — reuse the
  Diagnostics "enable alerts" subscribe pattern, or auto-subscribe the dashboard). Tag `muse-ticket-admin`.
- **Dev reply → push submitter** via `ticket.submitterPushId` (`fd:<id>`/`tech:<id>`), best-effort.
  Tag `muse-ticket-reply`.
- **`sw.js` `notificationclick` gap (real fix needed):** today ALL pushes open `staff.html`. Route by
  tag: `muse-ticket-admin` → `index.html` (dashboard → Settings → Support); `muse-ticket-reply` →
  `staff.html` (or dashboard if the submitter is front desk). This is a genuine sw.js change → part of
  the version bump + a hard-reload for the SW to update.

---

## Reconciliation with the existing bug-reporter — KEEP THEM SEPARATE

The bug-reporter (`/report`, `report:errors`, Settings → Diagnostics) is **automatic, passive,
one-way** error capture — not user-authored, no replies. Support tickets are a **new, user-authored,
two-way** channel. They share only the push stack and the Settings home. **Do not merge them.**
Diagnostics stays exactly as-is; `Support` sits beside it. (Rejecting the "just make /report two-way"
shortcut: /report is auth-exempt and fingerprint-deduped for crash capture — wrong shape for authored
threads.)

---

## Ported from TD vs dropped

- **KEEP (tenant-agnostic):** all of `support-util.js` (`validateTicketInput`, `validateReplyInput`,
  `buildTicket`, `applyReply` unread/status machine, `markRead`, `canonicalPushId`, caps) minus the
  `salon` field + `ticketVisibleToSalon`. The `support.js` staff modal nearly verbatim.
- **DROP (multi-tenant):** `__registry__` DO + `registryStub`/`registryPost`, the `<salon>:` key
  segment, server-side salon stamping, `ticketVisibleToSalon` 404-isolation, `operator.html` + all
  `/operator/*` routes, the cross-salon `/support/all`, `buildRegistrySnapshot` + the registry `alarm()`
  branch. Replaced by: tickets in the one salon DO, admin Settings section as the dev surface, backup
  folded into the salon DO's own `alarm()`.

---

## Test plan (TDD)

- **`test/support-util.test.js`** (pure, ported): validate accept/trim/reject, caps, `buildTicket`
  server-stamp + `unreadForDev=true`/`unreadForSalon=false` + single salon message, `applyReply`
  (salon→unreadForDev keep-open; dev→unreadForSalon+status replied; reopen resolved→open on staff
  reply; cap newest), `markRead` one-sided, sanitize strips `submitterPushId`.
- **`test/support-tickets.test.js`** (DO-integration, single-tenant): create stores `ticket:<id>` with
  server-stamped submitter + `unreadForDev`; create rejects bad input (400) + enforces rate-limit (429)
  + open-cap (429); list newest-first minus archived, sanitized; two-way thread grows + flips unread +
  status; **admin-gating** — non-admin `dev-reply`/`status` → 403; `read` who-clamp (non-admin can't
  clear `'dev'`); **backup** — `alarm()` writes `backups/tickets-*.json` containing the ticket;
  **restore + factory-reset BOTH carry `ticket:` keys through** (the data-safety tests).
- Full suite stays green (Windows per-file runner).

---

## Staging / sequencing (compose with the `ship` skill)

1. Build client + Worker behind the version bump on `dev`; TDD throughout.
2. **Deploy Worker FIRST** (`wrangler deploy`, verify account `info@musenailandspa.com`), as with
   v5.68/v5.69 — new `/support/*` routes must exist before any client calls them.
3. Then bump trio + What's-New + precache `support.js`, push Pages (dev→main).
4. Both the `wrangler deploy` and the `git push` need explicit owner OK (standing rule).

---

## Migration & rollback (data-safety)

- **Migration:** none. `ticket:` is a new prefix; no existing key touched; `applyChange` untouched.
- **Backup:** the new `backups/tickets-*.json` dump means tickets are recoverable from day one.
- **Rollback:** revert the release commit + redeploy the prior Worker. The new routes simply stop being
  called; existing `ticket:` keys remain inert and harmless (and still backed up). The restore/reset
  carry-through edits are additive (extra keys kept through a wipe) and reverting them only stops the
  carry-through — it can't corrupt state.
- **Blast radius:** the only edits to existing high-risk code are (a) `restoreFromBackup` + (b)
  `factoryReset` carry-through and (c) the DO `alarm()` backup branch and (d) `sw.js` notificationclick
  routing. Each mirrors an existing, tested pattern (waivers/fleet) and gets its own test.

---

---

## Revisions from the adversarial plan review (v2 — 4 lenses: data-safety, correctness, sequencing/ops, completeness)

All findings below are APPLIED into the design above (treat this section as the authoritative overlay).
No false positives worth rejecting; a couple are consciously accepted for v1 and marked so.

### Correctness / security (net-new admin-gating is the real risk area)
- **Admin role set is PINNED, hardcoded, server-enforced:** admin-gated routes (`dev-reply`, `status`,
  the `'dev'` side of `read`) and the admin-inbox visibility both use the app's existing pattern
  `role === 'admin' || role === 'manager'` (as in reports.js:1545/1760, helcim.js:69) — NOT the
  owner-editable `canDo('manageStaff')`, which would let client and server diverge. The client gate uses
  the SAME hardcoded check.
- **Role is re-resolved live (fixes 30-day stale-token):** the §13 session stores the role at login
  (`sess.role`) and never re-reads it, so a demoted manager would keep reply/resolve for up to 30 days.
  The admin-gated routes therefore re-resolve the CURRENT role from `config:fd_users` / `staff` by
  `sess.id` at request time — never trust `sess.role` for authorization.
- **`/support/*` is handled DO-INTERNALLY** (inside the salon DO `fetch`, like `/push/*`), reading
  `sess:<token>` directly — no Worker→DO `/auth/check` self-subrequest, no `authIdentity` port. This is
  the single-DO-native shape and makes the live role re-resolve trivial (the DO already holds fd_users).
- **Admin nav-dot uses `unreadForDev`, staff nav-dot uses `unreadForSalon`** — branch the ported
  `pollSupportUnread`/`paintUnreadDot` by viewer role. The admin `unread` count is returned only to
  admins (not leaked onto the shared staff list).
- **`/read` clamp defaults `who='salon'`** when absent/invalid (the ported `openThread` POSTs `/read`
  with no body); a non-admin can only ever clear `'salon'`. The admin inbox must POST
  `/read {who:'dev'}` on thread-open (read-only view) so `unreadForDev` clears without needing a reply.

### Push (reuses /push + VAPID; one sw.js change)
- **Submitter push is DROPPED for v1 (accepted):** in front-desk-only v1 the submitter is on the
  dashboard, which never subscribes `push:fd:<id>:` (only the staff app does, staff.js:962). So a reply
  push to an FD submitter would hit zero subscriptions. v1 signals the submitter via **poll + Settings
  nav dot only**. (If techs can file later, their staff-app push works and we re-enable it for techs.)
- **Admin alert push is opt-in via a Diagnostics-style toggle** under a new id `'support'` (NOT
  auto-subscribe — that needs a Notification permission prompt). The reliable admin signal is the
  nav-dot poll; push is the bonus. New ticket / staff reply → push id `'support'`, tag `muse-ticket`.
- **`sw.js notificationclick` carries the destination in the push PAYLOAD** (`data.url`) and routes by
  it — tags alone can't tell an FD submitter (dashboard) from a tech (staff app). Admin alert →
  `index.html`. Restructure the current "focus any staff window" loop to honor the payload path.
- **Push bodies are GENERIC** ("You have a new support message") — never put user-authored ticket text
  on a lock screen.

### Data-safety (two backup-code edits the v1 plan under-specified)
- **`pruneBackups` (worker.js:1700) must also exclude `isTicketDump`** and give tickets their own
  retention partition (`ticketBackups.slice(30)` → `safeDel`), mirroring `waiverBackups`/`waiverDel`
  (:1701-1704). Otherwise a `backups/tickets-*.json` is treated as a prunable state snapshot and can
  evict a real historical state recovery point.
- **"Restore latest" (worker.js:1719) and the explicit-key guard (:1721) must exclude `isTicketDump`** —
  else a ticket dump (written last, newest `uploaded`) gets picked as the restore source and DR restore
  errors out. Add `isTicketDump(key)` beside `isWaiverDump` (:780).
- **Factory-reset vs restore are DELIBERATELY ASYMMETRIC (owner decision #6):** tickets are CARRIED
  through `restoreFromBackup` (restoring last week's state must not delete this week's tickets) but
  CLEARED by `factoryReset` (a factory reset is an intentional wipe-to-empty; tickets are operational,
  not legal records like waivers). Recommended default; confirm.
- **Retention prune:** resolved + archived tickets older than ~180 days are pruned in the DO `alarm()`
  so `ticket:` keys don't grow unbounded over a multi-year single salon. Open/replied are never pruned.

### Sequencing / ops / rollback
- **Deploy order = Worker FIRST, then Pages.** **Rollback order = the MIRROR: Pages first, then Worker**
  (revert the new client before the Worker, so no live new-client calls a route the rolled-back Worker
  lacks).
- **A Worker rollback re-arms a tickets wipe:** if the Worker is later rolled back to a version WITHOUT
  the carry-through, the next restore/reset `deleteAll()` won't re-put `ticket:` keys → tickets lost.
  Documented: prefer keeping the Worker forward; if it must roll back, recover tickets from the last
  `backups/tickets-*.json`.
- **Open-ticket cap excludes `resolved`** and surfaces a clear "inbox full — ask the manager to clear
  tickets" message, not a bare 429 — otherwise an un-triaged inbox hitting 100 locks staff out of
  filing. The `suprl:<ip>` create limit uses a per-window overwrite key (bounded, like `reprl:`).
- **SW-update caveat:** the `notificationclick` change only takes effect after the device picks up the
  new `sw.js` (network-first + the known "first reload may serve stale" limitation; `install` does
  `skipWaiting`, `activate` does `clients.claim()`). Until then early ticket pushes may open the old
  default (staff.html). Self-heals on the ↻ hard-reload. Stated, not blocking.

### Completeness / product
- **Admin inbox is NET-NEW UI, scoped as its own build** — Diagnostics is read-only; the real template
  is TD's `operator.html` (renderThread / sendDevReply / setTicketStatus / filters). Built in Muse's
  component + TOKEN style (no hardcoded `#fff` inputs — that was TD's dark-mode bug; use the tokenized
  input style). Includes an **Archived filter + unarchive** control (else archive is invisible-forever).
- **All visible "TurnDesk"/"Support team" strings re-skinned** to Muse wording (the internal `dev`
  field names stay, documented). Keep the "please don't include card numbers" compose hint.
- **Offline/error state in the staff modal:** distinguish a load failure ("You're offline — tickets
  need a connection") from a genuinely empty list (the ported modal swallows errors → false "No
  messages yet").
- **Admin-files-own-ticket defined:** suppress self-notify and auto-clear `unreadForDev` on a ticket
  whose submitter is the acting admin (don't ping/booldface yourself).
- **Support vs Tasks vs Chat — explicit delineation (added to the feature + What's-New):** Chat =
  real-time talk (clears daily). Tasks (v5.69) = assignable to-dos with a done state. **Support =
  durable, tracked issues/requests to the manager with a two-way thread + status that persist until
  resolved.** Prevents three "tell the manager" surfaces from confusing the team.

### Tests added beyond the v1 list
- `/support/*` returns 401 when unauthenticated (the stated security property).
- Admin-gating: non-admin `dev-reply`/`status` → 403; `/read` who-clamp.
- **Live role re-resolve:** a session whose stored `sess.role` is admin but whose current fd_users role
  is frontdesk is REJECTED from admin routes (and vice-versa).
- `pruneBackups` does not evict a state snapshot in favor of a ticket dump; restore-latest skips ticket
  dumps; restore CARRIES tickets, factory-reset CLEARS them.
- Retention prune drops an old resolved ticket, keeps an old open one.

---

## ✅ OWNER DECISIONS — LOCKED 2026-10-22 (signed off; build may proceed)

1. **Model = (A) internal** staff → owner/manager. Admin is the "dev" side, replying in an admin-only
   Settings inbox.
2. **Filing = front desk / dashboard only for v1.** Techs deferred. ⇒ submitter-push stays DROPPED for
   v1 (no staff-app subscription); submitter signal = poll + dashboard-button unread dot.
3. **File entry = a DEDICATED DASHBOARD BUTTON** (like chat's), NOT a Settings item. So:
   - **Staff FILE + view-threads** via the dashboard header button; its unread dot = `unreadForSalon`
     (a manager reply they haven't read).
   - **Admin RESPONDS** in the adminOnly Settings → **Support** inbox; the Settings-nav unread dot =
     `unreadForDev` (new tickets / staff replies awaiting the admin), admin-gated.
   - An admin is also front-desk, so they see the button too; admin-files-own-ticket suppresses
     self-notify + auto-clears `unreadForDev` on their own ticket.
4. **Type wording = `Problem / Question / Request`.**
5. **Staff list = shared** (all front-desk staff see the salon's ticket list).
6. **Admin push = opt-in toggle** under a new `'support'` id (nav dot is the reliable signal).
7. **Factory reset CLEARS tickets; restore PRESERVES them** (asymmetric, per the data-safety section).

**Honest scope note:** this is NOT a light port. The pure core + staff modal port cleanly, but the
admin inbox, the role-gated/role-re-resolving DO routes, the push wiring, and the sw.js routing are
net-new. Realistically a v5.68/v5.69-scale change or a touch larger, with a Worker deploy. Worth doing
right given it's a live financial app.
