import { spawn } from 'node:child_process';
import { fixture } from '../infra/enterprise/test/provider.mjs';

const origin = 'http://127.0.0.1:5280';
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
  publicOrigin: origin,
  frontend: 'http://127.0.0.1:5281',
  developmentAssets: true,
  nativeOrigins: [origin, 'app://robo-boy', 'tauri://localhost'],
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    vite.kill('SIGTERM');
    void app.close().then(() => process.exit(0));
  });
vite.once('exit', () => void app.close().then(() => process.exit(0)));
console.log('Isolated enterprise test deployment ready on ' + origin);
