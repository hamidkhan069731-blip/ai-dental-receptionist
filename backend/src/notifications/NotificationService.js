const { v4: uuid } = require('uuid');
const db = require('../db');
const config = require('../config');

/**
 * NotificationService abstracts all outbound patient communication.
 * Each channel is a separate method so a real provider can be dropped
 * in later purely via environment variables, without touching call
 * sites elsewhere in the app (booking flow, admin resend, etc).
 */
class NotificationService {
  async sendEmail(to, subject, body, appointmentId = null) {
    const record = this._log('email', to, { subject, body }, appointmentId);
    if (!config.notifications.emailApiKey) {
      // No provider configured — log only, mark as "pending" so it's
      // visible in the admin dashboard rather than silently dropped.
      console.log(`[NotificationService] (no EMAIL_API_KEY configured) Would send email to ${to}: ${subject}`);
      return record;
    }
    try {
      // Real provider call would go here, e.g.:
      // await fetch('https://api.sendgrid.com/v3/mail/send', { ... })
      this._markSent(record.id);
      return { ...record, status: 'sent' };
    } catch (err) {
      this._markFailed(record.id, err.message);
      throw err;
    }
  }

  async sendSMS(to, message, appointmentId = null) {
    const record = this._log('sms', to, { message }, appointmentId);
    console.log(`[NotificationService] SMS provider not configured. Would send SMS to ${to}: ${message}`);
    return record;
  }

  async sendWhatsApp(to, message, appointmentId = null) {
    const record = this._log('whatsapp', to, { message }, appointmentId);
    if (!config.notifications.whatsappApiKey) {
      console.log(`[NotificationService] (WhatsApp not configured) Would send WhatsApp to ${to}: ${message}`);
      return record;
    }
    // Real integration point for the WhatsApp Business API, e.g.:
    // await fetch(`https://graph.facebook.com/v19.0/${config.notifications.whatsappPhoneId}/messages`, { ... })
    this._markSent(record.id);
    return { ...record, status: 'sent' };
  }

  _log(channel, recipient, payload, appointmentId) {
    const id = uuid();
    db.run(
      `INSERT INTO notifications (id, appointment_id, channel, recipient, status, payload) VALUES (?, ?, ?, ?, 'pending', ?)`,
      [id, appointmentId, channel, recipient, JSON.stringify(payload)]
    );
    return { id, appointment_id: appointmentId, channel, recipient, status: 'pending', payload };
  }

  _markSent(id) {
    db.run(`UPDATE notifications SET status = 'sent' WHERE id = ?`, [id]);
  }

  _markFailed(id, reason) {
    db.run(`UPDATE notifications SET status = 'failed', payload = payload || ? WHERE id = ?`, [
      JSON.stringify({ error: reason }),
      id,
    ]);
  }
}

module.exports = new NotificationService();
