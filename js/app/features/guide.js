// ── Guide — printable in-app documentation (Full + Quick reference) ────────────
// Opens a self-contained, print-friendly document in a new tab; "Print / Save as
// PDF" produces the PDF. Kept in code (not a committed binary) so it never drifts
// from the app. Exposed on window via main.js glue for the account-menu buttons.

const STYLE = `
*{box-sizing:border-box}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c1c1c;max-width:820px;margin:0 auto;padding:0 24px 64px}
.bar{position:sticky;top:0;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #ddd;margin-bottom:14px}
.bar button{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer}
h1{font-size:25px;margin:14px 0 2px}
h2{font-size:19px;margin:26px 0 6px;border-bottom:2px solid #eee;padding-bottom:4px}
h3{font-size:15px;margin:15px 0 3px}
p{margin:6px 0}ul,ol{margin:5px 0 5px 20px;padding:0}li{margin:3px 0}
.sub{color:#666;font-size:13px;margin-top:0}
code{background:#f1f1f1;border-radius:4px;padding:1px 5px;font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13.5px}
th,td{border:1px solid #dcdcdc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f7f7f7}
.step{background:#f7f5fe;border:1px solid #e2d9f7;border-radius:8px;padding:10px 14px;margin:8px 0}
@media print{.bar{display:none}body{max-width:none;padding:0}}
@page{margin:1.4cm}
`;

function openDoc(title, html) {
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups for this site to open the guide.'); return; }
  w.document.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
    `<style>${STYLE}</style></head><body>` +
    `<div class="bar"><strong>${title}</strong><button onclick="window.print()">Print / Save as PDF</button></div>` +
    html + `</body></html>`);
  w.document.close();
}

export function openAppGuide() { openDoc('Muse — App Guide', FULL); }
export function openAppQuickRef() { openDoc('Muse — Quick Reference', QUICK); }

// ── Full guide ──
const FULL = `
<h1>Muse — App Guide</h1>
<p class="sub">The salon front-desk app. This guide covers the daily workflow, each screen, and the key buttons. It runs on the front-desk iPad and on technician devices, and syncs live across all of them.</p>

<h2>The day in one line</h2>
<div class="step">Customer <strong>checks in</strong> → appears in the <strong>Queue</strong> → you <strong>Assign &amp; Price</strong> a technician and services → the service moves through its <strong>status</strong> (waiting → in service → done) → <strong>Pay</strong> (cash, card, gift card, tips) → it lands in <strong>Reports</strong>. The <strong>Turns</strong> tab keeps tech rotation fair; the <strong>cash drawer</strong> is opened and closed each day.</div>

<h2>Header &amp; your account</h2>
<ul>
<li>Top-right shows who's signed in. <strong>Tap your name</strong> for your account menu: <strong>Clock in / out</strong>, the <strong>App guide</strong> and <strong>Quick reference</strong> (this document, printable to PDF), <strong>What's new</strong>, and <strong>Log out</strong>.</li>
<li>The <strong>version number</strong> is the update button: it shows a <code>↻</code> when a new version is available — tap it to reload fresh. Tapping it any time also reopens <strong>What's new</strong>. If a screen ever seems stuck, tap the version badge to reload.</li>
<li>The <strong>search</strong> box finds customers and past tickets fast.</li>
</ul>

<h2>Check-in</h2>
<ul>
<li>Customers check themselves in at the kiosk (or you check them in at the front desk). Returning customers are matched by phone; new ones are added to the directory.</li>
<li>Checked-in customers drop into the <strong>Queue</strong> as waiting.</li>
</ul>

<h2>Queue &amp; Assign &amp; Price</h2>
<ul>
<li>The <strong>Queue</strong> lists everyone waiting or in service, each as a card with a status dot/pill.</li>
<li>Tap a card → <strong>Assign &amp; Price</strong>: choose the technician, add the services and any items/fees, set tips/discounts. This sets the ticket's price (the single source of truth for what's owed).</li>
<li>While someone has a ticket open on another device, it's locked to avoid two people editing the same ticket at once.</li>
</ul>

<h2>Status flow</h2>
<p>Each service shows a colored dot + pill so the floor can read state at a glance: <strong>waiting</strong>, <strong>in service</strong>, <strong>done</strong>. The same styling appears on Queue, Turns, and Floor cards.</p>

<h2>Turns (rotation)</h2>
<ul>
<li>Tracks each technician's turn count so work is shared fairly. A customer's turn number shows on the top-right of their card; <strong>half turns</strong> appear in a small amber box.</li>
<li>Use it to decide who's "up" next. History is kept on a rolling window.</li>
</ul>

<h2>Floor plan</h2>
<p>A visual map of stations with technician avatars. Drag a tech to a station; each station type has its own capacity. Good for seeing who's where at a glance.</p>

<h2>Pay / checkout</h2>
<ul>
<li>From a ticket, <strong>Confirm Payment</strong> opens checkout: choose the tender(s) — <strong>cash</strong>, <strong>card</strong>, <strong>gift card</strong> — split across tenders if needed, add <strong>tips</strong>, and apply a <strong>gift-card redemption</strong> or discount.</li>
<li><strong>Card payments run on the Helcim Smart Terminal</strong>: confirm the amount on the app and the customer taps/inserts on the terminal; the app waits for the result and records it.</li>
<li>You can also <strong>mark a ticket paid without charging a card</strong> (e.g. cash already taken) — it still records the sale.</li>
<li><strong>Reprint a receipt</strong> from the transaction; <strong>refunds</strong> for card sales go back to the original card.</li>
</ul>

<h2>Quick Sale</h2>
<p>Sell a retail item or a gift card without a service ticket — a fast no-service checkout.</p>

<h2>Customers</h2>
<p>The <strong>Customers</strong> tab is your directory: search, add, edit, de-dup, import, and per-customer notes (kept by phone number). The app is the source of truth for the directory.</p>

<h2>Gift cards</h2>
<p>Sell gift cards (cash or card) and redeem them at checkout. Balances are tracked in the app.</p>

<h2>Cash register / drawer</h2>
<ul>
<li><strong>Open</strong> the drawer with a starting count at the start of the day; record <strong>cash in / out</strong> as needed.</li>
<li><strong>Close</strong> the drawer with a counted total to reconcile against expected cash; over/short is recorded (and pushed to Back Office). A PDF summary is available.</li>
</ul>

<h2>Appointments (calendar)</h2>
<p>Appointments are backed by Google Calendar and shown in the app. Columns and display hours are adjustable. Appointment reminders can be sent by text.</p>

<h2>Reports, payroll &amp; refunds</h2>
<ul>
<li><strong>Reports</strong>: pick a date range, compare periods, see a performance chart, and drill into the day's transactions.</li>
<li><strong>Transactions</strong>: every sale, with the ability to view, reprint, refund, or edit a historical record.</li>
<li><strong>Payroll</strong>: technician earnings from the records, plus a <strong>Front Desk — Hourly</strong> section (hours × rate) with a manager timecard editor.</li>
</ul>

<h2>Time clock (front desk)</h2>
<p>Front-desk staff clock in/out from their account menu (tap your name). Punches feed the hourly payroll section; clocking is locked to the front-desk station.</p>

<h2>Settings</h2>
<p>Services, items &amp; fees catalog; staff &amp; schedules; stations; appearance; payment processor; texting; integrations (including the Back Office daily-sales sync); photos/logo; and data tools.</p>

<h2>Technician app</h2>
<p>Technicians sign in on their own device to see their queue/turns and (for front-desk users) a read-only schedule + hours view.</p>

<h2>End of day</h2>
<div class="step">Finish open tickets → <strong>close the cash drawer</strong> (count + reconcile) → check <strong>Reports</strong> for the day → daily totals sync to Back Office automatically.</div>

<h2>Good to know</h2>
<ul>
<li>Everything syncs live across devices; if a device goes offline it catches up when it reconnects.</li>
<li>A ticket's price is always the live total — services + items×qty + fees − discount.</li>
<li>If anything looks stale or stuck, tap the version badge to reload.</li>
</ul>
`;

// ── Quick reference (1 page) ──
const QUICK = `
<h1>Muse — Quick Reference</h1>
<p class="sub">The front-desk essentials on one page.</p>

<h2>The flow</h2>
<table>
<tr><th>Step</th><th>What to do</th></tr>
<tr><td>1. Check in</td><td>Customer checks in (kiosk or front desk) → lands in the <strong>Queue</strong></td></tr>
<tr><td>2. Assign &amp; Price</td><td>Tap their Queue card → pick technician + services/items, tips/discount</td></tr>
<tr><td>3. Service</td><td>Status moves waiting → in service → done (colored dot/pill)</td></tr>
<tr><td>4. Pay</td><td><strong>Confirm Payment</strong> → tender (cash / card / gift card), add tip. Card runs on the Helcim terminal.</td></tr>
<tr><td>5. Done</td><td>Sale records into <strong>Reports</strong></td></tr>
</table>

<h2>Top-right (your name)</h2>
<ul>
<li><strong>Clock in / out</strong>, <strong>App guide</strong>, <strong>Quick reference</strong>, <strong>What's new</strong>, <strong>Log out</strong>.</li>
<li><strong>Version badge</strong> = reload button (shows <code>↻</code> when an update is ready; tap any time for What's new). Stuck screen? Tap it to reload.</li>
</ul>

<h2>Common tasks</h2>
<table>
<tr><th>Task</th><th>Where</th></tr>
<tr><td>Sell retail / a gift card (no service)</td><td><strong>Quick Sale</strong></td></tr>
<tr><td>Redeem a gift card</td><td>At checkout, choose gift card as a tender</td></tr>
<tr><td>Reprint a receipt / refund a card</td><td>Transactions → the sale</td></tr>
<tr><td>Find a customer or past ticket</td><td><strong>Search</strong> (header)</td></tr>
<tr><td>Who's up next</td><td><strong>Turns</strong> tab</td></tr>
<tr><td>Add a tech to a station</td><td><strong>Floor plan</strong> (drag)</td></tr>
</table>

<h2>Open &amp; close the day</h2>
<ul>
<li><strong>Open</strong> the cash drawer with a starting count.</li>
<li><strong>Close</strong> it with a counted total to reconcile (over/short is recorded and synced).</li>
<li>Check <strong>Reports</strong> for the day's totals.</li>
</ul>
`;
