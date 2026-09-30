const clinicService = require('../services/clinicService');
const doctorService = require('../services/doctorService');
const patientService = require('../services/patientService');
const appointmentService = require('../services/appointmentService');
const notificationService = require('../notifications/NotificationService');
const { getAvailableSlots } = require('../utils/availability');
const { appointmentToICS } = require('../utils/ics');
const { v4: uuid } = require('uuid');
const db = require('../db');

/** Anthropic tool-use JSON schema definitions — the contract the LLM sees. */
const toolDefinitions = [
  {
    name: 'get_clinic_information',
    description: 'Get clinic name, address, phone, hours, and FAQs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_services',
    description: 'List all active dental services with descriptions, durations, and prices.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_doctors',
    description: 'List all active doctors with their specialization.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_doctor_schedule',
    description: 'Get a specific doctor\'s weekly working schedule and holidays.',
    input_schema: {
      type: 'object',
      properties: { doctor_id: { type: 'string' } },
      required: ['doctor_id'],
    },
  },
  {
    name: 'check_available_slots',
    description: 'Get real, currently-open appointment slots for a doctor on a specific date (YYYY-MM-DD). Always use this before offering a time to a patient.',
    input_schema: {
      type: 'object',
      properties: {
        doctor_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['doctor_id', 'date'],
    },
  },
  {
    name: 'get_available_doctors',
    description: 'List which doctors have at least one open slot on a given date.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'create_patient',
    description: 'Create or update a patient record by phone number. Call this before booking if the patient is not yet identified in this session.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a confirmed appointment. Only call after confirming doctor, date, time, patient name, and phone with the patient out loud.',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string' },
        doctor_id: { type: 'string' },
        service_id: { type: 'string', description: 'Optional service ID' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM 24-hour' },
        reason: { type: 'string' },
      },
      required: ['patient_id', 'doctor_id', 'date', 'time'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing appointment by its ID.',
    input_schema: {
      type: 'object',
      properties: { appointment_id: { type: 'string' } },
      required: ['appointment_id'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing appointment to a new date/time. Verifies the new slot is free first.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string' },
        new_date: { type: 'string', description: 'YYYY-MM-DD' },
        new_time: { type: 'string', description: 'HH:MM 24-hour' },
      },
      required: ['appointment_id', 'new_date', 'new_time'],
    },
  },
  {
    name: 'get_patient_appointments',
    description: 'Look up a patient\'s appointments by phone number.',
    input_schema: {
      type: 'object',
      properties: { phone: { type: 'string' } },
      required: ['phone'],
    },
  },
  {
    name: 'send_booking_confirmation',
    description: 'Send a booking confirmation (email/SMS/WhatsApp depending on what the patient has on file) for a confirmed appointment.',
    input_schema: {
      type: 'object',
      properties: { appointment_id: { type: 'string' } },
      required: ['appointment_id'],
    },
  },
  {
    name: 'handoff_to_human',
    description: 'Escalate the conversation to clinic staff — use for emergencies, complaints, or anything outside what you can safely resolve.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

/** Executes a tool call by name and returns a JSON-serializable result. */
function executeTool(name, input, sessionId) {
  switch (name) {
    case 'get_clinic_information':
      return clinicService.getClinicInfo();

    case 'get_services':
      return clinicService.listServices();

    case 'get_doctors':
      return doctorService.listDoctors();

    case 'get_doctor_schedule':
      return doctorService.getDoctorSchedule(input.doctor_id);

    case 'check_available_slots':
      return getAvailableSlots(input.doctor_id, input.date);

    case 'get_available_doctors':
      return doctorService.getAvailableDoctors(input.date);

    case 'create_patient':
      return patientService.createOrGetPatient(input);

    case 'book_appointment': {
      const result = appointmentService.bookAppointment(input);
      logHandoffOrBooking(sessionId, 'book_appointment', result);
      return result;
    }

    case 'cancel_appointment':
      return appointmentService.cancelAppointment(input.appointment_id);

    case 'reschedule_appointment':
      return appointmentService.rescheduleAppointment(input.appointment_id, input.new_date, input.new_time);

    case 'get_patient_appointments':
      return patientService.getPatientAppointments(input.phone);

    case 'send_booking_confirmation': {
      const appt = appointmentService.getAppointment(input.appointment_id);
      if (!appt) return { error: 'APPOINTMENT_NOT_FOUND' };
      const ics = appointmentToICS(appt);
      if (appt.patient_phone) {
        notificationService.sendSMS(
          appt.patient_phone,
          `Your appointment with ${appt.doctor_name} is confirmed for ${appt.appointment_date} at ${appt.start_time}. Booking ID: ${appt.booking_code}.`,
          appt.id
        );
      }
      return { sent: true, booking_code: appt.booking_code, ics_available: true };
    }

    case 'handoff_to_human': {
      if (sessionId) {
        db.run(
          `UPDATE conversation_sessions SET status = 'handoff', handoff_reason = ?, updated_at = datetime('now') WHERE id = ?`,
          [input.reason, sessionId]
        );
      }
      db.run(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details) VALUES (?, 'ai', 'handoff_to_human', 'conversation_session', ?, ?)`,
        [uuid(), sessionId || null, JSON.stringify({ reason: input.reason })]
      );
      return { escalated: true, reason: input.reason, message: 'Clinic staff have been notified and will follow up.' };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function logHandoffOrBooking(sessionId, action, result) {
  if (!sessionId) return;
  db.run(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details) VALUES (?, 'ai', ?, 'conversation_session', ?, ?)`,
    [uuid(), action, sessionId, JSON.stringify({ result: result?.id || result })]
  );
}

/**
 * Converts Anthropic-style tool definitions to the OpenAI/Groq
 * function-calling shape: { type: 'function', function: { name,
 * description, parameters } }. Used only when AI_PROVIDER=groq.
 */
function toOpenAITools() {
  return toolDefinitions.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

module.exports = { toolDefinitions, executeTool, toOpenAITools };
