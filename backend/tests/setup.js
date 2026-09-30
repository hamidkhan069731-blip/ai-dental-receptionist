const fs = require('fs');
const path = require('path');

// Use a dedicated test database file so tests never touch dev data,
// and start from a clean slate on every run.
const testDbPath = path.resolve(__dirname, '../data/test.db');
process.env.DATABASE_URL = './data/test.db';
process.env.JWT_SECRET = 'test-secret';

for (const suffix of ['', '-wal', '-shm']) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const { migrate } = require('../src/db/schema');
migrate();

module.exports = {};
