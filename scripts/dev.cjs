const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'tmp/running-project.json');
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else child.kill('SIGTERM');
  }
  fs.rmSync(stateFile, { force: true });
  process.exitCode = code;
  console.log('\nApplication servers stopped. Docker services and their data are kept.');
}

function portInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  for (const folder of ['backend', 'frontend']) {
    if (!fs.existsSync(path.join(root, folder, 'node_modules'))) {
      throw new Error(`Install dependencies first: npm --prefix ${folder} ci`);
    }
  }
  const config = require('../backend/node_modules/dotenv').parse(
    fs.readFileSync(path.join(root, 'backend/.env'))
  );
  const backendEnv = { ...config, ...process.env, NODE_ENV: 'development' };
  const backendPort = Number(backendEnv.PORT || 3001);
  const frontendPort = Number(new URL(backendEnv.FRONTEND_URL || 'http://localhost:3000').port || 3000);
  for (const port of [backendPort, frontendPort]) {
    if (await portInUse(port)) throw new Error(`Port ${port} is already in use. Stop the existing server before starting the app.`);
  }

  const docker = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { cwd: root, stdio: 'inherit' });
  if (docker.error) throw new Error('Docker is required. Start Docker Desktop and try again.');
  if (docker.status !== 0) throw new Error('Could not start PostgreSQL and Redis. Check Docker Desktop and the output above.');

  const nodePath = path.dirname(process.execPath) + path.delimiter + process.env.PATH;
  const backend = spawn(process.execPath,
    ['node_modules/ts-node-dev/lib/bin.js', '--respawn', '--transpile-only', 'src/index.ts'],
    { cwd: path.join(root, 'backend'), stdio: 'inherit', env: { ...backendEnv, PATH: nodePath } });
  const frontend = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--port', String(frontendPort)],
    { cwd: path.join(root, 'frontend'), stdio: 'inherit', env: { ...process.env, PATH: nodePath,
      NODE_ENV: 'development', NEXT_PUBLIC_API_URL: `http://localhost:${backendPort}` } });
  children.push(backend, frontend);
  for (const [label, child] of [['Backend', backend], ['Frontend', frontend]]) {
    child.once('error', error => { console.error(`${label}: ${error.message}`); stop(1); });
    child.once('exit', code => {
      if (!stopping) { console.error(`${label} exited (${code ?? 'signal'}).`); stop(code || 1); }
    });
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ backendPid: backend.pid, frontendPid: frontend.pid,
    backendUrl: `http://localhost:${backendPort}`, frontendUrl: `http://localhost:${frontendPort}` }, null, 2));
  console.log(`\nApp: http://localhost:${frontendPort}\nAPI: http://localhost:${backendPort}/api/health\nPress Ctrl+C to stop both servers.\n`);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
main().catch(error => { console.error(error.message); process.exitCode = 1; });
