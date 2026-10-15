/**
 * Unified Local Development Server
 *
 * Spawns both Angular dev server (ng serve) and Robinhood MCP Observation API server
 * concurrently in a single process. Cleanly terminates both on exit.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const functionsDir = resolve(rootDir, 'functions');

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';
const spawnOpts = isWindows ? { stdio: 'inherit', shell: true } : { stdio: 'inherit' };

console.log('🚀 Starting Robinhood Observation API (port 3456)...');
const obsServer = spawn(
  npxCmd,
  ['tsx', 'src/rh-agent-mcp/local-api/start-observation-api.ts'],
  {
    cwd: functionsDir,
    ...spawnOpts,
  }
);

obsServer.on('error', (err) => {
  console.error('❌ Failed to start Observation API:', err);
});

console.log('🚀 Starting Angular dev server (ng serve)...');
const ngServe = spawn(npxCmd, ['ng', 'serve'], {
  cwd: rootDir,
  ...spawnOpts,
});

ngServe.on('error', (err) => {
  console.error('❌ Failed to start ng serve:', err);
});

let shuttingDown = false;

function onChildExit(name) {
  return (code, signal) => {
    if (shuttingDown) return;
    console.error(`❌ ${name} exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}). Shutting down.`);
    shutdown(code ?? 1);
  };
}

obsServer.on('exit', onChildExit('Observation API'));
ngServe.on('exit', onChildExit('ng serve'));

function killTree(child) {
  return new Promise((resolveKill) => {
    if (!child.pid || child.exitCode !== null) return resolveKill();
    const k = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore', shell: true });
    k.on('exit', resolveKill);
    k.on('error', resolveKill);
  });
}

async function cleanup() {
  shuttingDown = true;
  console.log('\n🛑 Stopping servers...');
  if (isWindows) {
    await Promise.all([killTree(obsServer), killTree(ngServe)]);
  } else {
    obsServer.kill('SIGINT');
    ngServe.kill('SIGINT');
  }
}

async function shutdown(exitCode) {
  await cleanup();
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
