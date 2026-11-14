const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGTERM'); } catch {} }
}
async function responds(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; }
  catch { return false; }
}

test('one launcher starts both servers and stops the frontend if the backend exits', { timeout: 150000 }, async t => {
  const runner = spawn(process.execPath, [path.join(root, 'scripts/dev.cjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '13001', FRONTEND_URL: 'http://localhost:13000',
      DATABASE_URL: 'postgresql://postgres:test_password@127.0.0.1:15433/email_scheduler_test',
      REDIS_URL: 'redis://127.0.0.1:16379', JWT_SECRET: 'local-startup-check-at-least-32-characters',
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', NEXT_TELEMETRY_DISABLED: '1' },
  });
  let log = '', children = [];
  runner.stdout.on('data', chunk => { log += chunk; });
  runner.stderr.on('data', chunk => { log += chunk; });
  t.after(() => {
    if (runner.exitCode === null) killTree(runner.pid);
    for (const pid of children) killTree(pid);
  });
  const deadline = Date.now() + 110000;
  let ready = false;
  while (Date.now() < deadline) {
    assert.equal(runner.exitCode, null, `Launcher exited before the servers were ready:\n${log}`);
    if (await responds('http://localhost:13001/api/health') && await responds('http://localhost:13000/login')) {
      ready = true;
      break;
    }
    await pause(300);
  }
  assert.ok(ready, `Both servers must start from one command:\n${log}`);
  const servers = JSON.parse(fs.readFileSync(path.join(root, 'tmp/running-project.json'), 'utf8'));
  children = [servers.backendPid, servers.frontendPid];
  assert.equal(servers.backendUrl, 'http://localhost:13001');
  assert.equal(servers.frontendUrl, 'http://localhost:13000');
  const exited = once(runner, 'exit', { signal: AbortSignal.timeout(15000) });
  killTree(servers.backendPid);
  const [code] = await exited;
  assert.notEqual(code, 0, 'An unexpected server exit must be reported');
  assert.equal(await responds('http://localhost:13000/login'), false);
  assert.equal(await responds('http://localhost:13001/api/health'), false);
});
