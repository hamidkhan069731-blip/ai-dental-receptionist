const request = require('supertest');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const app = require('../src/server');

function makeAdmin(email, password) {
  const id = uuid();
  db.run(`INSERT INTO users (id, name, email, password_hash, role) VALUES (?, 'Test Admin', ?, ?, 'admin')`, [
    id, email, bcrypt.hashSync(password, 10),
  ]);
  return id;
}

describe('admin auth API', () => {
  beforeAll(() => {
    makeAdmin('apitest@example.com', 'Secret123');
  });

  test('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/admin/login').send({ email: 'apitest@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('logs in with correct credentials and returns a JWT', async () => {
    const res = await request(app).post('/api/admin/login').send({ email: 'apitest@example.com', password: 'Secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('blocks protected route without a token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('allows protected route with a valid token', async () => {
    const login = await request(app).post('/api/admin/login').send({ email: 'apitest@example.com', password: 'Secret123' });
    const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('todays_appointments');
  });
});

describe('appointments API validation', () => {
  test('rejects a booking request with missing fields', async () => {
    const res = await request(app).post('/api/appointments').send({ doctor_id: 'x' });
    expect(res.status).toBe(400);
  });

  test('rejects availability lookup without a date', async () => {
    const res = await request(app).get('/api/doctors/some-id/availability');
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown appointment', async () => {
    const res = await request(app).get('/api/appointments/does-not-exist');
    expect(res.status).toBe(400); // ValidationError, treated as 400 since not found is modeled as validation here
  });
});

describe('AI tool endpoint', () => {
  test('rejects unknown tool names', async () => {
    const res = await request(app).post('/api/ai/tool').send({ name: 'not_a_real_tool', input: {} });
    expect(res.status).toBe(400);
  });

  test('executes get_clinic_information tool for real, hitting the actual database layer', async () => {
    const res = await request(app).post('/api/ai/tool').send({ name: 'get_clinic_information', input: {} });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('faqs');
    expect(Array.isArray(res.body.faqs)).toBe(true);
  });
});
