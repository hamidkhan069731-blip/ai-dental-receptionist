const express = require('express');
const router = express.Router();
const { login, requireAuth, requireRole } = require('../middleware/auth');
const doctorService = require('../services/doctorService');
const clinicService = require('../services/clinicService');
const appointmentService = require('../services/appointmentService');
const db = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/validation');

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ValidationError('Email and password are required.');
  const result = login(email, password);
  if (!result) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json(result);
}));

router.use(requireAuth);

// ---- Dashboard summary ----
router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todays = appointmentService.listAppointments({ date: today });
  const upcoming = db.get(
    `SELECT COUNT(*) AS c FROM appointments WHERE appointment_date > ? AND status IN ('pending','confirmed')`,
    [today]
  ).c;
  const cancelled = db.get(`SELECT COUNT(*) AS c FROM appointments WHERE status = 'cancelled'`).c;
  const newPatients = db.get(`SELECT COUNT(*) AS c FROM patients WHERE date(created_at) = date('now')`).c;
  const aiConversations = db.get(`SELECT COUNT(*) AS c FROM conversation_sessions`).c;
  const aiBookings = db.get(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'book_appointment'`).c;
  const handoffs = db.get(`SELECT COUNT(*) AS c FROM conversation_sessions WHERE status = 'handoff'`).c;

  res.json({
    todays_appointments: todays,
    upcoming_count: upcoming,
    cancelled_count: cancelled,
    new_patients_today: newPatients,
    ai_conversations: aiConversations,
    ai_bookings: aiBookings,
    human_handoffs: handoffs,
  });
}));

// ---- Doctors management ----
router.get('/doctors', asyncHandler(async (req, res) => res.json(doctorService.listDoctors({ activeOnly: false }))));
router.post('/doctors', requireRole('admin'), asyncHandler(async (req, res) => res.status(201).json(doctorService.createDoctor(req.body))));
router.patch('/doctors/:id', requireRole('admin'), asyncHandler(async (req, res) => res.json(doctorService.updateDoctor(req.params.id, req.body))));
router.delete('/doctors/:id', requireRole('admin'), asyncHandler(async (req, res) => res.json(doctorService.deactivateDoctor(req.params.id))));
router.put('/doctors/:id/schedule', requireRole('admin'), asyncHandler(async (req, res) => res.json(doctorService.setSchedule(req.params.id, req.body.windows || []))));
router.post('/doctors/:id/holidays', requireRole('admin'), asyncHandler(async (req, res) => res.json(doctorService.addHoliday(req.params.id, req.body.date, req.body.reason))));

// ---- Services management ----
router.get('/services', asyncHandler(async (req, res) => res.json(clinicService.listServices({ activeOnly: false }))));
router.post('/services', requireRole('admin'), asyncHandler(async (req, res) => res.status(201).json(clinicService.createService(req.body))));
router.patch('/services/:id', requireRole('admin'), asyncHandler(async (req, res) => res.json(clinicService.updateService(req.params.id, req.body))));

// ---- FAQs ----
router.get('/faqs', asyncHandler(async (req, res) => res.json(clinicService.listFaqs())));
router.post('/faqs', requireRole('admin'), asyncHandler(async (req, res) => res.status(201).json(clinicService.createFaq(req.body.question, req.body.answer))));

// ---- Clinic settings ----
router.get('/settings', asyncHandler(async (req, res) => res.json(clinicService.getClinicInfo())));
router.put('/settings/:key', requireRole('admin'), asyncHandler(async (req, res) => res.json(clinicService.updateClinicSetting(req.params.key, req.body.value))));

// ---- Appointments (admin view) ----
router.get('/appointments', asyncHandler(async (req, res) => {
  const { date, doctor_id, status } = req.query;
  res.json(appointmentService.listAppointments({ date, doctorId: doctor_id, status }));
}));

// ---- Conversation logs ----
router.get('/conversations', asyncHandler(async (req, res) => {
  res.json(db.all(`SELECT * FROM conversation_sessions ORDER BY created_at DESC LIMIT 100`));
}));
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  res.json(db.all(`SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY created_at`, [req.params.id]));
}));

module.exports = router;
