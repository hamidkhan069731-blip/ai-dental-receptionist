const express = require('express');
const router = express.Router();
const patientService = require('../services/patientService');
const asyncHandler = require('../utils/asyncHandler');

router.post('/', asyncHandler(async (req, res) => {
  const patient = patientService.createOrGetPatient(req.body);
  res.status(201).json(patient);
}));

router.get('/lookup', asyncHandler(async (req, res) => {
  const { phone } = req.query;
  const patient = patientService.getPatientByPhone(phone);
  res.json(patient || null);
}));

module.exports = router;
