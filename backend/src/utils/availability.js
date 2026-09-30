const db = require('../db');

/** Convert 'HH:MM' to minutes since midnight. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Convert minutes since midnight back to 'HH:MM'. */
function toHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function dayOfWeek(dateStr) {
  // dateStr: 'YYYY-MM-DD' -> 0=Sunday..6=Saturday, parsed as UTC-neutral local date
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function isPastDate(dateStr) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  return dateStr < todayStr;
}

/**
 * Generate all bookable slots for a doctor on a given date, excluding
 * slots that overlap an existing non-cancelled appointment.
 */
function getAvailableSlots(doctorId, dateStr) {
  const doctor = db.get('SELECT * FROM doctors WHERE id = ? AND active = 1', [doctorId]);
  if (!doctor) {
    return { error: 'DOCTOR_NOT_FOUND', slots: [] };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { error: 'INVALID_DATE', slots: [] };
  }

  if (isPastDate(dateStr)) {
    return { error: 'DATE_IN_PAST', slots: [] };
  }

  const holiday = db.get(
    'SELECT * FROM doctor_holidays WHERE doctor_id = ? AND holiday_date = ?',
    [doctorId, dateStr]
  );
  if (holiday) {
    return { error: 'DOCTOR_ON_HOLIDAY', reason: holiday.reason, slots: [] };
  }

  const dow = dayOfWeek(dateStr);
  const windows = db.all(
    'SELECT * FROM doctor_schedules WHERE doctor_id = ? AND day_of_week = ?',
    [doctorId, dow]
  );

  if (windows.length === 0) {
    return { error: 'DOCTOR_NOT_WORKING', slots: [] };
  }

  const duration = doctor.appointment_duration_minutes;

  const existing = db.all(
    `SELECT start_time, end_time FROM appointments
     WHERE doctor_id = ? AND appointment_date = ? AND status IN ('pending','confirmed')`,
    [doctorId, dateStr]
  );
  const busy = existing.map((a) => [toMinutes(a.start_time), toMinutes(a.end_time)]);

  const now = new Date();
  const isToday = dateStr === now.toISOString().slice(0, 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (const win of windows) {
    let cursor = toMinutes(win.start_time);
    const end = toMinutes(win.end_time);
    while (cursor + duration <= end) {
      const slotEnd = cursor + duration;
      const overlaps = busy.some(([bs, be]) => cursor < be && slotEnd > bs);
      const inPast = isToday && cursor <= nowMinutes;
      if (!overlaps && !inPast) {
        slots.push({ start_time: toHHMM(cursor), end_time: toHHMM(slotEnd) });
      }
      cursor += duration;
    }
  }

  return { error: null, slots };
}

/**
 * Verify a specific slot is still free right before booking (guards
 * against races between "check availability" and "book").
 */
function isSlotStillAvailable(doctorId, dateStr, startTime) {
  const { error, slots } = getAvailableSlots(doctorId, dateStr);
  if (error) return { ok: false, error };
  const found = slots.find((s) => s.start_time === startTime);
  return found ? { ok: true, slot: found } : { ok: false, error: 'SLOT_TAKEN' };
}

module.exports = { getAvailableSlots, isSlotStillAvailable, toMinutes, toHHMM, dayOfWeek };
