const { v4: uuid } = require('uuid');
const db = require('../src/db');
const appointmentService = require('../src/services/appointmentService');
const { ValidationError } = require('../src/utils/validation');

function makeDoctor() {
  const id = uuid();
  db.run(`INSERT INTO doctors (id, name, specialization, appointment_duration_minutes, active) VALUES (?, 'Dr Booking', 'General Dentist', 30, 1)`, [id]);
  return id;
}

function makePatient(phone) {
  const id = uuid();
  db.run(`INSERT INTO patients (id, name, phone) VALUES (?, 'Booking Patient', ?)`, [id, phone]);
  return id;
}

function nextDateForDay(targetDow) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== targetDow) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('appointment booking lifecycle', () => {
  let doctorId, patientId, date;

  beforeEach(() => {
    doctorId = makeDoctor();
    patientId = makePatient('+92300' + Math.floor(Math.random() * 10000000));
    date = nextDateForDay(4); // Thursday
    db.run(`INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, 4, '10:00', '12:00')`, [uuid(), doctorId]);
  });

  test('books a valid slot successfully', () => {
    const appt = appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '10:00', reason: 'Checkup' });
    expect(appt.status).toBe('confirmed');
    expect(appt.start_time).toBe('10:00');
    expect(appt.booking_code).toMatch(/^APT-\d{6}$/);
  });

  test('prevents double-booking the same doctor/date/time', () => {
    appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '10:00' });
    const otherPatient = makePatient('+92301' + Math.floor(Math.random() * 10000000));
    expect(() =>
      appointmentService.bookAppointment({ patient_id: otherPatient, doctor_id: doctorId, date, time: '10:00' })
    ).toThrow(ValidationError);
  });

  test('rejects booking a slot outside the doctor working hours', () => {
    expect(() =>
      appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '20:00' })
    ).toThrow(ValidationError);
  });

  test('rejects booking with an invalid doctor', () => {
    expect(() =>
      appointmentService.bookAppointment({ patient_id: patientId, doctor_id: 'nope', date, time: '10:00' })
    ).toThrow(ValidationError);
  });

  test('cancels an appointment and frees the slot', () => {
    const appt = appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '10:30' });
    const cancelled = appointmentService.cancelAppointment(appt.id);
    expect(cancelled.status).toBe('cancelled');

    // Slot should now be bookable again by someone else.
    const otherPatient = makePatient('+92302' + Math.floor(Math.random() * 10000000));
    const rebook = appointmentService.bookAppointment({ patient_id: otherPatient, doctor_id: doctorId, date, time: '10:30' });
    expect(rebook.status).toBe('confirmed');
  });

  test('reschedules to a free slot', () => {
    const appt = appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '11:00' });
    const moved = appointmentService.rescheduleAppointment(appt.id, date, '11:30');
    expect(moved.start_time).toBe('11:30');
    expect(moved.status).toBe('confirmed');
  });

  test('reschedule fails and rolls back if new slot is taken, keeping the original booking intact', () => {
    const apptA = appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '10:00' });
    const otherPatient = makePatient('+92303' + Math.floor(Math.random() * 10000000));
    appointmentService.bookAppointment({ patient_id: otherPatient, doctor_id: doctorId, date, time: '11:00' });

    expect(() => appointmentService.rescheduleAppointment(apptA.id, date, '11:00')).toThrow(ValidationError);

    // Original appointment should remain exactly as it was (rolled back).
    const stillThere = appointmentService.getAppointment(apptA.id);
    expect(stillThere.status).toBe('confirmed');
    expect(stillThere.start_time).toBe('10:00');
  });

  test('cannot reschedule a cancelled appointment', () => {
    const appt = appointmentService.bookAppointment({ patient_id: patientId, doctor_id: doctorId, date, time: '10:00' });
    appointmentService.cancelAppointment(appt.id);
    expect(() => appointmentService.rescheduleAppointment(appt.id, date, '10:30')).toThrow(ValidationError);
  });
});
