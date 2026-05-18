const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const HOST = '127.0.0.1';
const PORT = process.env.PORT || 3001;

function requestJson(pathname, method = 'GET', data = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = {
      hostname: HOST,
      port: PORT,
      path: pathname,
      method,
      headers,
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const body = raw ? JSON.parse(raw) : null;
          resolve({ statusCode: res.statusCode, body });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  const seedPath = path.join(__dirname, 'smoke-seed-output.json');
  if (!fs.existsSync(seedPath)) {
    console.error('Seed output not found. Run scripts/smoke-seed.js first.');
    process.exit(1);
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log('Loaded seed:', seed);

  // Login as parent
  console.log('\nLogging in as parent...');
  const lp = await requestJson('/api/auth/login', 'POST', { email: seed.parent.email, password: seed.parent.password });
  if (!lp.body || !lp.body.token) {
    console.error('Parent login failed:', lp);
    process.exit(1);
  }
  const parentToken = lp.body.token;
  console.log('Parent token received. userId:', lp.body.userId);

  // Generate invitation
  console.log('\nGenerating invitation for child', seed.child.id);
  const gen = await requestJson('/api/v2/guardians/generate-invitation', 'POST', { childId: seed.child.id }, parentToken);
  console.log('Generate response:', gen.statusCode, gen.body);
  if (!gen.body || !gen.body.invitationCode) {
    console.error('Failed to generate invitation');
    process.exit(1);
  }
  const invitationCode = gen.body.invitationCode;
  console.log('Invitation code:', invitationCode);

  // Login as guardian
  console.log('\nLogging in as guardian user...');
  const lg = await requestJson('/api/auth/login', 'POST', { email: seed.guardian.email, password: seed.guardian.password });
  if (!lg.body || !lg.body.token) {
    console.error('Guardian login failed:', lg);
    process.exit(1);
  }
  const guardianToken = lg.body.token;
  console.log('Guardian token received. userId:', lg.body.userId);

  // Accept invitation
  console.log('\nAccepting invitation as guardian...');
  const acc = await requestJson('/api/v2/guardians/accept-invitation', 'POST', { code: invitationCode }, guardianToken);
  console.log('Accept response:', acc.statusCode, acc.body);
  if (!acc.body || !acc.body.success) {
    console.error('Failed to accept invitation');
    process.exit(1);
  }

  // Send chat message as parent
  console.log('\nSending chat message as parent to appointment', seed.appointment.id);
  const send = await requestJson(`/api/chat/${seed.appointment.id}`, 'POST', { message: 'Hello from parent (smoke test)' }, parentToken);
  console.log('Chat send response:', send.statusCode, send.body);
  if (!send.body || !send.body.success) {
    console.error('Failed to send chat message');
    process.exit(1);
  }

  // Fetch chat messages as guardian
  console.log('\nFetching chat messages as guardian...');
  const fetch = await requestJson(`/api/chat/${seed.appointment.id}`, 'GET', null, guardianToken);
  console.log('Chat fetch response:', fetch.statusCode);
  console.log(JSON.stringify(fetch.body, null, 2));

  if (fetch.body && Array.isArray(fetch.body.messages) && fetch.body.messages.length > 0) {
    console.log('\nSmoke test succeeded: guardian can view chat messages.');
    process.exit(0);
  }

  console.error('Smoke test failed to find messages for guardian.');
  process.exit(1);
}

run().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
