function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

function isValidTime(str) {
  return typeof str === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

function isValidPhone(str) {
  return typeof str === 'string' && /^\+?[0-9]{7,15}$/.test(str.replace(/[\s-]/g, ''));
}

function isValidEmail(str) {
  return typeof str === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function normalizePhone(str) {
  return str.replace(/[\s-]/g, '');
}

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
  }
}

module.exports = { isValidDate, isValidTime, isValidPhone, isValidEmail, normalizePhone, ValidationError };
