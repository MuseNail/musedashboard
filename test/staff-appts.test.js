import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMyAppts } from '../js/app/features/staff-appts.js';

// The tech app's "My appointments", app-native (replaces the old Google-Calendar read): one row
// per booking the tech has a service line in, over the today→+7-day window, showing only THAT
// tech's services and the booking's primary name.
const services = [{ id: 'mani', label: 'Manicure' }, { id: 'pedi', label: 'Pedicure' }, { id: 'gel', label: 'Gel' }];
const noon = new Date('2026-09-10T12:00:00').getTime();   // "today"
const at = (dayOffset, h) => { const d = new Date('2026-09-10T00:00:00'); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const appt = (o) => ({ id: o.id, start: o.start, end: o.end, notes: o.notes || '', confirmed: !!o.confirmed, noShow: !!o.noShow, guests: o.guests });

test('deriveMyAppts: only THIS tech, this tech\'s services, within the window; sorted', () => {
  const appts = [
    appt({ id: 'A', start: at(0, 14), guests: [{ name: 'Alice', lines: [{ serviceId: 'mani', staffId: 's1' }] }] }),                                   // today, s1 → yes
    appt({ id: 'B', start: at(0, 15), guests: [{ name: 'Bob', lines: [{ serviceId: 'pedi', staffId: 's2' }] }] }),                                      // today, s2 only → no
    appt({ id: 'C', start: at(3, 10), guests: [{ name: 'Cara', lines: [{ serviceId: 'mani', staffId: 's1' }] }, { name: 'Dan', lines: [{ serviceId: 'gel', staffId: 's2' }] }] }), // 3d, s1 primary + a guest → yes, guests=1, only Manicure
    appt({ id: 'D', start: at(10, 10), guests: [{ name: 'Far', lines: [{ serviceId: 'mani', staffId: 's1' }] }] }),                                     // 10d out of window → no
    appt({ id: 'E', start: at(-1, 10), guests: [{ name: 'Yest', lines: [{ serviceId: 'mani', staffId: 's1' }] }] }),                                    // yesterday → no
    appt({ id: 'F', start: at(1, 11), guests: [{ name: 'Fay', lines: [{ serviceId: 'mani', staffId: 's1' }, { serviceId: 'gel', staffId: 's2' }] }] }), // +1d, one guest with an s1 line and an s2 line → yes, only Manicure
  ];
  const rows = deriveMyAppts(appts, 's1', services, noon, 7);
  assert.deepEqual(rows.map(r => r.name), ['Alice', 'Fay', 'Cara']);   // startMs order: today 2pm, +1d, +3d
  const cara = rows.find(r => r.name === 'Cara');
  assert.equal(cara.guests, 1);
  assert.deepEqual(cara.services, ['Manicure']);
  const fay = rows.find(r => r.name === 'Fay');
  assert.deepEqual(fay.services, ['Manicure']);   // the s2 gel line on the same guest is excluded
});

test('deriveMyAppts: noShow rows included (render filters them); end defaults to +1h', () => {
  const rows = deriveMyAppts([appt({ id: 'N', start: at(0, 13), noShow: true, guests: [{ name: 'No', lines: [{ serviceId: 'mani', staffId: 's1' }] }] })], 's1', services, noon, 7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].noShow, true);
  assert.equal(rows[0].endMs - rows[0].startMs, 3600000);
});

test('deriveMyAppts: blank staffId → empty', () => {
  assert.deepEqual(deriveMyAppts([appt({ id: 'A', start: at(0, 14), guests: [{ name: 'A', lines: [{ serviceId: 'mani', staffId: 's1' }] }] })], '', services, noon, 7), []);
});
