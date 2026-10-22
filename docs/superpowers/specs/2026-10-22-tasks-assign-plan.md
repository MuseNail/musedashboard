# Plan — Tasks: assignable, front-desk + technician (Wave 2 #5 / roadmap #11) — v2 (post-review)

Date: 2026-10-22 · Repo: musedashboard (ports to TurnDesk) · Area: tasks (calendar.js) + tech staff app (staff.js + staff.html) · desktop-first for the FD half, phone for the tech half

> **v2 note.** A 4-lens adversarial review found the data model + FD half sound but the **technician half
> mis-grounded**, plus several unmade decisions. All structural fixes folded in:
> - **Staff-app header is STATIC in `staff.html:79-90`** (with the Log out button), NOT rendered by
>   `renderMain` (which only rewrites `#staff-list` + sets `#staff-tech-name`). → The Tasks button is added to
>   `staff.html`'s header; its badge is updated explicitly in `render()` AND an explicit tasks-refresh is wired
>   into the staff `store.subscribe` callback (mirroring `updateChatBadge`/`onChatSync` at staff.js:971), so a
>   front-desk assignment updates the badge + any open overlay live.
> - **`toggleTask` is NOT reachable from staff.js** (no calendar.js import; it also touches dashboard-only DOM).
>   → The tech overlay dispatches `task.upsert` (or `task.patch`, see Sync) **directly in staff.js**.
> - **Shared pure helpers live in `utils.js`** (both apps already import it) — NOT calendar.js.
> - **The button must be hidden for an FD user in the staff app** (`renderFdView` shares the same static header);
>   gate it on tech identity.
> - **Overlay = reuse the existing CENTERED-modal pattern** (staff.html calc/note modals: `fixed inset-0 flex
>   items-center justify-center bg-black/50`, backdrop-click close), not a net-new slide-over.
> - Decisions settled as defaults below; 3 genuine ones go to the owner (Sync A/B, techs-see-Anyone, delete).

## Owner decisions (locked at kickoff)
- Assignable to **front desk AND technicians** (extend to the staff app).
- A non-manager sees **only their own + unassigned ("Anyone")** tasks; managers see all.
- **Managers only** can set/change an assignee (`canDo('manageStaff')`); anyone can add + complete.
- Replace the bare `prompt()` add with a **real modal**.
- Tech app: a **dedicated Tasks button on the right of the header** (count badge), NOT a 4th tab; tapping opens
  a Tasks overlay of that tech's assigned + Anyone tasks, which they can check off. (Mockup approved.)

## Grounded facts
- **Task shape** (`getState().tasks`, each): `{ id, title, notes, due, completed, completedAt, list, sortIndex,
  createdAt }` (calendar.js:1618). Ops `task.upsert`/`task.delete` already exist across sync/store/DO — **a new
  `assignee` field needs NO new op** (it rides task.upsert, stamped updatedAt/updatedBy by dispatch sync.js:318).
- **Current UI** (calendar.js): `loadTaskLists`→`loadTasksForList`→`renderTasks`; add via `showAddTaskModal()` =
  `prompt('New task title:')` (calendar.js:1670); `toggleTask`/`deleteTask` dispatch task.upsert/delete.
- **People/assignee scheme**: `chatPeople()` (chat.js:35) → `[{pid:'fd:'+id,name,kind:'fd'}, {pid:'tech:'+id,
  name,kind:'tech'}]` from `cfg().fd_users` + active `cfg().staff`. Assignee = one of those pids, or `''` = Anyone.
- **Current pid** per surface (myPid is module-private to chat.js, so resolve locally):
  - Dashboard (calendar.js): `getActiveUser()` → `fd:<id>`; manager = `canDo('manageStaff')`.
  - Staff app (staff.js): the logged-in tech `meStaff.id` → `tech:<id>` (techs only complete, never assign).
- **Staff app** (staff.js `renderMain`:310): teal header banner (flex, name left) + a tab row
  (`Now · Appts · History`, History gated by `appPerm('history')`). `_view` holds the active tab; `staffTab(id)`
  switches. The tech app already re-renders on store changes, and tasks sync there already.

## Design

### Data (additive) — helpers live in `utils.js`
- `task.assignee`: a pid string (`fd:<id>` / `tech:<id>`) or `''` (Anyone). Absent/'' on every legacy task →
  Anyone, so old data needs no migration.
- `task.assigneeName`: a **name snapshot** stamped at assign time, so the label survives a tech being
  deactivated/removed from `chatPeople()` (which would otherwise orphan the label).
- Pure, unit-tested helpers in `utils.js` (reachable by BOTH apps):
  - `taskVisibleTo(task, myPid, isManager)` → manager: always true; else `!task.assignee || task.assignee === myPid`.
  - `assigneeLabel(task, people)` → `'Anyone'` for `''`; else the live name from `people`, else `task.assigneeName`
    (snapshot), else `'Unknown'`.
  - `taskBadgeCount(tasks, myTechPid)` → count of **directly-assigned** open tasks (`assignee === myTechPid &&
    !completed`). **Anyone tasks do NOT inflate the badge** (a standing team task would otherwise nag every
    phone forever); they still appear inside the overlay.

### Front desk (calendar.js — the dashboard tasks panel)
0. `calendar.js` must **import `chatPeople` from chat.js** (for the picker + the row pill); it doesn't today.
   Current pid = `getActiveUser() ? 'fd:'+getActiveUser().id : ''` (null-guarded, mirroring chat.js:31).
1. **Filter** in `loadTasksForList`: after the list filter, keep only `taskVisibleTo(t, fd:<activeUser.id>,
   canDo('manageStaff'))`. (Completed-task display unchanged; the list-name dropdown stays unfiltered — a
   non-manager may pick an empty list and see "all caught up" — accepted, minor.)
2. **Assignee tag** on each task row in `renderTasks`: a small pill — the assignee's first name, or "Anyone"
   (neutral). Managers get an inline reassign affordance (tap the pill → a people picker); non-managers see the
   tag read-only.
3. **Real add-task modal** (replaces `prompt()`): a reused app modal with Title (required), Due (date, optional),
   and — **managers only** — an Assignee `<select>` built from `chatPeople()` (+ "Anyone"). Non-managers: no
   picker; the task is created as Anyone. On save → `dispatch('task.upsert', {task:{…, assignee}})`. Keep
   `showAddTaskModal` as the entry (open the modal instead of prompting); add `submitAddTask()`.
4. **Reassign** (managers): `setTaskAssignee(taskId, pid)` → `dispatch('task.upsert', { task:{...t, assignee:pid} })`.
   Gated `canDo('manageStaff')` (defense-in-depth: the picker only renders for managers, and the handler re-checks).

### Technician staff app (staff.js + staff.html)
5. **Header Tasks button** — add static markup to the `staff.html` header (next to Log out, left of it) with an
   id (`staff-tasks-btn`) + a badge span (`staff-tasks-badge`). `onclick="staffOpenTasks()"`. Gate visibility to
   **tech identity**: shown in `renderMain` (tech), hidden in `renderFdView` (FD-in-staff-app). `render()`/
   `renderMain` explicitly set the badge text + show/hide (the header is NOT auto-rebuilt — mirror how
   `#staff-tech-name` is set at staff.js:314).
6. **Tasks overlay** (`staffOpenTasks`/`staffCloseTasks`): a **centered modal** matching the existing staff
   calc/note modals (`fixed inset-0 flex items-center justify-center bg-black/50`, backdrop-click + a close
   button + Esc). Lists this tech's visible tasks grouped **Assigned to you** / **For anyone** (see Q2), each a
   row with a complete checkbox + title + due. Read-only otherwise. The complete handler **dispatches directly
   in staff.js** (NOT `toggleTask`): re-find `t` from live `getState().tasks`, then the Sync write below.
7. **Live refresh**: add an explicit tasks-refresh to the staff `store.subscribe` callback (staff.js:971,
   alongside `updateChatBadge()`): recompute the badge via `taskBadgeCount`, and if the overlay is open,
   re-render its body. So a front-desk assignment updates the tech's phone without a manual refresh. (Skips
   while `priceInputFocused()` short-circuits render — self-heals on blur; acceptable.)

### Sync / data-safety — OWNER DECISION (Q1)
`assignee`/`completed` both live on the task object. Two ways to write:
- **A — whole-task `task.upsert` (Pages-only, accept a narrow revert).** Complete + reassign both ship the whole
  task; last-writer-wins. The one overlap: a tech completing from a **stale** phone (the known sleep-stale case,
  [[project-stale-wake-resync]]) after a manager reassigned → the stale complete reverts the assignee. BUT the
  task is then **done**, so the reverted assignee is cosmetic (nobody else needs to pick it up). Unlike the
  staff/payroll case, both colliding fields here are low-stakes and the task is complete — so whole-task LWW is
  genuinely defensible here. No Worker change.
- **B — `task.patch {id, fields}` field-merge op (needs a Worker deploy).** Mirror `staff.patch`: complete ships
  `{id, fields:{completed, completedAt}}`, reassign ships `{id, fields:{assignee, assigneeName}}`; the DO merges
  by id (serial, atomic) so neither can clobber the other. Ironclad assignment, consistent with staff.patch;
  costs a `cloudflare/worker.js` change + `wrangler deploy`.
- **Recommendation: A.** The victim here is a cosmetic assignee on an already-completed task (not payroll), so
  the root-cause fix buys little; A keeps it Pages-only. Choose **B** only if you want assignment to be
  bulletproof even against a stale-phone completion.

## Test plan (TDD)
- Unit (`test/tasks-assign.test.js`, import setup-globals): `taskVisibleTo` (manager sees all; non-manager sees
  own + '' only; not someone else's) and `assigneeLabel` ('' → Anyone; known pid → name; unknown pid → fallback).
- DOM/wiring (modal, header button + badge, overlay, reassign gating) → diff review + preview boot check (handlers
  on window; modal + button render; non-manager has no assignee picker).
- Full suite green, per-file on Windows.
- Owner eyeball: FD manager adds + assigns a task; a non-manager FD user sees only theirs + Anyone; a tech opens
  the header Tasks button, sees their assigned + Anyone, checks one off; the count badge updates live.

## Rollback
Additive: one optional `assignee` field (old tasks read as Anyone), a modal, a filter, a tag, a reassign handler,
and a staff-app header button + overlay. No schema/op/Worker change → **Pages-only**. Revert = one commit.

## Settled defaults (folded from the review — not asking, but noting)
- Helpers in `utils.js`; tech complete dispatches directly in staff.js; button in staff.html header, gated to
  tech identity; badge + open overlay refreshed via an explicit hook in staff `store.subscribe`.
- Badge = **directly-assigned** open count only (Anyone tasks appear in the overlay but don't inflate it).
- Orphaned assignee (deactivated tech): `assigneeName` snapshot keeps the label; the task stays
  **manager-visible** for reassignment (hidden from non-managers, by the visibility rule).
- Reassign UI = the same `chatPeople()`-built `<select>` as the add modal (no separate picker component).
- Add-task modal = **new static markup in `index.html`** (there's no existing task modal to reuse); Title
  (required) + Due + (managers) Assignee. A non-manager's new task is created as **Anyone**.
- **Push on task-assignment = OUT OF SCOPE for v1** (appointments push via `_notifyApptTechs`; tasks won't ping
  yet — a tech sees an assignment next time they open/refresh). Easy Pages-only follow-on if wanted.
- Completed tasks drop from the tech overlay's open list once checked (matches the badge).

## Open questions for the owner
1. **Sync A vs B** (above) — A (Pages-only, accept a cosmetic assignee-revert on a stale-phone completion) or B
   (`task.patch` field-merge, needs a Worker deploy, bulletproof). **Recommend A.**
2. **Do technicians see "Anyone" tasks, or only tasks assigned directly to them?** The mockup showed a "For
   anyone" group (e.g. "wipe chairs before close" — a floor task any tech can grab). But today's dashboard tasks
   are front-desk to-dos (supply orders), all unassigned → on day one they'd ALL show to every tech as "Anyone."
   (a) **Techs see assigned + Anyone** (per mockup; day-one: managers should tidy/assign the existing FD list, or
   techs briefly see it) — or (b) **Techs see ONLY tasks assigned directly to them** (no Anyone on the tech side;
   zero day-one leak; the FD "Anyone" bucket stays front-desk-only). **Recommend (b)** for a clean launch; the
   "Anyone, grab-it" floor-task idea can be a later addition.
3. **Delete policy (front desk):** today ANY front-desk user can delete ANY task. With shared "Anyone" team
   tasks, do you want delete **gated to managers** (non-managers can add + complete but not delete others'
   tasks), or keep **anyone-can-delete**? **Recommend managers-only delete** (consistent with managers-assign).
4. **Add-modal Notes field** — include an optional Notes line (the task shape already has `notes`), or keep it
   Title + Due + Assignee only?
