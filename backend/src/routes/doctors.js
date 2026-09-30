const express = require('express');
const router = express.Router();
const doctorService = require('../services/doctorService');
const { getAvailableSlots } = require('../utils/availability');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/validation');

router.get('/', asyncHandler(async (req, res) => {
  res.json(doctorService.listDoctors());
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const doctor = doctorService.getDoctor(req.params.id);
  if (!doctor) throw new ValidationError('Doctor not found.', 'id');
  res.json(doctor);
}));

router.get('/:id/availability', asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) throw new ValidationError('Query parameter "date" (YYYY-MM-DD) is required.', 'date');
  const result = getAvailableSlots(req.params.id, date);
  res.json(result);
}));

router.get('/:id/schedule', asyncHandler(async (req, res) => {
  const { doctor, windows } = doctorService.getDoctorSchedule(req.params.id);
  // Public view: working windows only (no holiday reasons, which may be internal).
  res.json({ doctor_id: doctor.id, windows });
}));

module.exports = router;
