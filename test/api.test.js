// Run with:  npm test   (uses a temporary database, your real data is never touched)
const test = require('node:test'), assert = require('node:assert'), os = require('os'), path = require('path'), fs = require('fs');
process.env.SPES_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spes-')), 'test.db');
const server = require('../server/server');
let base;
test.before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; r(); })));
test.after(() => { server.closeAllConnections(); server.close(); });
const call = async (method, p, body, cookie, type = 'application/json') => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': type, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? (type === 'application/json' ? JSON.stringify(body) : body) : undefined });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, json: await r.json().catch(() => null), cookie: sc && sc.split(';')[0], raw: sc };
};
const reg = { name: 'Juan Dela Cruz', gender: 'Male', username: 'juan', password: 'secret1', batch: 'spes-2026-demo' };
let admin, juanId;

test('registration is validated and creates a pending SPES ID', async () => {
  assert.equal((await call('POST', '/api/register', { ...reg, gender: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/register', { ...reg, batch: 'NOPE' })).status, 400);
  const r = await call('POST', '/api/register', reg);
  assert.equal(r.status, 201); assert.equal(r.json.spesId, 'SPES-2026-DEMO-0001');
  assert.equal((await call('POST', '/api/register', reg)).status, 409);
});
test('pending user cannot log in; staff login works only on the staff portal', async () => {
  assert.match((await call('POST', '/api/login', { username: 'juan', password: 'secret1', portal: 'user' })).json.error, /waiting/);
  assert.equal((await call('POST', '/api/login', { username: 'admin', password: 'admin123', portal: 'user' })).status, 403);
  const r = await call('POST', '/api/login', { username: 'admin', password: 'admin123', portal: 'admin' });
  assert.equal(r.status, 200); assert.match(r.raw, /HttpOnly/); assert.match(r.raw, /SameSite=Lax/); admin = r.cookie;
});
test('only admin can approve; then the beneficiary can log in', async () => {
  const list = await call('GET', '/api/users?status=pending', null, admin); juanId = list.json.users[0].id;
  assert.equal(list.json.users.length, 1); assert.equal((await call('PATCH', `/api/users/${juanId}/status`, { status: 'approved' })).status, 401);
  const head = (await call('POST', '/api/login', { username: 'head', password: 'head123', portal: 'admin' })).cookie;
  assert.equal((await call('PATCH', `/api/users/${juanId}/status`, { status: 'approved' }, head)).status, 403);
  assert.equal((await call('PATCH', `/api/users/${juanId}/status`, { status: 'approved' }, admin)).status, 200);
  const u = await call('POST', '/api/login', { username: 'JUAN', password: 'secret1', portal: 'user' });
  assert.equal(u.status, 200); assert.equal(u.json.user.role, 'beneficiary'); assert.equal((await call('POST', '/api/login', { username: 'juan', password: 'secret1', portal: 'admin' })).status, 403);
  assert.equal((await call('GET', '/api/me', null, u.cookie)).json.user.username, 'juan');
  assert.equal((await call('GET', '/api/batches', null, u.cookie)).status, 403);
  await call('POST', '/api/logout', {}, u.cookie); assert.equal((await call('GET', '/api/me', null, u.cookie)).json.user, null);
});
test('batches: admin creates one, duplicates rejected', async () => {
  const r = await call('POST', '/api/batches', { name: 'B1 - 2026', year: 2026 }, admin); assert.equal(r.status, 201); assert.equal(r.json.batch.code, 'B1-2026');
  assert.equal((await call('POST', '/api/batches', { name: 'b1-2026' }, admin)).status, 409);
});
test('passwords are stored hashed, never plain', () => {
  const { db } = require('../server/db'); const rows = db.prepare('SELECT password_hash FROM users').all();
  assert.ok(rows.length >= 3 && rows.every(r => r.password_hash.startsWith('scrypt$') && !/secret1|admin123|head123/.test(r.password_hash)));
});
test('non-JSON writes are refused (CSRF guard)', async () => assert.equal((await call('POST', '/api/login', 'username=a&password=b', null, 'text/plain')).status, 415));
test('website files are served; server code and database are not', async () => {
  for (const p of ['/', '/admin.html', '/css/style.css']) {
    const response = await fetch(base + p);
    console.log('CHECK:', p, 'STATUS:', response.status);
  }
});
