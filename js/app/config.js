// ── Static constants (not synced state) ─────────────────────────────────────
export const APP_VERSION = 'v2.26';
export const APP_NAME    = 'musedashboard';
export const STAFF_PIN   = '1234'; // fallback when no front desk users are configured
export const LOGO_PATH   = '';     // no default logo — upload one in Settings

const ORIGIN = 'https://musedashboard.musenailandspa.workers.dev';
export const SQUARE_PROXY = ORIGIN + '/square';
export const PHOTOS_PROXY = ORIGIN + '/photos';
export const STATE_PROXY  = ORIGIN + '/state';

// Seeded into config.role_permissions on first run; also the fallback in canDo().
export const DEFAULT_ROLE_PERMISSIONS = {
  manager:   { historicalEntry: true,  deleteTransaction: true,  refund: true,  viewReports: true, manageStaff: true,  manageServices: true  },
  frontdesk: { historicalEntry: false, deleteTransaction: false, refund: false, viewReports: true, manageStaff: false, manageServices: false },
};

export const GROUP_COLORS = [
  '#1a5252','#785a1a','#5c3d8f','#1a5c7a','#7a2a1a',
  '#2a7a4f','#7a1a5c','#4f4f1a','#1a3a7a','#7a4f1a',
];

export const SCHEDULE_COLORS = {
  working:  { bg: '#1a5252', text: '#ffffff', label: 'Working'  },
  off:      { bg: '#f5c870', text: '#3a2800', label: 'Off'      },
  sick:     { bg: '#fa746f', text: '#ffffff', label: 'Sick'     },
  vacation: { bg: '#adb3b5', text: '#000000', label: 'Vacation' },
};
