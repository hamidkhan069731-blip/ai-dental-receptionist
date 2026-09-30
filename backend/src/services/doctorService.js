const { v4: uuid } = require('uuid');
const db = require('../db');
const { getAvailableSlots } = require('../utils/availability');
const { ValidationError } = require('../utils/validation');

function listDoctors({ activeOnly = true } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM doctors WHERE active = 1 ORDER BY name'
    : 'SELECT * FROM doctors ORDER BY name';
  return db.all(sql);
}

function getDoctor(doctorId) {
  return db.get('SELECT * FROM doctors WHERE id = ?', [doctorId]);
}

function getDoctorSchedule(doctorId) {
  const doctor = getDoctor(doctorId);
  if (!doctor) throw new ValidationError('Doctor not found.', 'doctor_id');
  const windows = db.all(
    'SELECT day_of_week, start_time, end_time FROM doctor_schedules WHERE doctor_id = ? ORDER BY day_of_week, start_time',
    [doctorId]
  );
  const holidays = db.all(
    'SELECT holiday_date, reason FROM doctor_holidays WHERE doctor_id = ? ORDER BY holiday_date',
    [doctorId]
  );
  return { doctor, windows, holidays };
}

/** Which doctors have at least one open slot on the given date. */
function getAvailableDoctors(dateStr) {
  const doctors = listDoctors();
  return doctors
    .map((doc) => {
      const { slots, error } = getAvailableSlots(doc.id, dateStr);
      return { doctor: doc, slotCount: error ? 0 : slots.length, error };
    })
    .filter((d) => d.slotCount > 0)
    .map((d) => d.doctor);
}

function createDoctor({ name, specialization, bio, appointment_duration_minutes }) {
  if (!name || !specialization) {
    throw new ValidationError('Doctor name and specialization are required.');
  }
  const id = uuid();
  db.run(
    `INSERT INTO doctors (id, name, specialization, bio, appointment_duration_minutes, active) VALUES (?, ?, ?, ?, ?, 1)`,
    [id, name, specialization, bio || null, appointment_duration_minutes || 30]
  );
  return getDoctor(id);
}

function updateDoctor(doctorId, fields) {
  const doctor = getDoctor(doctorId);
  if (!doctor) throw new ValidationError('Doctor not found.', 'doctor_id');
  const merged = { ...doctor, ...fields };
  db.run(
    `UPDATE doctors SET name = ?, specialization = ?, bio = ?, appointment_duration_minutes = ?, active = ?, updated_at = datetime('now') WHERE id = ?`,
    [merged.name, merged.specialization, merged.bio, merged.appointment_duration_minutes, merged.active ? 1 : 0, doctorId]
  );
  return getDoctor(doctorId);
}

function deactivateDoctor(doctorId) {
  db.run(`UPDATE doctors SET active = 0, updated_at = datetime('now') WHERE id = ?`, [doctorId]);
  return getDoctor(doctorId);
}

function setSchedule(doctorId, windows) {
  const doctor = getDoctor(doctorId);
  if (!doctor) throw new ValidationError('Doctor not found.', 'doctor_id');
  const tx = db.raw.transaction(() => {
    db.run('DELETE FROM doctor_schedules WHERE doctor_id = ?', [doctorId]);
    for (const w of windows) {
      db.run(
        'INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
        [uuid(), doctorId, w.day_of_week, w.start_time, w.end_time]
      );
    }
  });
  tx();
  return getDoctorSchedule(doctorId);
}

function addHoliday(doctorId, holidayDate, reason) {
  const id = uuid();
  db.run('INSERT INTO doctor_holidays (id, doctor_id, holiday_date, reason) VALUES (?, ?, ?, ?)', [
    id, doctorId, holidayDate, reason || null,
  ]);
  return getDoctorSchedule(doctorId);
}

module.exports = {
  listDoctors,
  getDoctor,
  getDoctorSchedule,
  getAvailableDoctors,
  createDoctor,
  updateDoctor,
  deactivateDoctor,
  setSchedule,
  addHoliday,
};
