const express = require('express');
const router = express.Router();
const notificationService = require('../notifications/NotificationService');
const appointmentService = require('../services/appointmentService');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/validation');

router.post('/', asyncHandler(async (req, res) => {
  const { appointment_id, channel } = req.body;
  const appt = appointmentService.getAppointment(appointment_id);
  if (!appt) throw new ValidationError('Appointment not found.', 'appointment_id');

  const message = `Your appointment with ${appt.doctor_name} is confirmed for ${appt.appointment_date} at ${appt.start_time}. Booking ID: ${appt.booking_code}.`;

  let result;
  if (channel === 'email' && appt.patient_email) {
    result = await notificationService.sendEmail(appt.patient_email, 'Appointment Confirmation', message, appt.id);
  } else if (channel === 'whatsapp') {
    result = await notificationService.sendWhatsApp(appt.patient_phone, message, appt.id);
  } else {
    result = await notificationService.sendSMS(appt.patient_phone, message, appt.id);
  }
  res.status(201).json(result);
}));

module.exports = router;
