const { v4: uuid } = require('uuid');
const db = require('../db');
const { isValidPhone, isValidEmail, normalizePhone, ValidationError } = require('../utils/validation');

function createOrGetPatient({ name, phone, email, preferred_language }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new ValidationError('A valid patient name is required.', 'name');
  }
  if (!isValidPhone(phone)) {
    throw new ValidationError('A valid phone number is required.', 'phone');
  }
  if (email && !isValidEmail(email)) {
    throw new ValidationError('The email address is not valid.', 'email');
  }

  const cleanPhone = normalizePhone(phone);
  const existing = db.get('SELECT * FROM patients WHERE phone = ?', [cleanPhone]);
  if (existing) {
    // Keep patient record fresh with any newly provided details.
    db.run(
      `UPDATE patients SET name = ?, email = COALESCE(?, email), preferred_language = COALESCE(?, preferred_language), updated_at = datetime('now') WHERE id = ?`,
      [name.trim(), email || null, preferred_language || null, existing.id]
    );
    return db.get('SELECT * FROM patients WHERE id = ?', [existing.id]);
  }

  const id = uuid();
  db.run(
    `INSERT INTO patients (id, name, phone, email, preferred_language) VALUES (?, ?, ?, ?, ?)`,
    [id, name.trim(), cleanPhone, email || null, preferred_language || 'en']
  );
  return db.get('SELECT * FROM patients WHERE id = ?', [id]);
}

function getPatientByPhone(phone) {
  if (!isValidPhone(phone)) throw new ValidationError('A valid phone number is required.', 'phone');
  return db.get('SELECT * FROM patients WHERE phone = ?', [normalizePhone(phone)]);
}

function getPatientAppointments(phone) {
  const patient = getPatientByPhone(phone);
  if (!patient) return [];
  return db.all(
    `SELECT a.*, d.name AS doctor_name, s.name AS service_name
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     LEFT JOIN services s ON s.id = a.service_id
     WHERE a.patient_id = ?
     ORDER BY a.appointment_date DESC, a.start_time DESC`,
    [patient.id]
  );
}

module.exports = { createOrGetPatient, getPatientByPhone, getPatientAppointments };
