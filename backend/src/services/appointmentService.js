const { v4: uuid } = require('uuid');
const db = require('../db');
const { getDoctor } = require('./doctorService');
const { toMinutes } = require('../utils/availability');
const { isValidDate, isValidTime, ValidationError } = require('../utils/validation');

function generateBookingCode() {
  const n = db.get('SELECT COUNT(*) AS c FROM appointments').c + 1;
  return `APT-${String(n).padStart(6, '0')}`;
}

/**
 * better-sqlite3 executes synchronously, so wrapping the whole
 * check-then-insert sequence in a single db.raw.transaction() makes
 * it atomic with respect to any other call in this process — the
 * classic "verify slot -> lock -> insert" step from the spec. In a
 * multi-process Postgres deployment, replace this transaction with a
 * `SELECT ... FOR UPDATE` on the doctor/date row (or a unique
 * constraint on (doctor_id, appointment_date, start_time) for
 * non-cancelled rows) to get the same guarantee across processes.
 */
function bookAppointment({ patient_id, doctor_id, service_id, date, time, reason }) {
  if (!patient_id) throw new ValidationError('patient_id is required.', 'patient_id');
  const doctor = getDoctor(doctor_id);
  if (!doctor || !doctor.active) throw new ValidationError('Doctor not found or inactive.', 'doctor_id');
  if (!isValidDate(date)) throw new ValidationError('A valid date (YYYY-MM-DD) is required.', 'date');
  if (!isValidTime(time)) throw new ValidationError('A valid time (HH:MM) is required.', 'time');

  const patient = db.get('SELECT * FROM patients WHERE id = ?', [patient_id]);
  if (!patient) throw new ValidationError('Patient not found.', 'patient_id');

  if (service_id) {
    const svc = db.get('SELECT * FROM services WHERE id = ? AND active = 1', [service_id]);
    if (!svc) throw new ValidationError('Service not found or inactive.', 'service_id');
  }

  const run = db.raw.transaction(() => {
    // Re-verify inside the transaction (guards the race the spec calls out).
    const { getAvailableSlots } = require('../utils/availability');
    const { error, slots } = getAvailableSlots(doctor_id, date);
    if (error) {
      const err = new ValidationError(describeAvailabilityError(error), 'date');
      err.code = error;
      throw err;
    }
    const slotOk = slots.find((s) => s.start_time === time);
    if (!slotOk) {
      const err = new ValidationError('Sorry, that slot was just taken. Please choose another available time.', 'time');
      err.code = 'SLOT_TAKEN';
      throw err;
    }

    const id = uuid();
    const bookingCode = generateBookingCode();
    db.run(
      `INSERT INTO appointments (id, booking_code, patient_id, doctor_id, service_id, appointment_date, start_time, end_time, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [id, bookingCode, patient_id, doctor_id, service_id || null, date, slotOk.start_time, slotOk.end_time, reason || null]
    );
    db.run(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details) VALUES (?, 'ai', 'book_appointment', 'appointment', ?, ?)`,
      [uuid(), id, JSON.stringify({ doctor_id, date, time })]
    );
    return getAppointment(id);
  });

  return run();
}

function describeAvailabilityError(code) {
  const map = {
    DOCTOR_NOT_FOUND: 'Doctor not found.',
    INVALID_DATE: 'The date provided is not valid.',
    DATE_IN_PAST: 'That date is in the past.',
    DOCTOR_ON_HOLIDAY: 'The doctor is unavailable on that date.',
    DOCTOR_NOT_WORKING: 'The doctor does not work on that day.',
  };
  return map[code] || 'That slot is unavailable.';
}

function getAppointment(id) {
  return db.get(
    `SELECT a.*, d.name AS doctor_name, s.name AS service_name, p.name AS patient_name, p.phone AS patient_phone
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     LEFT JOIN services s ON s.id = a.service_id
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = ?`,
    [id]
  );
}

function getAppointmentByCode(bookingCode) {
  return db.get(
    `SELECT a.*, d.name AS doctor_name, s.name AS service_name, p.name AS patient_name, p.phone AS patient_phone
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     LEFT JOIN services s ON s.id = a.service_id
     JOIN patients p ON p.id = a.patient_id
     WHERE a.booking_code = ?`,
    [bookingCode]
  );
}

function cancelAppointment(appointmentId) {
  const appt = getAppointment(appointmentId);
  if (!appt) throw new ValidationError('Appointment not found.', 'appointment_id');
  if (appt.status === 'cancelled') return appt;
  db.run(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [appointmentId]);
  db.run(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id) VALUES (?, 'ai', 'cancel_appointment', 'appointment', ?)`,
    [uuid(), appointmentId]
  );
  return getAppointment(appointmentId);
}

function rescheduleAppointment(appointmentId, newDate, newTime) {
  const appt = getAppointment(appointmentId);
  if (!appt) throw new ValidationError('Appointment not found.', 'appointment_id');
  if (appt.status === 'cancelled') throw new ValidationError('Cannot reschedule a cancelled appointment.', 'appointment_id');
  if (!isValidDate(newDate)) throw new ValidationError('A valid new date is required.', 'new_date');
  if (!isValidTime(newTime)) throw new ValidationError('A valid new time is required.', 'new_time');

  const run = db.raw.transaction(() => {
    const { getAvailableSlots } = require('../utils/availability');
    // Temporarily free the old slot by excluding this appointment from the busy check:
    // simplest safe approach is to cancel-then-check-then-rebook within the same transaction.
    const previous = { date: appt.appointment_date, start: appt.start_time, end: appt.end_time };
    db.run(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [appointmentId]);

    const { error, slots } = getAvailableSlots(appt.doctor_id, newDate);
    const slotOk = !error && slots.find((s) => s.start_time === newTime);

    if (!slotOk) {
      // Roll back: restore the original appointment exactly as it was.
      db.run(
        `UPDATE appointments SET status = 'confirmed', appointment_date = ?, start_time = ?, end_time = ?, updated_at = datetime('now') WHERE id = ?`,
        [previous.date, previous.start, previous.end, appointmentId]
      );
      const err = new ValidationError('Sorry, that new slot is not available. Please choose another time.', 'new_time');
      err.code = error || 'SLOT_TAKEN';
      throw err;
    }

    db.run(
      `UPDATE appointments SET status = 'confirmed', appointment_date = ?, start_time = ?, end_time = ?, updated_at = datetime('now') WHERE id = ?`,
      [newDate, slotOk.start_time, slotOk.end_time, appointmentId]
    );
    db.run(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details) VALUES (?, 'ai', 'reschedule_appointment', 'appointment', ?, ?)`,
      [uuid(), appointmentId, JSON.stringify({ newDate, newTime })]
    );
    return getAppointment(appointmentId);
  });

  return run();
}

function listAppointments({ date, doctorId, status } = {}) {
  let sql = `SELECT a.*, d.name AS doctor_name, s.name AS service_name, p.name AS patient_name, p.phone AS patient_phone
             FROM appointments a
             JOIN doctors d ON d.id = a.doctor_id
             LEFT JOIN services s ON s.id = a.service_id
             JOIN patients p ON p.id = a.patient_id WHERE 1=1`;
  const params = [];
  if (date) { sql += ' AND a.appointment_date = ?'; params.push(date); }
  if (doctorId) { sql += ' AND a.doctor_id = ?'; params.push(doctorId); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  sql += ' ORDER BY a.appointment_date DESC, a.start_time DESC';
  return db.all(sql, params);
}

module.exports = {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAppointment,
  getAppointmentByCode,
  listAppointments,
};
