// ── Config ──────────────────────────────────────
const STAFF_PIN = "1234"; // fallback if no front desk users configured
const LOGO_PATH = ""; // No default logo — upload one in Settings → Business Logo
const APP_VERSION  = 'v1.55';
const APP_NAME     = 'musedashboard';
const SQUARE_PROXY = "https://musedashboard.musenailandspa.workers.dev/square";


// ── Global State ─────────────────────────────────
let squareCustomers = [];
// Pre-populate squareCustomers from the customerDirectory cache so autocomplete
// works immediately on load (including on customer-facing tablets without Square configured)
(function() {
  try {
    const cached = localStorage.getItem('muse_customers');
    if (cached) {
      const dir = JSON.parse(cached);
      squareCustomers = dir.map(c => ({
        id:          c.squareId,
        given_name:  c.firstName  || '',
        family_name: c.lastName   || '',
        phone:       c.phone      || '',
        display:     [c.firstName, c.lastName].filter(Boolean).join(' '),
      })).filter(c => c.given_name);
    }
  } catch(e) {}
})();
let guestCount = 0;
let currentFilter = 'all';
let pinBuffer = "";
let squareConfig = JSON.parse(localStorage.getItem('muse_sq_config') || 'null');

// Services — in-memory; loaded from Sheets on startup via loadConfigFromSheets()
let SERVICES = [];

// Staff — in-memory; loaded from Sheets on startup via loadConfigFromSheets()
let STAFF = [];

// Front desk users — default admin kept as fallback when Sheets has no data yet
let FRONT_DESK_USERS = [
  { id: "admin", name: "Manager", pin: "1234", role: "admin" },
];

function saveFrontDeskUsers() {
  _configWriteTime = Date.now(); // lock immediately so poll doesn't overwrite
  setTimeout(() => pushConfigToSheets(), 1000);
}
function saveFdUsersToStorage() { saveFrontDeskUsers(); }
function saveServicesToStorage() {
  _configWriteTime = Date.now(); // lock immediately so poll doesn't overwrite
  setTimeout(() => pushConfigToSheets(), 1000);
}
function saveStaffToStorage() {
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}


