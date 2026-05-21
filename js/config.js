// ── Config ──────────────────────────────────────
const STAFF_PIN = "1234"; // fallback if no front desk users configured
const LOGO_PATH = ""; // No default logo — upload one in Settings → Business Logo
const APP_VERSION  = 'v1.54';
const APP_NAME     = 'musedashboard';
const SQUARE_PROXY = "https://musedashboard.musenailandspa.workers.dev/square";


// ── State ────────────────────────────────────────
let queue = [];

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

// Services — editable, persisted to localStorage and synced from Sheets on load
let SERVICES = dedupByLabel(JSON.parse(localStorage.getItem('muse_services') || 'null') || []);

// Staff — editable, persisted to localStorage and synced from Sheets on load
let STAFF = JSON.parse(localStorage.getItem('muse_staff') || 'null') || [];

// Front desk users — each has a name, role, and PIN
let FRONT_DESK_USERS = JSON.parse(localStorage.getItem('muse_fd_users') || 'null') || [
  { id: "admin", name: "Manager", pin: "1234", role: "admin" },
];
let activeUser = null; // currently logged-in front desk user

function saveFrontDeskUsers() {
  localStorage.setItem('muse_fd_users', JSON.stringify(FRONT_DESK_USERS));
  _configWriteTime = Date.now(); // lock immediately so poll doesn't overwrite
  setTimeout(() => pushConfigToSheets(), 1000);
}
function saveFdUsersToStorage() { saveFrontDeskUsers(); }
function saveServicesToStorage() {
  localStorage.setItem('muse_services', JSON.stringify(SERVICES));
  _configWriteTime = Date.now(); // lock immediately so poll doesn't overwrite
  setTimeout(() => pushConfigToSheets(), 1000);
}
function saveStaffToStorage() {
  localStorage.setItem('muse_staff', JSON.stringify(STAFF));
  _configWriteTime = Date.now();
  setTimeout(() => pushConfigToSheets(), 1000);
}


