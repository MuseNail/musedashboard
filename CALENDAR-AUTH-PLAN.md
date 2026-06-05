# Google Calendar auth — server-side refresh-token plan

**Created 2026-06-05.** Fixes the recurring "calendar loses sync" problem (worst on iPad). Owner chose the **proper fix** (not just a mitigation). This is the implementation scope for a future build session.

---

## The problem (root cause)
The app uses Google Identity Services (GIS) **browser token flow** (`js/app/features/calendar.js`, `loadGCalScripts` / `_calTokenClient.requestAccessToken`). That flow:
- issues an **access token that expires every ~1 hour**, and
- renews it by a **silent** `requestAccessToken({prompt:''})` that depends on the **Google session cookie** in the browser.

On iPad this silent renewal is unreliable / impossible:
- **Safari ITP** partitions/blocks the Google third-party cookie.
- A **home-screen (standalone) app** has no Google cookie jar at all.
- The **Square pay deep-link reloads the app into Chrome** → a *different* browser context with its own (empty) Google session → renewal fails there too.
- When the iPad **sleeps**, the proactive `setTimeout` refresh is suspended; on wake the token has lapsed and the silent renewal fails.

Result: the access token lapses and can't auto-renew → "disconnected." A **manual reconnect works** only because it's an interactive tap (the one thing Safari still allows). Hence "once I resync it's good, but it keeps dropping."

**No amount of client-side tweaking removes this** — it's inherent to the browser token flow on iOS.

## The fix
Move OAuth to the **Worker**, using the **authorization-code flow with a refresh token** (`access_type=offline`). The Worker stores the salon's Google **refresh token** and mints short-lived access tokens on demand. The iPad never relies on Safari/Chrome silent renewal again — it just asks the Worker for a token. Works identically in the PWA, Safari, and Chrome.

This also neutralizes the "pay reloads into Chrome" context-switch problem for the calendar (and that deep-link path itself goes away with the Helcim poll→webhook rewrite).

---

## Architecture

### Google Cloud config (one-time)
- The existing `GCAL_CLIENT_ID` is a **Web** OAuth client → reuse it. In Google Cloud Console for that client:
  - Retrieve/record its **client secret** (Web clients have one).
  - Add an **Authorized redirect URI**: `https://musedashboard.musenailandspa.workers.dev/gcal/callback`.
- Scopes unchanged (Calendar + Tasks, see `GCAL_SCOPES`).

### Worker (`cloudflare/worker.js`) — 3 endpoints + token cache
- **`GET /gcal/connect`** → 302 redirect to Google's auth URL with `response_type=code`, `access_type=offline`, `prompt=consent` (force a refresh token), the scopes, `redirect_uri=<worker>/gcal/callback`, and a `state` (CSRF + which device kicked it off).
- **`GET /gcal/callback?code=...`** → exchange the code at `https://oauth2.googleapis.com/token` (POST: `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`). Store the returned **`refresh_token`** in the DO (e.g. key `gcal:refresh`) — this is the salon-wide calendar connection. Return a tiny HTML page that closes the popup / redirects back to the app.
- **`GET /gcal/token`** (the hot path) → if a cached access token is still fresh (DO key `gcal:access` with its expiry, refreshed >5 min before expiry), return it; else use the stored refresh token (`grant_type=refresh_token`) to mint a new access token, cache it, and return `{ access_token, expires }`.
  - **Must be auth-gated** (returns a live Google token) — use the shared-token gate from the §13 Worker-auth work. (If §13 isn't done yet, gate it with a simple shared secret in the meantime.)
- **`POST /gcal/disconnect`** → revoke the token at Google + delete `gcal:refresh` / `gcal:access`.
- **Secrets:** `GCAL_CLIENT_SECRET` (+ the existing client id). Refresh/access tokens live in DO storage, set at runtime by the callback (not a deploy-time secret).

### Client (`js/app/features/calendar.js`) — rework the auth section (~lines 311–420)
- Replace the GIS token client with a `fetchWorkerToken()` that `GET`s `/gcal/token` and stores `{token, expires}` (localStorage + DO-shared `gcal_token` can stay as a cache).
- `ensureFreshToken()` → when not fresh, `await fetchWorkerToken()` (always succeeds server-side; no 20s GIS hang, no ITP).
- "Connect Google Calendar" button → open `/gcal/connect` (popup or full redirect). On return, fetch a token and run the initial load.
- Disconnect → call `/gcal/disconnect`.
- Keep the focus/visibility refresh + on-demand `ensureFreshToken` (they now hit the Worker and actually work). The proactive `setTimeout` becomes optional (the on-demand fetch is the source of truth).
- The 401-on-read/write handlers (`_calWriteError`, the read 401 path) → on 401, just re-fetch from the Worker and retry (no user tap needed).

---

## Migration & rollout
1. Configure the Google Web client (secret + redirect URI) and set `GCAL_CLIENT_SECRET` in the Worker; deploy the 3 endpoints.
2. Owner does the new **Connect** once (consent screen) → seeds the refresh token in the DO. Permanent thereafter (refresh tokens persist unless revoked, unused ~6 months, or the Google password changes).
3. Ship the client rework. Keep the old GIS path behind a flag until the new flow is verified live on the iPad, then remove GIS (`gsi/client` script + `_calTokenClient`).
4. Verify: connect once, then let the iPad sleep / switch between the home-screen app and Chrome / cross the 1-hour mark — calendar stays connected with no manual reconnect.

## Edge cases
- **Refresh token revoked / 6-month idle / Google password change** → `/gcal/token` 401s → client shows a one-tap "Reconnect" → owner re-consents once. Rare.
- **Multiple devices** → all fetch from the Worker; one cached access token is shared. No per-device silent refresh.
- **Token security** → `/gcal/token` returns a live Google access token, so it MUST be auth-gated (don't expose the salon's calendar to anonymous callers). This is why it pairs with §13 Worker auth.

## Sequencing
- Independent of payments, so it **can be done before Helcim** — but the `/gcal/token` endpoint needs an auth gate, so it naturally **bundles with the §13 Worker-auth pass** (do them in the same Worker deploy). If the daily pain warrants it, do this first with a minimal shared-secret gate and fold it into full §13 later.
- `wrangler deploy` is the owner's job (walk through it step by step). Owner also does the one-time Google Cloud config + the one-time Connect.

## Interim option (if not building this immediately)
A client-only mitigation can reduce the pain without the Worker work: a persistent one-tap **"Reconnect Calendar"** banner the moment the token lapses (instead of a transient toast), plus a foreground refresh heartbeat. Does NOT stop the hourly lapse on iPad — only makes recovery instant and obvious. (Owner chose the proper fix, so this is a fallback only.)
