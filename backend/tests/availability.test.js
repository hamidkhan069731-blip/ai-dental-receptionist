const { v4: uuid } = require('uuid');
const db = require('../src/db');
const { getAvailableSlots } = require('../src/utils/availability');

function makeDoctor({ duration = 30 } = {}) {
  const id = uuid();
  db.run(
    `INSERT INTO doctors (id, name, specialization, appointment_duration_minutes, active) VALUES (?, 'Dr Test', 'General Dentist', ?, 1)`,
    [id, duration]
  );
  return id;
}

function nextDateForDay(targetDow) {
  const d = new Date();
  d.setDate(d.getDate() + 1); // never "today" to avoid past-time edge cases
  while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('availability engine', () => {
  test('returns DOCTOR_NOT_FOUND for unknown doctor', () => {
    const result = getAvailableSlots('does-not-exist', '2099-01-01');
    expect(result.error).toBe('DOCTOR_NOT_FOUND');
    expect(result.slots).toEqual([]);
  });

  test('returns DOCTOR_NOT_WORKING when doctor has no schedule for that weekday', () => {
    const doctorId = makeDoctor();
    const sunday = nextDateForDay(0);
    // No schedule rows inserted for this doctor at all.
    const result = getAvailableSlots(doctorId, sunday);
    expect(result.error).toBe('DOCTOR_NOT_WORKING');
  });

  test('generates correctly sized, non-overlapping slots for a working window', () => {
    const doctorId = makeDoctor({ duration: 30 });
    const monday = nextDateForDay(1);
    db.run(
      `INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, 1, '10:00', '12:00')`,
      [uuid(), doctorId]
    );
    const { error, slots } = getAvailableSlots(doctorId, monday);
    expect(error).toBeNull();
    // 10:00-12:00 at 30 min => 4 slots
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ start_time: '10:00', end_time: '10:30' });
    expect(slots[3]).toEqual({ start_time: '11:30', end_time: '12:00' });
  });

  test('excludes a slot that overlaps an existing confirmed appointment', () => {
    const doctorId = makeDoctor({ duration: 30 });
    const tuesday = nextDateForDay(2);
    db.run(`INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, 2, '10:00', '11:00')`, [uuid(), doctorId]);

    const patientId = uuid();
    db.run(`INSERT INTO patients (id, name, phone) VALUES (?, 'Existing Patient', '+920001112222')`, [patientId]);
    db.run(
      `INSERT INTO appointments (id, booking_code, patient_id, doctor_id, appointment_date, start_time, end_time, status)
       VALUES (?, 'APT-T001', ?, ?, ?, '10:00', '10:30', 'confirmed')`,
      [uuid(), patientId, doctorId, tuesday]
    );

    const { slots } = getAvailableSlots(doctorId, tuesday);
    expect(slots).toHaveLength(1);
    expect(slots[0].start_time).toBe('10:30');
  });

  test('respects a doctor holiday', () => {
    const doctorId = makeDoctor();
    const wednesday = nextDateForDay(3);
    db.run(`INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, 3, '10:00', '12:00')`, [uuid(), doctorId]);
    db.run(`INSERT INTO doctor_holidays (id, doctor_id, holiday_date, reason) VALUES (?, ?, ?, 'On leave')`, [uuid(), doctorId, wednesday]);

    const result = getAvailableSlots(doctorId, wednesday);
    expect(result.error).toBe('DOCTOR_ON_HOLIDAY');
  });

  test('rejects a date in the past', () => {
    const doctorId = makeDoctor();
    const result = getAvailableSlots(doctorId, '2020-01-01');
    expect(result.error).toBe('DATE_IN_PAST');
  });

  test('rejects a malformed date', () => {
    const doctorId = makeDoctor();
    const result = getAvailableSlots(doctorId, 'not-a-date');
    expect(result.error).toBe('INVALID_DATE');
  });
});
