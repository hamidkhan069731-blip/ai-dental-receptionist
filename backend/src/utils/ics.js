/**
 * Generates a minimal, standards-compliant .ics VEVENT for a confirmed
 * appointment. Google Calendar integration (OAuth push) can be added
 * later behind the same call site — see README "Calendar Integration".
 */
function appointmentToICS(appt) {
  const [y, m, d] = appt.appointment_date.split('-').map(Number);
  const [sh, sm] = appt.start_time.split(':').map(Number);
  const [eh, em] = appt.end_time.split(':').map(Number);

  const dtStart = formatICSDate(y, m, d, sh, sm);
  const dtEnd = formatICSDate(y, m, d, eh, em);
  const now = new Date();
  const dtStamp = formatICSDate(
    now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
    now.getUTCHours(), now.getUTCMinutes()
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smile Dental Clinic//AI Receptionist//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${appt.id}@smiledentalclinic.example`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:Dental Appointment - ${escapeICS(appt.doctor_name)}`,
    `DESCRIPTION:${escapeICS(`Appointment with ${appt.doctor_name}${appt.service_name ? ' for ' + appt.service_name : ''}. Booking ID: ${appt.booking_code}.`)}`,
    'LOCATION:Smile Dental Clinic',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function formatICSDate(y, m, d, hh, mm) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
}

function escapeICS(str) {
  return String(str).replace(/([,;])/g, '\\$1');
}

module.exports = { appointmentToICS };
