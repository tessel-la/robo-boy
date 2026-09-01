import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { applyPanelInstallationPreview, installPanels, previewPanelInstallation } from './install-panels.mjs';

const MAX_REQUEST_BYTES = 256 * 1024;
const PLAN_TTL_MS = 10 * 60 * 1000;
const port = Number(process.env.ROBOBOY_PANEL_MANAGER_PORT || 4100);
const configPath = resolve(process.env.ROBOBOY_PANEL_MANAGER_CONFIG || '/state/panel-sources.json');
const defaultConfigPath = resolve(process.env.ROBOBOY_PANEL_MANAGER_DEFAULT_CONFIG || '/config/panel-sources.json');
const outputPath = resolve(process.env.ROBOBOY_PANEL_MANAGER_OUTPUT || '/panels');
const token = process.env.ROBOBOY_PANEL_MANAGER_TOKEN || '';
const plans = new Map();
let startupError = '';
let operation = Promise.resolve();

const pathExists = async path => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const writeAtomic = async (path, value) => {
  const temporaryPath = `${path}.${createHash('sha256').update(String(Date.now())).digest('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
};

const readConfig = async () => JSON.parse(await readFile(configPath, 'utf8'));

const seedAndInstall = async () => {
  await mkdir(dirname(configPath), { recursive: true });
  if (!(await pathExists(configPath))) {
    const config = JSON.parse(await readFile(defaultConfigPath, 'utf8'));
    const preview = await previewPanelInstallation({
      config: defaultConfigPath,
      configValue: config,
      output: outputPath,
    });
    await applyPanelInstallationPreview(preview, { output: outputPath });
    await writeAtomic(configPath, preview.config);
    return;
  }
  const config = await readConfig();
  await installPanels({ config: configPath, configValue: config, output: outputPath, dryRun: false });
};

const sendJson = (response, status, value) => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const authorized = request => {
  if (!token) return false;
  const supplied = request.headers.authorization;
  if (typeof supplied !== 'string' || !supplied.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(supplied.slice(7));
  const expected = Buffer.from(token);
  return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
};

const readBody = request =>
  new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        rejectBody(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', rejectBody);
  });

const serialized = task => {
  const next = operation.then(task, task);
  operation = next.catch(() => undefined);
  return next;
};

const prunePlans = () => {
  const cutoff = Date.now() - PLAN_TTL_MS;
  for (const [planId, plan] of plans) if (plan.createdAt < cutoff) plans.delete(planId);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://panel-manager');
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/panels/status') {
    sendJson(response, 200, {
      available: true,
      authenticationRequired: true,
      configured: Boolean(token),
    });
    return;
  }
  if (!url.pathname.startsWith('/api/panels/')) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  if (!token) {
    sendJson(response, 503, { error: 'Panel management is disabled until ROBOBOY_PANEL_MANAGER_TOKEN is configured.' });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { error: 'A valid panel manager token is required.' });
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/panels/config') {
      sendJson(response, 200, { config: await readConfig(), startupError: startupError || undefined });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/panels/preview') {
      const body = await readBody(request);
      const config = body?.config;
      const preview = await serialized(() =>
        previewPanelInstallation({ config: configPath, configValue: config, output: outputPath })
      );
      prunePlans();
      plans.set(preview.planId, { config, createdAt: Date.now() });
      sendJson(response, 200, {
        planId: preview.planId,
        expiresInSeconds: PLAN_TTL_MS / 1000,
        panels: preview.registry.panels,
        changes: preview.changes,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/panels/apply') {
      const body = await readBody(request);
      const planId = body?.planId;
      prunePlans();
      const stored = typeof planId === 'string' ? plans.get(planId) : undefined;
      if (!stored) {
        sendJson(response, 409, { error: 'This preview expired. Preview the changes again before applying.' });
        return;
      }
      const registry = await serialized(async () => {
        const current = await previewPanelInstallation({
          config: configPath,
          configValue: stored.config,
          output: outputPath,
        });
        if (current.planId !== planId) {
          throw Object.assign(new Error('Panel sources changed after preview. Preview the changes again.'), {
            statusCode: 409,
          });
        }
        const installed = await applyPanelInstallationPreview(current, { output: outputPath });
        await writeAtomic(configPath, stored.config);
        plans.clear();
        startupError = '';
        return installed;
      });
      sendJson(response, 200, { installed: registry.panels.length, registry });
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const status = Number(error?.statusCode) || 400;
    sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
});

try {
  await seedAndInstall();
} catch (error) {
  startupError = error instanceof Error ? error.message : String(error);
  console.error(`[panel-manager] initial installation failed: ${startupError}`);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`[panel-manager] listening on port ${port}; UI management ${token ? 'enabled' : 'disabled'}`);
});
