import { spawn } from 'node:child_process';
import { fixture } from '../infra/enterprise/test/provider.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = 'http://127.0.0.1:5280';
const sessionDirectory = mkdtempSync(join(tmpdir(), 'roboboy-enterprise-e2e-'));
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--config',
    'config/vite.config.ts',
    '--host',
    '127.0.0.1',
    '--port',
    '5281',
    '--strictPort',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_PWA_DEV: 'false',
      VITE_ENTERPRISE_LOGIN: 'true',
      VITE_ENTERPRISE_SERVER_URL: origin,
      ROBOBOY_BRANDING_FILE: 'config/branding.example.json',
    },
  }
);
const app = await fixture({
  port: 5280,
  backendPort: 5282,
  publicOrigin: origin,
  frontend: 'http://127.0.0.1:5281',
  developmentAssets: true,
  nativeOrigins: [origin, 'app://robo-boy', 'tauri://localhost'],
  sessionFile: join(sessionDirectory, 'sessions.json'),
});
let stopping;
const stop = () => stopping ??= app.close().then(() => {
  rmSync(sessionDirectory, { recursive: true, force: true });
  process.exit(0);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    vite.kill('SIGTERM');
    void stop();
  });
vite.once('exit', () => void stop());
console.log('Isolated enterprise test deployment ready on ' + origin);
