'use strict';
const fs = require('fs');

// ─── Read source ──────────────────────────────────────────────────────────────
const src   = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = src.split('\n');

// ─── CSS: extract <style>…</style> ───────────────────────────────────────────
let cssStart = -1, cssEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '<style>')   { cssStart = i + 1; }
  if (cssStart >= 0 && lines[i].trim() === '</style>') { cssEnd = i; break; }
}
if (cssStart < 0 || cssEnd < 0) throw new Error('Cannot find <style> block');

// ─── JS: find the main <script> block (no src, after line 2000) ──────────────
let jsStart = -1, jsEnd = -1;
for (let i = 2000; i < lines.length; i++) {
  if (lines[i].trim() === '<script>') { jsStart = i + 1; break; }
}
if (jsStart < 0) throw new Error('Cannot find main <script> block');
for (let i = jsStart; i < lines.length; i++) {
  if (lines[i].trim() === '</script>') { jsEnd = i; break; }
}
if (jsEnd < 0) throw new Error('Cannot find </script> after JS start');

const jsLines = lines.slice(jsStart, jsEnd);

// ─── Section-marker detection ─────────────────────────────────────────────────
// Real markers: start with '//' at column 0 + many box-drawing chars (─ U+2500)
// Indented sub-markers (e.g. inside DOMContentLoaded) are excluded by the col-0 check.
const BOX_CHARS = new Set(['─', '–', '—', '―', '━']);

function isSectionMarker(line) {
  if (!line.startsWith('//')) return false; // must be at column 0
  let boxCount = 0;
  for (const c of line) { if (BOX_CHARS.has(c)) boxCount++; }
  return boxCount >= 6;
}

function extractSectionName(line) {
  let s = line.replace(/^\/\/\s*/, ''); // strip leading //
  // Remove all box-drawing chars and surrounding whitespace
  s = s.replace(/[─–—―━]+/g, ' ').trim();
  return s;
}

// ─── Section → file routing ───────────────────────────────────────────────────
// Order matters: first match wins. More-specific entries go first.
const ROUTES = [
  // Config / state
  ['Config',                                                  'js/config.js'],
  ['State',                                                   'js/config.js'],
  ['Global State',                                            'js/config.js'],
  ['Queue Persistence',                                       'js/queue.js'],

  // Boot
  ['Init',                                                    'js/app.js'],
  ['Daily Midnight Reset',                                    'js/app.js'],
  ['Navigation',                                              'js/app.js'],
  ['Dashboard Panel Switching',                               'js/app.js'],
  ['App Version & Data Preservation',                         'js/app.js'],
  ['Version freshness check',                                 'js/app.js'],

  // Queue
  ['Queue History Browser',                                   'js/queue.js'],
  ['Queue (Front Desk)',                                      'js/queue.js'],
  ['Manual Add Modal',                                        'js/queue.js'],
  ['Edit Check-In',                                           'js/queue.js'],
  ['Queue Assign Modal',                                      'js/queue.js'],
  ['Edit Services Modal',                                     'js/queue.js'],
  ['Group Assign Modal',                                      'js/queue.js'],
  ['Split Modal',                                             'js/queue.js'],
  ['Merge Select Modal',                                      'js/queue.js'],

  // Check-in kiosk
  ['Guest Card Builder',                                      'js/checkin.js'],
  ['Check-In Submission',                                     'js/checkin.js'],

  // Catalog
  ['Services CRUD',                                           'js/catalog.js'],
  ['Dashboard service visibility',                            'js/catalog.js'],
  ['Items settings render',                                   'js/catalog.js'],
  ['Fees settings render',                                    'js/catalog.js'],

  // Staff
  ['Staff CRUD',                                              'js/staff.js'],
  ['Schedule Calendar',                                       'js/staff.js'],

  // Turns
  ['Per-Service Status Helpers',                              'js/turns.js'],
  ['Turns Tab',                                               'js/turns.js'],
  ['Turn Suggestion Engine',                                  'js/turns.js'],
  ['Tech Status Menu',                                        'js/turns.js'],
  ['Undo Stack',                                              'js/turns.js'],
  ['Updated setupTurnsDragDrop',                              'js/turns.js'],
  ['Drag & Drop',                                             'js/turns.js'],
  ['Turns',                                                   'js/turns.js'], // catch-all for remaining Turns sections

  // Reports
  ['Reports',                                                 'js/reports.js'],
  ['Shared record merge helper',                              'js/reports.js'],
  ['Report Range',                                            'js/reports.js'],
  ['Report Drill-Down',                                       'js/reports.js'],
  ['Transactions History',                                    'js/reports.js'],
  ['Sheets Report Export',                                    'js/reports.js'],
  ['Historical Transaction Entry',                            'js/reports.js'],

  // Google Calendar
  ['Google Calendar Integration',                             'js/calendar.js'],
  ['Calendar Hours Setting',                                  'js/calendar.js'],
  ['Silent calendar sync',                                    'js/calendar.js'],
  ['Cross-device token sharing via Sheets',                   'js/calendar.js'],
  ['New / Edit Appointment Modal',                            'js/calendar.js'],
  ['Appointment modal autocomplete',                          'js/calendar.js'],
  ['Appointment extra guests',                                'js/calendar.js'],
  ['Calendar column reorder',                                 'js/calendar.js'],

  // Square
  ['Square Customer Autocomplete',                            'js/square.js'],
  ['Customer Directory',                                      'js/square.js'],
  ['Square Appointments Sync',                                'js/square.js'],

  // Gift Cards
  ['Gift Cards',                                              'js/giftcards.js'],
  ['Gift Card Sort/Filter',                                   'js/giftcards.js'],

  // Photos
  ['Logo Upload & Crop',                                      'js/photos.js'],
  ['Photo Storage',                                           'js/photos.js'],
  ['Photo Crop',                                              'js/photos.js'],

  // Auth
  ['Logged-in User Display',                                  'js/auth.js'],
  ['PIN Modal',                                               'js/auth.js'],
  ['Front Desk Users CRUD',                                   'js/auth.js'],

  // Sync
  ['Google Sheets Export',                                    'js/sync.js'],
  ['Auto-update existing Sheets row',                         'js/sync.js'],
  ['Load historical records from Transaction Log in Sheets',  'js/sync.js'],
  ['Load gift cards from Gift Cards tab in Sheets',           'js/sync.js'],
  ['Multi-Device Config Sync',                                'js/sync.js'],
  ['Config Sync Core',                                        'js/sync.js'],
  ['allRecords cross-device sync',                            'js/sync.js'],
  ['allRecords event-driven push',                            'js/sync.js'],

  // Utils
  ['Clock',                                                   'js/utils.js'],
  ['Auto Capitalize',                                         'js/utils.js'],
  ['Deduplication helper',                                    'js/utils.js'],
  ['Local Date Helper',                                       'js/utils.js'],
  ['Elapsed Time Timer',                                      'js/utils.js'],
  ['Phone Formatting',                                        'js/utils.js'],
  ['Numeric Keypad',                                          'js/utils.js'],
  ['Toast',                                                   'js/utils.js'],

  // Settings
  ['Settings Panel',                                          'js/settings.js'],
  ['Staff & Service Visibility',                              'js/settings.js'],
  ['First-Time Setup Wizard',                                 'js/settings.js'],
  ['Settings embedded panels',                                'js/settings.js'],
  ['Audit Log',                                               'js/settings.js'],
];

function getTarget(name) {
  for (const [key, target] of ROUTES) {
    if (name.includes(key)) return target;
  }
  return null;
}

// ─── Split JS into sections ───────────────────────────────────────────────────
const sections = [];
let cur = { name: '__preamble__', target: null, lines: [] };

for (const line of jsLines) {
  if (isSectionMarker(line)) {
    if (cur.lines.length > 0) sections.push(cur);
    const name = extractSectionName(line);
    cur = { name, target: getTarget(name), lines: [line] };
  } else {
    cur.lines.push(line);
  }
}
if (cur.lines.length > 0) sections.push(cur);

// Report unmapped
const unmapped = sections.filter(s => !s.target && s.name !== '__preamble__');
if (unmapped.length > 0) {
  console.error('\n⚠  UNMAPPED SECTIONS:');
  unmapped.forEach(s => console.error(`   "${s.name}" (${s.lines.length} lines)`));
}

const preamble = sections.find(s => s.name === '__preamble__');
if (preamble && preamble.lines.some(l => l.trim())) {
  console.warn('\n⚠  Preamble has non-empty lines (before first section marker):');
  preamble.lines.forEach((l, i) => { if (l.trim()) console.warn(`   [${i}] ${l}`); });
}

// ─── Collect lines per file ───────────────────────────────────────────────────
const FILE_ORDER = [
  'js/utils.js',
  'js/config.js',
  'js/sync.js',
  'js/photos.js',
  'js/auth.js',
  'js/catalog.js',
  'js/square.js',
  'js/staff.js',
  'js/checkin.js',
  'js/queue.js',
  'js/turns.js',
  'js/reports.js',
  'js/giftcards.js',
  'js/calendar.js',
  'js/settings.js',
  'js/app.js',
];

const fileLines = {};
for (const s of sections) {
  if (!s.target) continue;
  if (!fileLines[s.target]) fileLines[s.target] = [];
  fileLines[s.target].push(...s.lines, '');
}

// ─── Write output files ───────────────────────────────────────────────────────
fs.mkdirSync('css', { recursive: true });
fs.mkdirSync('js',  { recursive: true });

// CSS
const cssContent = lines.slice(cssStart, cssEnd).join('\n');
fs.writeFileSync('css/styles.css', cssContent + '\n');
console.log(`✓  css/styles.css  (${cssEnd - cssStart} lines)`);

// JS
let totalLines = 0;
for (const file of FILE_ORDER) {
  const content = fileLines[file];
  if (content) {
    fs.writeFileSync(file, content.join('\n') + '\n');
    console.log(`✓  ${file.padEnd(22)} (${content.length} lines)`);
    totalLines += content.length;
  } else {
    console.warn(`⚠  ${file} — no sections routed here`);
  }
}

const jsTotal = jsLines.length;
const mappedLines = sections.filter(s => s.target).reduce((n, s) => n + s.lines.length, 0);
console.log(`\nJS total: ${jsTotal} lines — mapped: ${mappedLines} — delta: ${jsTotal - mappedLines}`);

// ─── Rewrite index.html ───────────────────────────────────────────────────────
const newLines = [...lines];

// Replace <style>…</style> with <link rel="stylesheet">
newLines[cssStart - 1] = '  <link rel="stylesheet" href="css/styles.css">';
for (let i = cssStart; i <= cssEnd; i++) newLines[i] = null;

// Replace <script>…</script> with ordered <script src> tags
const scriptTags = FILE_ORDER.map(f => `<script src="${f}"></script>`).join('\n');
newLines[jsStart - 1] = scriptTags;
for (let i = jsStart; i <= jsEnd; i++) newLines[i] = null;

const newHtml = newLines.filter(l => l !== null).join('\n');
fs.writeFileSync('index.html', newHtml);
console.log('\n✓  index.html updated');

// Summary
console.log('\nSection breakdown:');
const byFile = {};
for (const s of sections) {
  if (!s.target) continue;
  if (!byFile[s.target]) byFile[s.target] = [];
  byFile[s.target].push(s.name);
}
for (const f of FILE_ORDER) {
  if (byFile[f]) console.log(`  ${f}: ${byFile[f].join(', ')}`);
}
