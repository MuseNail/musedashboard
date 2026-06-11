# TurnDesk — new-project kickoff prompt

> **STATUS: PAUSED (2026-06-03)** until musedashboard is fully stable — do not start without the owner un-pausing it.
> **How to use:** start a brand-new chat (ideally in the new TurnDesk repo once it exists, or in any working folder to begin) and paste everything below the line. It's self-contained.
> **Note (2026-06-11):** the old `TURNDESK-PORT.md` port tracker was deleted — the authoritative replay list when resuming is simply `git log` on musedashboard since the fork point (or re-fork fresh; much has shipped since, incl. the in-repo Helcim integration which supersedes parts of the adapter plan below).

---

You are starting **TurnDesk**, a new product. Read this whole brief before acting, then propose a short P0 plan and wait for my go-ahead.

## What TurnDesk is
TurnDesk is the **public, multi-tenant SaaS** version of an existing, live single-salon app called **musedashboard** (a nail-salon front-desk PWA: check-in queue, a fair-rotation "turns" engine, floor plan, reports, payroll, gift cards, Square POS). musedashboard is battle-tested in one real salon. TurnDesk takes that proven app and turns it into a product I can sell to **hundreds/thousands of independent nail salons**, with **pluggable payment processors** (each salon uses whatever they have: Square, Stripe, or Helcim).

**Critical:** the existing `musedashboard` repo/app stays **live and untouched**. TurnDesk is a **completely separate** repo + Cloudflare Worker + Cloudflare account + data. Nothing you do can touch the live salon.

## Source to copy from
The current app lives at: `C:\Users\cpach\Documents\GitHub\musedashboard`
- Vanilla **ES modules** under `js/app/` (`store.js`, `sync.js`, `session.js`, `config.js`, `utils.js`, `main.js` + `features/*.js`); one `<script type="module">` in `index.html`. No build step, no frameworks (Tailwind CDN only). GitHub Pages serves it.
- Backend: a Cloudflare **Worker** (`cloudflare/worker.js`) with a **Durable Object** (`MuseSalonDO`) as the source of truth; client syncs over WebSocket + `/state` HTTP fallback with an offline outbox via `dispatch(op, payload)`. Also: Square proxy, R2 photos, KV, daily cron, Web Push.
- Read its `CLAUDE.md` for architecture/conventions, and the memory file `project_turndesk_plan.md` for the full plan.

## LOCKED DECISIONS (owner, 2026-05-28 — do not relitigate)
1. **Name:** TurnDesk (working name). New repo, new Worker, app base path `/turndesk/`.
2. **Repo:** **fresh clean GitHub repo** — copy the musedashboard files, **no git history**. Keep musedashboard for reference.
3. **Cloudflare:** **separate Cloudflare account under the SAME email login** (one login can own multiple accounts). New Worker + per-tenant Durable Object + new R2 bucket (`turndesk-photos`) + new KV + own secrets + own `turndesk.<subdomain>.workers.dev`.
4. **Tenancy:** **multi-tenant, ONE Durable Object instance per salon (tenant)**, keyed by tenant id. One Worker codebase + one deploy serves all; each salon's data is isolated in its own DO + R2 prefix; signup auto-provisions a tenant DO. Build in **stages** (working single-salon early, but the tenant seam present from day one — no later rewrite). This is an **evolution** of musedashboard's single `MuseSalonDO`.
5. **Payments:** **processor adapter layer from day one.** A common interface — `createCheckout / refund / handleWebhook / status` — implemented by `SquareAdapter`, `StripeAdapter`, `HelcimAdapter`. The active processor is chosen per-tenant in config. Migrate the existing Square code into `SquareAdapter`; build **`HelcimAdapter` FIRST**; stub `StripeAdapter`. Card data must never touch the app (keep PCI scope light across all adapters).

## Helcim integration facts (already researched — use these)
- Helcim has a **Smart Terminal API / Payment Hardware API**: your Worker pushes a Purchase/Refund to a paired Helcim device; the customer taps/chips; a **webhook** returns the result. Server-driven (Worker holds the API token → Helcim cloud → device), works from desktop or tablet, no Helcim POS app needed on the controlling device. RESTful.
- Devices: Smart Terminal GEN1/2 + Card Reader GEN3. Pair via a 4-digit **device code**. **Smart Terminal ($349)** = standalone Wi-Fi, API mode, built-in printer+screen (safe choice). **Card Reader GEN3 ($99)** = Wi-Fi/cloud, API-supported, but **confirm with Helcim that the API pushes to it without the POS app** ("Standalone Mode" was "coming") before relying on the cheap unit.
- Itemize via invoice/line items. Rates: interchange-plus ~2.0–2.2% effective. Signup needs SSN (standard KYC).

## Build sequence
- **P0 — Fork + isolate + blank twin.** Create the fresh repo from musedashboard; rebase `/musedashboard/` → `/turndesk/` everywhere (`sw.js` PRECACHE_URLS, `manifest.json` + `manifest-staff.json` scope/start_url, any absolute paths); set up the separate Cloudflare account + new Worker + per-tenant DO class + R2/KV + secrets; point `config.js` ORIGIN/proxies at the new Worker; deploy an empty working twin. **Verify it shares zero data with the live salon.**
- **P1 — Payments adapter + Helcim.** Define the adapter interface; move Square → `SquareAdapter`; build `HelcimAdapter` (pair via device code, charge, refund, webhook handler); stub `StripeAdapter`.
- **P2 — Choose-your-processor.** Per-tenant settings to pick + connect the active processor.
- **P3 — Multi-tenancy + accounts.** Tenant id → DO routing; real auth/accounts (email/OAuth, roles, tokens — replace PIN-only); signup auto-provisions a tenant DO + config; zero cross-tenant leakage.
- **P4 — Billing + onboarding.** Stripe subscriptions (plans/trials/dunning/lock-on-decline); self-serve onboarding + owner admin console.
- **P5 — Public polish.** Accessibility (WCAG/ADA audit — it's touch-first today), marketing site, docs, DR/SLA + status page, observability/support.

## Owner action items (I do these; you can't)
- Create the new **GitHub repo** + enable GitHub Pages.
- Create the new **Cloudflare account** (under my email) and run all `wrangler deploy`s / `wrangler secret put`s — deploys are mine, never run them yourself.
- Open the **Helcim** account + get API access + confirm the device/API specifics.

## Standing working rules (carry over from musedashboard)
- **Commit freely, but ASK before every `git push`.** Never run `wrangler deploy` (owner's job).
- **Verify each change** (preview / tests) before committing. Keep changes staged and reviewable.
- Plain ES modules, no build step, no frameworks (Tailwind CDN) — same as musedashboard, unless we deliberately decide otherwise for the product.
- Pricing/legal/productization context is in the musedashboard memory `business_productization_plan.md` (niche = independent nail salons; moat = the turns engine; subscription per-location; gift-card law + PCI notes).

**First reply:** confirm you've absorbed this, then give me a concrete **P0 checklist** (exact files to copy, every `/musedashboard/`→`/turndesk/` path to change, the new `wrangler.toml` shape with the per-tenant DO binding, and the secrets list) — and tell me which owner action items to do first. Do not start writing code until I say go.
