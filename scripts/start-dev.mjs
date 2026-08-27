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

function cleanup() {
  console.log('\n🛑 Stopping servers...');
  if (isWindows) {
    if (obsServer.pid) {
      spawn('taskkill', ['/pid', String(obsServer.pid), '/f', '/t'], { stdio: 'ignore', shell: true });
    }
    if (ngServe.pid) {
      spawn('taskkill', ['/pid', String(ngServe.pid), '/f', '/t'], { stdio: 'ignore', shell: true });
    }
  } else {
    obsServer.kill('SIGINT');
    ngServe.kill('SIGINT');
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
