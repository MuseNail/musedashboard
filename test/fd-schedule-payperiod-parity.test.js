// The FD-schedule util carries its own payPeriodForDate (so it stays node-pure); payroll uses
// reports.js payPeriodDates. They MUST agree or the schedule's pay-period chip would contradict
// payroll. This asserts the two independent copies return identical {from,to} for the same
// config + date across every type — so a future edit to one can't silently drift from the other.
import './setup-globals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { payPeriodForDate } from '../js/app/fd-schedule-util.js';
import { payPeriodDates } from '../js/app/features/reports.js';
import { getState } from '../js/app/store.js';

const DATES = ['2026-01-05', '2026-02-18', '2026-06-30', '2026-11-16', '2026-12-31', '2027-03-01'];
const CFGS = [
  { type: 'weekly' },
  { type: 'weekly', startDate: '2026-11-16' },
  { type: 'biweekly' },
  { type: 'biweekly', startDate: '2026-01-04' },
  { type: 'bimonthly' },
  {}, // default (→ weekly)
];

for (const ppCfg of CFGS) {
  for (const ds of DATES) {
    test(`payPeriodForDate == reports.payPeriodDates for ${JSON.stringify(ppCfg)} @ ${ds}`, () => {
      const now = new Date(ds + 'T12:00:00');
      getState().config.pay_period = ppCfg;            // payPeriodDates reads cfg().pay_period
      const a = payPeriodForDate(ppCfg, now);          // the util copy takes cfg as an arg
      const b = payPeriodDates(now);                   // the payroll source
      assert.equal(+a.from, +b.from, 'from matches');
      assert.equal(+a.to, +b.to, 'to matches');
    });
  }
}
