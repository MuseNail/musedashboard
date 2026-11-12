# Notification center (unified bell) — plan (v2, post-review)

**Goal:** Replace the scattered, unexplained indicators (esp. the Settings red dot that "leads nowhere inside") with ONE header **bell** whose count = everything pending, every row in plain language and tappable straight to its source — and crucially, **tapping a row actually clears it**. Surface the silent sources (overdue tasks, failed financial writes). Built to grow.

Read-only on all data. No synced-state/schema/Worker/storage change. Client-only. Fully reversible.

**Owner decisions so far:** mostly-replace (bell owns the signals, chat button stays) · include all six sources · always-present bell, badge only when >0 (Q3, review-endorsed).

**v2 rewrite** folds in the 4-lens adversarial review (data-safety / correctness / sequencing / completeness). Key changes vs v1 are called out inline as **[R]**.

---

## The six sources — count, clear behavior, drill, role

Clear behavior is first-class now: a bell item must clear by acting on it, or it recreates the dead-end.

| # | Row | Count (read) | **Clears when** | Drill | Role | Color |
|---|---|---|---|---|---|---|
| 1 | Failed writes | `failedOps().length` **[R: dead-letter ONLY — NOT in-flight outbox]** | admin resolves/clears in Data Recovery | Settings→Data Recovery | admin (**+manager? OWNER Q2**) | danger (red) |
| 2a | New support tickets | `supportAdminUnreadCount()` (unreadForDev, non-archived) — **one row per ticket** | manager opens that ticket (`supportInboxOpen` clears unreadForDev) | Settings→Support, that thread | admin/manager | accent |
| 2b | Reply to your ticket | `supportUnreadCount()` (unreadForSalon) — **one row per ticket** **[R: all-roles signal, was missing]** | staffer opens that thread | `openSupport()` thread | all | accent |
| 3 | Unread chat | `chatUnreadCount()` | opening the channel / each DM thread (**[R]** DMs persist per-thread) | `toggleChat()` | all | teal |
| 4 | Overdue tasks | `tasksOverdueCount(tasks,myPid,isMgr,now)` **[R: overdue-only, reuse utils helpers]** | completing / rescheduling the task | `openTasksPanel()` (new) | per-user visibility | amber |
| 5 | Clock station changed | `clockNeedsAttention()` = **'warn' only** **[R: exclude the permanent 'notice' state]** | admin re-confirms the station | `onClockBtn()` | admin | amber |
| 6 | Update ready | `updateAvailableVersion()` truthy | applying the update | `showUpdatePopup(v)` | all | neutral |

Bell badge number = sum of included counts for the signed-in role. Badge is **red only if a failed-write (danger) item is present**, else teal. Order = danger → support → chat → tasks → clock → update.

**[R] Label fix:** `failedOps()` holds ALL rejected ops (config.set, giftcard.save, …), not just sales. Row title = **"Writes that didn't save"** (not "sales"); it drills to Data Recovery, which owns all of them.

**[R] "Mark all read" is DROPPED.** It is semantically wrong for 4 of 6 sources (failed-writes/clock/update/tasks are *resolved*, not *read*). Each row clears by acting on it. (A chat+support-only "clear" can be a later add; not v1.)

---

## New exported accessors to add (additive, read-only)
- `support.js`: `supportAdminUnreadCount()`, `supportUnreadList()` / `supportAdminUnreadList()` (per-ticket rows), promote `supportIsAdmin()` to an export.
- `utils.js` **[R]**: `tasksOverdueCount(tasks, myPid, isManager, now)` next to the existing tested `taskBadgeCount`/`taskVisibleTo` — pure, overdue = `due && due<now && !completed && visibleTo(me)`. (Field is `completed`, not `done`.) Unit-tested in `test/tasks-assign.test.js`.
- `timeclock.js`: `clockNeedsAttention()` = `_clockState==='warn'` (factor the state test so the dot and this agree).
- `main.js`: `let _updateAvailableVersion=null` set inside `checkAppVersion`; `window.updateAvailableVersion=()=>_updateAvailableVersion`.
- `notifications.js` imports each accessor via **ES import** (NOT off `window`, to avoid glue-order races) **[R]**.

## Refresh architecture **[R — no sync.js edits]**
One debounced `refreshNotifBell()` (a `_nbTimer` ~150ms, mirroring `renderSyncBanner`'s `_sbTimer`). Wired into:
- `onStateChange` — called **unconditionally near the top, BEFORE the `changed==='connection'` early-return** (main.js:862), so it catches connection changes (offline→online), `chat.append`, and `task.*` ops — none of which enter the config/hydrate branch. This single placement covers store sources 1,3,4,5 **and** the dead-letter/outbox path (deadLetter→setConnection→notify('connection')). **No edits to sync.js `saveOutbox`/`deadLetter`.**
- `paintSupportBadges` (support HTTP poll — source 2, not in the store).
- `checkAppVersion` (source 6, not in the store).
- `clearFailedOp` + the Data-Recovery resolve path (so the danger count drops immediately when an admin clears one).
- A **60s fallback** interval (`!document.hidden`) + a boot call next to `refreshAccountUnread()` (main.js:1100).

Debounce makes a write-burst (outbox replay) coalesce to one repaint instead of one-per-op — no repeated 200-payload `failedOps()` parses on the hot path.

---

## Markup / placement (index.html)
`#notif-bell-wrap` (`position:relative`) in the right cluster, between `#app-version-badge`/`#clock-popover` (241) and `#chat-btn` (242): `#notif-bell-btn` (Material `notifications`) + `#notif-bell-badge`, and `#notif-panel` (absolute dropdown). Outside-click dismissal mirrors the Turns `#turns-more-menu` `.open` pattern (one module-level listener, `e.target.closest('#notif-bell-wrap')`, no stopPropagation) — coexists with the existing user-menu/turns-more/clock-popover listeners. **[R] z-index:** panel ≥ 63 (above `#user-menu` 61, `#clock-popover` 62), no `overflow:hidden` ancestor clip. CSS in `css/styles.css`, section marker.

Panel = header ("Notifications") + rows (icon tile in category color, title, sub, chevron) + empty state ("You're all caught up"). Muse Material-3 look (teal `#1a5252`, status palette, Material Symbols, big touch targets).

### "Mostly replace" — kept vs removed
- **REMOVE** the Settings nav support dot: make `_paintSettingsDot` a **no-op** (keep the rest of `paintSupportBadges` intact — it still paints `#support-badge` + calls `refreshAccountUnread`) **[R: deleting the fn alone would throw ReferenceError inside paintSupportBadges and break the 20s admin poll]**.
- **KEEP** `#chat-btn` (owner).
- Bell **always visible** on desktop + tablet (do NOT add it to the ≤1194 `#chat-btn,#support-btn,#customer-screen-btn{display:none}` rule). Verify panel fits under the 48px tablet bar (drops below, `max-height:calc(100dvh-120px); overflow-y:auto`) at 1194 + 820px.
- **Support button + iPad avatar badge** — now safe to fold in, because the bell carries BOTH admin-new-tickets and salon-side replies for all roles → **OWNER Q1** (fold/remove vs keep).

## Guards **[R]**
- **Signed-out / kiosk:** `getActiveUser()` null → every source gates to false → no badge. Bell lives ONLY in the `#screen-desk` header; never on welcome/kiosk (can't flash counts at a customer).
- **Silent/visual-only:** the bell adds NO new sound and NO new push; it summarizes the existing toasts/push, not replaces them.
- **Accessibility:** bell `aria-label="Notifications, N pending"`, `aria-expanded` tied to `.open`, panel `role="menu"`, an `aria-live="polite"` count region.
- **Chat row honesty:** opening chat clears group channels; unread DMs persist until each thread is opened — the bell legitimately may still show a chat count after closing chat.

## Roles
- Failed-writes (src1): admin (**+manager per Q2**). Admin-support (2a): admin/manager. Salon-support (2b), chat, tasks, update: all (tasks per-user-visible). Clock (5): admin.
- A role with zero eligible pending items → no badge, empty panel.

## Data-safety / rollback
- Strictly read-only; the bell never dispatches, never calls `clearFailedOp` itself (drilling to Data Recovery owns resolve). No write-path edits **[R]**. No storage/schema/Worker change.
- **Full rollback set [R]:** delete `notifications.js`; remove the bell markup (index.html) + CSS; revert the one-liners in `onStateChange`, `paintSupportBadges`, `checkAppVersion`, `clearFailedOp`; remove the new exports in support/utils/timeclock/main; restore `_paintSettingsDot` to painting; remove the `notifications.js` line from `sw.js` PRECACHE; revert the version trio. No persisted data touched.

## Tests (TDD) **[R — test the counts, not just the sort]**
Pure, exported, unit-tested:
- `tasksOverdueCount(tasks,myPid,isMgr,now)` — overdue filter + visibility (in `test/tasks-assign.test.js`).
- `clockNeedsAttention` mapping — state→bool (warn true, notice/clock/hidden false).
- `buildNotifItems(counts, role)` — order (danger first), role-gating (non-admin excludes failed-writes + admin-support), zero→empty, badge-color (danger→red).
Full suite stays green (per-file on Windows).

## Deploy
Client-only → Pages. Version trio (config.js + version.json + sw.js) + `notifications.js` in `sw.js` PRECACHE + What's-New. Explicit `import * as notifications`/`Object.assign(window,...)` glue line in main.js. dev→main ff. Push needs owner OK.

---

## Decisions for owner (sign-off)
- **Q1 — fold the Support button + iPad avatar badge into the bell, or keep them?** Now safe either way (bell carries new-tickets AND replies-to-you for all roles). Recommend: **fold/remove both** — one place, no duplicate signals. (Chat button stays regardless.)
- **Q2 — should a MANAGER (not just an admin) see the "a write didn't save" danger alert?** They often run the desk. Data Recovery itself is admin-only. Recommend: **show the count to admin + manager**; for a manager the row says "a sale didn't save — tell an admin" (or we make Data Recovery manager-visible). Or: accept admin-only as a limitation.
- **Confirm the refinements** (I've decided these from the review; flag if you disagree): failed-writes = stuck/rejected only (normal offline stays on the sync pill) · tasks = overdue only · clock = the station-mismatch warning only · bell silent/visual-only · "Mark all read" dropped (each row clears by acting on it).
