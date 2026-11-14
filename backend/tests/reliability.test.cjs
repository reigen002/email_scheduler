const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { Queue } = require('bullmq');

const databaseUrl = 'postgresql://postgres:test_password@127.0.0.1:15433/email_scheduler_test';
const redisUrl = 'redis://127.0.0.1:16379';
const apiUrl = 'http://127.0.0.1:13001';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  assert.fail('Condition did not become true before timeout');
}

test('submission reliability checks against real PostgreSQL, Redis, and SMTP', { timeout: 120000 }, async t => {
  const messages = [];
  const attempts = [];
  const failOnce = new Set();
  const sockets = new Set();
  const smtp = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '', data = null, recipient = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data !== null) {
          if (line === '.') {
            attempts.push(recipient);
            if (failOnce.delete(recipient)) socket.write('451 Try again later\r\n');
            else {
              messages.push({ recipient, body: data, at: Date.now() });
              socket.write('250 Message accepted\r\n');
            }
            data = null;
          } else data += line + '\r\n';
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
        else if (/^RCPT TO:/i.test(line)) {
          recipient = line.match(/<([^>]+)>/)[1];
          socket.write('250 OK\r\n');
        } else if (/^DATA$/i.test(line)) {
          data = '';
          socket.write('354 End with dot\r\n');
        } else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  smtp.listen(0, '127.0.0.1');
  await once(smtp, 'listening');
  const pool = new Pool({ connectionString: databaseUrl });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('email-delivery', { connection: queueConnection });
  let backend, log = '', token;

  async function stop() {
    if (backend && backend.exitCode === null) {
      const exited = once(backend, 'exit');
      backend.kill('SIGKILL');
      await exited;
    }
  }
  async function start() {
    log = '';
    backend = spawn(process.execPath, ['--require', path.join(__dirname, 'local-smtp.cjs'), 'dist/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', PORT: '13001', DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl, JWT_SECRET: 'local-test-secret-at-least-32-characters',
        GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
        WORKER_CONCURRENCY: '5', MIN_DELAY_BETWEEN_SENDS_MS: '200',
        MAX_EMAILS_PER_HOUR_PER_SENDER: '200', TEST_SMTP_PORT: String(smtp.address().port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', chunk => { log += chunk; });
    backend.stderr.on('data', chunk => { log += chunk; });
    await until(async () => {
      assert.equal(backend.exitCode, null, log);
      try { return (await fetch(`${apiUrl}/api/health`)).ok; } catch { return false; }
    }, 20000).catch(error => { throw new Error(`${error.message}\nBackend log:\n${log}`); });
  }
  async function request(route, body, method = 'POST') {
    return fetch(`${apiUrl}/api${route}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function schedule(recipients, options = {}) {
    const response = await request('/emails/schedule', {
      sender_email: `${randomUUID()}@example.test`, subject: 'Reliability check', body: '<p>Test delivery</p>',
      recipients, scheduled_at: new Date(Date.now() + 700).toISOString(),
      delay_between_emails_ms: 0, hourly_limit: 200, ...options,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const { campaign_id } = await response.json();
    return campaign_id;
  }
  const delivered = recipient => messages.filter(message => message.recipient === recipient);

  t.after(async () => {
    await stop();
    await queue.close();
    await queueConnection.quit();
    await redis.quit();
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => smtp.close(resolve));
  });
  await start();
  const response = await request('/auth/register', { email: `${randomUUID()}@example.test`, password: 'local-check-password', name: 'Submission Reviewer' });
  assert.equal(response.status, 201);
  token = (await response.json()).token;

  await t.test('registration rejects invalid names without creating an account', async () => {
    for (const name of ['2', 'John2', '', '   ', 'A', '--', 'A'.repeat(101), 2, {}, undefined]) {
      const email = `${randomUUID()}@example.test`;
      const result = await request('/auth/register', { email, password: 'local-check-password', name });
      assert.equal(result.status, 400, `Registration accepted invalid name: ${JSON.stringify(name)}`);
      assert.equal(typeof (await result.json()).error, 'string');
      assert.equal((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rowCount, 0);
    }
  });

  await t.test('registration accepts international names and stores the trimmed value', async () => {
    for (const [name, expected] of [
      ['  Ada Lovelace  ', 'Ada Lovelace'], ['José Álvarez', 'José Álvarez'],
      ['Anne-Marie O’Neill', 'Anne-Marie O’Neill'], ['अमित कुमार', 'अमित कुमार'],
      ['李 明', '李 明'], ['J. Smith', 'J. Smith'],
    ]) {
      const email = `${randomUUID()}@example.test`;
      const result = await request('/auth/register', { email, password: 'local-check-password', name });
      assert.equal(result.status, 201, `Registration rejected valid name: ${name}`);
      assert.equal((await result.json()).user.name, expected);
      assert.equal((await pool.query('SELECT name FROM users WHERE email=$1', [email])).rows[0].name, expected);
    }
  });

  await t.test('a temporary SMTP failure retries and is recorded as sent', async () => {
    const recipient = `${randomUUID()}@example.test`;
    failOnce.add(recipient);
    const campaign = await schedule([recipient]);
    await until(() => delivered(recipient).length === 1);
    await until(async () => (await pool.query('SELECT status FROM email_jobs WHERE campaign_id=$1', [campaign])).rows[0]?.status === 'sent');
    assert.equal(attempts.filter(value => value === recipient).length, 2);
  });

  await t.test('campaign hourly limit defers excess mail without marking it failed', async () => {
    const sender = `${randomUUID()}@example.test`;
    const recipients = [`${randomUUID()}@example.test`, `${randomUUID()}@example.test`];
    const campaign = await schedule(recipients, { sender_email: sender, hourly_limit: 1 });
    await pause(2300);
    const jobs = (await pool.query('SELECT * FROM email_jobs WHERE campaign_id=$1 ORDER BY recipient_email', [campaign])).rows;
    assert.equal(jobs.filter(job => job.status === 'sent').length, 1);
    assert.equal(jobs.filter(job => job.status === 'scheduled').length, 1);
    const pending = jobs.find(job => job.status === 'scheduled');
    const queued = await queue.getJob(pending.bull_job_id);
    assert.equal(await queued.getState(), 'delayed');
    // Open a new quota in this isolated test and accelerate the delayed job.
    const keys = await redis.keys(`rate_limit:${sender}:*`);
    if (keys.length) await redis.del(...keys);
    await queued.changeDelay(0);
    await until(() => recipients.every(recipient => delivered(recipient).length === 1));
    await until(async () => (await pool.query("SELECT COUNT(*)::int AS n FROM email_jobs WHERE campaign_id=$1 AND status='sent'", [campaign])).rows[0].n === 2);
  });

  await t.test('parallel campaigns respect the global minimum interval between sends', async () => {
    const recipients = Array.from({ length: 3 }, () => `${randomUUID()}@example.test`);
    const time = new Date(Date.now() + 1000).toISOString();
    await Promise.all(recipients.map(recipient => schedule([recipient], { scheduled_at: time })));
    await until(() => recipients.every(recipient => delivered(recipient).length === 1));
    const times = messages.filter(message => recipients.includes(message.recipient)).map(message => message.at).sort((a, b) => a - b);
    assert.ok(times[1] - times[0] >= 150 && times[2] - times[1] >= 150, `Messages arrived too close together: ${times}`);
  });

  await t.test('future jobs survive an abrupt backend restart without duplicate delivery', async () => {
    const recipient = `${randomUUID()}@example.test`;
    const campaign = await schedule([recipient], { scheduled_at: new Date(Date.now() + 2500).toISOString() });
    await stop();
    await pause(700);
    await start();
    await until(() => delivered(recipient).length === 1);
    await until(async () => (await pool.query('SELECT status FROM email_jobs WHERE campaign_id=$1', [campaign])).rows[0]?.status === 'sent');
    await stop();
    await start();
    await pause(700);
    assert.equal(delivered(recipient).length, 1);
  });

  await t.test('a committed pending job missing from Redis is recovered on startup', async () => {
    const recipient = `${randomUUID()}@example.test`;
    const campaign = await schedule([recipient], { scheduled_at: new Date(Date.now() + 2200).toISOString() });
    await stop();
    const job = (await pool.query('SELECT * FROM email_jobs WHERE campaign_id=$1', [campaign])).rows[0];
    await (await queue.getJob(job.bull_job_id)).remove();
    await start();
    await until(() => delivered(recipient).length === 1, 5000);
  });

  await t.test('password endpoints cannot take over a Google-only account', async () => {
    const email = `${randomUUID()}@example.test`;
    await pool.query('INSERT INTO users (id,email,name) VALUES ($1,$2,$3)', [randomUUID(), email, 'Google user']);
    const login = await request('/auth/login', { email, password: 'attacker-password' });
    assert.equal(login.status, 401);
    const register = await request('/auth/register', { email, password: 'attacker-password', name: 'Google User' });
    assert.equal(register.status, 409);
    assert.equal((await pool.query('SELECT password_hash FROM users WHERE email=$1', [email])).rows[0].password_hash, null);
  });
});
