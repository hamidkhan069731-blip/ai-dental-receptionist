const { isValidDate, isValidTime, isValidPhone, isValidEmail, normalizePhone } = require('../src/utils/validation');
const patientService = require('../src/services/patientService');
const { ValidationError } = require('../src/utils/validation');

describe('validation helpers', () => {
  test('isValidDate', () => {
    expect(isValidDate('2026-09-14')).toBe(true);
    expect(isValidDate('2026-13-40')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
  });

  test('isValidTime', () => {
    expect(isValidTime('09:30')).toBe(true);
    expect(isValidTime('25:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
  });

  test('isValidPhone', () => {
    expect(isValidPhone('+923001234567')).toBe(true);
    expect(isValidPhone('12')).toBe(false);
  });

  test('isValidEmail', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  test('normalizePhone strips spaces and dashes', () => {
    expect(normalizePhone('+92 300-123-4567')).toBe('+923001234567');
  });
});

describe('patient service', () => {
  test('creates a new patient with valid data', () => {
    const patient = patientService.createOrGetPatient({ name: 'Jane Doe', phone: '+923009990001' });
    expect(patient.name).toBe('Jane Doe');
    expect(patient.phone).toBe('+923009990001');
  });

  test('returns existing patient on repeat phone number instead of duplicating', () => {
    patientService.createOrGetPatient({ name: 'Jane Doe', phone: '+923009990002' });
    const second = patientService.createOrGetPatient({ name: 'Jane D.', phone: '+923009990002' });
    expect(second.name).toBe('Jane D.');
  });

  test('rejects invalid phone number', () => {
    expect(() => patientService.createOrGetPatient({ name: 'Bad Phone', phone: '123' })).toThrow(ValidationError);
  });

  test('rejects missing name', () => {
    expect(() => patientService.createOrGetPatient({ name: '', phone: '+923009990003' })).toThrow(ValidationError);
  });
});
