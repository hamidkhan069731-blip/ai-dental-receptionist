const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const patientService = require('../services/patientService');
const { appointmentToICS } = require('../utils/ics');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/validation');

router.get('/', asyncHandler(async (req, res) => {
  const { date, doctor_id, status } = req.query;
  res.json(appointmentService.listAppointments({ date, doctorId: doctor_id, status }));
}));

router.get('/by-phone/:phone', asyncHandler(async (req, res) => {
  res.json(patientService.getPatientAppointments(req.params.phone));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const appt = appointmentService.getAppointment(req.params.id);
  if (!appt) throw new ValidationError('Appointment not found.', 'id');
  res.json(appt);
}));

router.get('/:id/ics', asyncHandler(async (req, res) => {
  const appt = appointmentService.getAppointment(req.params.id);
  if (!appt) throw new ValidationError('Appointment not found.', 'id');
  const ics = appointmentToICS(appt);
  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', `attachment; filename="${appt.booking_code}.ics"`);
  res.send(ics);
}));

router.post('/', asyncHandler(async (req, res) => {
  const appt = appointmentService.bookAppointment(req.body);
  res.status(201).json(appt);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { new_date, new_time, action } = req.body;
  if (action === 'cancel') {
    return res.json(appointmentService.cancelAppointment(req.params.id));
  }
  if (new_date && new_time) {
    return res.json(appointmentService.rescheduleAppointment(req.params.id, new_date, new_time));
  }
  throw new ValidationError('Provide either action="cancel" or new_date/new_time to reschedule.');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(appointmentService.cancelAppointment(req.params.id));
}));

module.exports = router;
