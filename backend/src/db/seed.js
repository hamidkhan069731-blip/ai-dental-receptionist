const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./index');
const { migrate } = require('./schema');

function seed() {
  migrate();

  const tx = db.raw.transaction(() => {
    // ---- Clear existing demo data (idempotent re-seed) ----
    db.run('DELETE FROM notifications');
    db.run('DELETE FROM appointments');
    db.run('DELETE FROM doctor_holidays');
    db.run('DELETE FROM doctor_schedules');
    db.run('DELETE FROM doctors');
    db.run('DELETE FROM services');
    db.run('DELETE FROM patients');
    db.run('DELETE FROM faq');
    db.run('DELETE FROM clinic_settings');
    db.run('DELETE FROM users');

    // ---- Admin user ----
    const adminId = uuid();
    const passwordHash = bcrypt.hashSync('Admin@123', 10);
    db.run(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
      [adminId, 'Clinic Admin', 'admin@smiledental.example', passwordHash, 'admin']
    );

    // ---- Clinic settings ----
    const settings = {
      clinic_name: 'Smile Dental Clinic',
      address: '123 Main Boulevard, Gulberg, Lahore, Pakistan',
      phone: '+92-42-111-222-333',
      email: 'info@smiledentalclinic.example',
      timezone: 'Asia/Karachi',
      opening_hours: 'Mon-Sat 10:00 AM - 8:00 PM',
      ai_receptionist_name: 'Dr. Clinic AI Receptionist',
    };
    for (const [key, value] of Object.entries(settings)) {
      db.run('INSERT INTO clinic_settings (key, value) VALUES (?, ?)', [key, value]);
    }

    // ---- Services ----
    const services = [
      ['Dental Cleaning', 'Routine professional cleaning and plaque removal.', 30, 3000],
      ['Root Canal', 'Treatment for infected or damaged tooth pulp.', 60, 15000],
      ['Tooth Extraction', 'Removal of a damaged or problematic tooth.', 30, 5000],
      ['Dental Filling', 'Restoring a tooth damaged by decay.', 30, 4000],
      ['Braces Consultation', 'Initial assessment for orthodontic braces.', 30, 2000],
      ['Implant Consultation', 'Assessment for dental implant suitability.', 30, 2500],
      ['Teeth Whitening', 'Cosmetic whitening treatment.', 45, 12000],
      ['General Consultation', 'General checkup and advice.', 20, 1500],
    ];
    const serviceIds = {};
    for (const [name, description, duration, price] of services) {
      const id = uuid();
      serviceIds[name] = id;
      db.run(
        `INSERT INTO services (id, name, description, duration_minutes, price, active) VALUES (?, ?, ?, ?, ?, 1)`,
        [id, name, description, duration, price]
      );
    }

    // ---- Doctors ----
    const drAhmedId = uuid();
    db.run(
      `INSERT INTO doctors (id, name, specialization, bio, appointment_duration_minutes, active) VALUES (?, ?, ?, ?, ?, 1)`,
      [drAhmedId, 'Dr Ahmed Khan', 'General Dentist', 'General dentistry with 12 years of experience.', 30]
    );
    const drSaraId = uuid();
    db.run(
      `INSERT INTO doctors (id, name, specialization, bio, appointment_duration_minutes, active) VALUES (?, ?, ?, ?, ?, 1)`,
      [drSaraId, 'Dr Sara Ali', 'Orthodontist', 'Specialist in braces and orthodontic care.', 30]
    );

    // Dr Ahmed: Mon 10-2 & 4-8, Tue 10-2, Wed 10-2 & 4-8, Thu 10-2, Sat 10-2
    const ahmedSchedule = [
      [1, '10:00', '14:00'], [1, '16:00', '20:00'],
      [2, '10:00', '14:00'],
      [3, '10:00', '14:00'], [3, '16:00', '20:00'],
      [4, '10:00', '14:00'],
      [6, '10:00', '14:00'],
    ];
    for (const [day, start, end] of ahmedSchedule) {
      db.run(
        `INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
        [uuid(), drAhmedId, day, start, end]
      );
    }

    // Dr Sara: Mon-Fri 2-6
    for (const day of [1, 2, 3, 4, 5]) {
      db.run(
        `INSERT INTO doctor_schedules (id, doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
        [uuid(), drSaraId, day, '14:00', '18:00']
      );
    }

    // ---- FAQs ----
    const faqs = [
      ['What are your clinic hours?', 'We are open Monday to Saturday, 10:00 AM to 8:00 PM.'],
      ['Where is the clinic located?', 'We are located at 123 Main Boulevard, Gulberg, Lahore, Pakistan.'],
      ['Do you accept walk-ins?', 'We recommend booking an appointment, but walk-ins are accommodated when slots are available.'],
      ['Do you treat children?', 'Yes, Dr Ahmed Khan sees pediatric patients for general dental care.'],
      ['What payment methods do you accept?', 'We accept cash and major debit/credit cards at the clinic.'],
    ];
    for (const [question, answer] of faqs) {
      db.run(`INSERT INTO faq (id, question, answer, active) VALUES (?, ?, ?, 1)`, [uuid(), question, answer]);
    }

    // ---- Sample patient + appointment ----
    const patientId = uuid();
    db.run(
      `INSERT INTO patients (id, name, phone, email, preferred_language) VALUES (?, ?, ?, ?, ?)`,
      [patientId, 'Ali Khan', '+923001234567', 'ali.khan@example.com', 'en']
    );

    const today = new Date();
    const sampleDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
    const dateStr = sampleDate.toISOString().slice(0, 10);

    db.run(
      `INSERT INTO appointments (id, booking_code, patient_id, doctor_id, service_id, appointment_date, start_time, end_time, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [
        uuid(),
        'APT-000001',
        patientId,
        drAhmedId,
        serviceIds['General Consultation'],
        dateStr,
        '10:00',
        '10:30',
        'Routine checkup',
      ]
    );

    console.log('Seeded doctors:', { drAhmedId, drSaraId });
    console.log('Admin login -> email: admin@smiledental.example / password: Admin@123');
  });

  tx();
  console.log('✔ Demo data seeded successfully.');
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
