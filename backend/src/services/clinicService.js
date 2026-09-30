const { v4: uuid } = require('uuid');
const db = require('../db');

function getClinicInfo() {
  const rows = db.all('SELECT key, value FROM clinic_settings');
  const info = {};
  for (const r of rows) info[r.key] = r.value;
  const faqs = db.all('SELECT question, answer FROM faq WHERE active = 1 ORDER BY created_at');
  return { ...info, faqs };
}

function updateClinicSetting(key, value) {
  db.run(
    `INSERT INTO clinic_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  return getClinicInfo();
}

function listServices({ activeOnly = true } = {}) {
  return activeOnly
    ? db.all('SELECT * FROM services WHERE active = 1 ORDER BY name')
    : db.all('SELECT * FROM services ORDER BY name');
}

function createService({ name, description, duration_minutes, price }) {
  const id = uuid();
  db.run(
    'INSERT INTO services (id, name, description, duration_minutes, price, active) VALUES (?, ?, ?, ?, ?, 1)',
    [id, name, description || null, duration_minutes || 30, price || 0]
  );
  return db.get('SELECT * FROM services WHERE id = ?', [id]);
}

function updateService(id, fields) {
  const svc = db.get('SELECT * FROM services WHERE id = ?', [id]);
  if (!svc) return null;
  const merged = { ...svc, ...fields };
  db.run(
    `UPDATE services SET name=?, description=?, duration_minutes=?, price=?, active=?, updated_at=datetime('now') WHERE id=?`,
    [merged.name, merged.description, merged.duration_minutes, merged.price, merged.active ? 1 : 0, id]
  );
  return db.get('SELECT * FROM services WHERE id = ?', [id]);
}

function listFaqs() {
  return db.all('SELECT * FROM faq ORDER BY created_at');
}

function createFaq(question, answer) {
  const id = uuid();
  db.run('INSERT INTO faq (id, question, answer, active) VALUES (?, ?, ?, 1)', [id, question, answer]);
  return db.get('SELECT * FROM faq WHERE id = ?', [id]);
}

module.exports = {
  getClinicInfo,
  updateClinicSetting,
  listServices,
  createService,
  updateService,
  listFaqs,
  createFaq,
};
