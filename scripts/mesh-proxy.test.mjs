import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { cwd: root, timeout: 120000 })).stdout.trim();

it('preserves remote mesh settings and the enterprise same-host deployment', async () => {
  const config = async files =>
    JSON.parse(
      (
        await execute(
          'docker',
          ['compose', '--env-file', '/dev/null', ...files.flatMap(file => ['-f', file]), 'config', '--format', 'json'],
          {
            cwd: root,
            env: {
              ...process.env,
              BACKEND_HOST: 'robot.example',
              MESH_RESOURCES_PORT: '18000',
              MESH_RESOURCES_UPSTREAM: '',
              ROBOBOY_ENTERPRISE_ORIGIN: 'https://robot.example',
            },
          }
        )
      ).stdout
    );
  for (const files of [['docker-compose.yml'], ['docker-compose.yml', 'infra/compose/enterprise.yml']]) {
    const { services } = await config(files);
    assert.equal(services['mesh-relay'].network_mode, 'host');
    assert.equal(services['mesh-relay'].environment.BACKEND_HOST, files.length === 1 ? 'robot.example' : '127.0.0.1');
    assert.equal(services['mesh-relay'].environment.MESH_RESOURCES_PORT, '18000');
    assert.equal(services.caddy.environment.MESH_RESOURCES_UPSTREAM, 'unix//run/mesh-relay/mesh.sock');
    assert.ok(services.caddy.depends_on['mesh-relay']);
    assert.ok(services.caddy.volumes.some(volume => volume.target === '/run/mesh-relay'));
    assert.equal(services['ros-stack'].depends_on?.['mesh-relay'], undefined);
  }
});

it(
  'serves loopback and remote-IP meshes through the real bridge proxy and Unix relay',
  { timeout: 120000 },
  async t => {
    // Docker packaged with Snap cannot bind-mount the caller's private /tmp.
    const cache = path.join(root, '.cache');
    await mkdir(cache, { recursive: true });
    const work = await mkdtemp(path.join(cache, 'mesh-proxy-'));
    const id = randomUUID().slice(0, 8);
    const relay = `roboboy-mesh-relay-test-${id}`;
    const proxy = `roboboy-mesh-proxy-test-${id}`;
    const remote = `roboboy-mesh-backend-test-${id}`;
    const requests = [];
    const model = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    const backend = createServer((req, res) => {
      requests.push({ path: req.url, method: req.method, headers: req.headers });
      if (req.url !== '/meshes/arm.obj?version=1') {
        res.writeHead(404).end();
        return;
      }
      if (req.headers['if-none-match'] === '"mesh-1"') {
        res.writeHead(304, { ETag: '"mesh-1"' }).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(model),
        ETag: '"mesh-1"',
      });
      res.end(req.method === 'HEAD' ? undefined : model);
    });
    t.after(async () => {
      await Promise.allSettled([docker('rm', '-f', proxy), docker('rm', '-f', relay), docker('rm', '-f', remote)]);
      backend.closeAllConnections();
      await new Promise(resolve => backend.close(resolve));
      await rm(work, { recursive: true, force: true });
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const port = backend.address().port;
    const config = path.join(work, 'Caddyfile');
    await writeFile(
      config,
      `{
    admin off
    auto_https off
  }
  import /etc/caddy/Routes.caddy
  :80 {
    import roboboy_routes
  }\n`
    );
    const startRelay = (host, meshPort) =>
      docker(
        'run',
        '-d',
        '--name',
        relay,
        '--network',
        'host',
        '--add-host',
        'host.docker.internal:127.0.0.1',
        '-e',
        `BACKEND_HOST=${host}`,
        '-e',
        `MESH_RESOURCES_PORT=${meshPort}`,
        '-v',
        `${root}/infra/caddy/MeshRelay.Caddyfile:/etc/caddy/Caddyfile:ro`,
        '-v',
        `${work}:/run/mesh-relay`,
        'caddy:latest'
      );
    await startRelay('host.docker.internal', port);
    await docker(
      'run',
      '-d',
      '--name',
      proxy,
      '-p',
      '127.0.0.1::80',
      '--add-host',
      'host.docker.internal:host-gateway',
      '-v',
      `${config}:/etc/caddy/Caddyfile:ro`,
      '-v',
      `${root}/infra/caddy/Routes.caddy:/etc/caddy/Routes.caddy:ro`,
      '-v',
      `${work}:/run/mesh-relay:ro`,
      'caddy:latest'
    );
    const address = await docker('port', proxy, '80/tcp');
    const url = `http://${address}/mesh_resources/meshes/arm.obj?version=1`;
    const loadMesh = async () => {
      let response;
      for (let attempt = 0; attempt < 100; attempt++) {
        response = await fetch(url).catch(() => undefined);
        if (response?.status === 200) break;
        await response?.body?.cancel();
        await setTimeout(100);
      }
      assert.equal(response?.status, 200, await docker('logs', relay));
      return response;
    };
    const response = await loadMesh();
    assert.equal(await response.text(), model);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(response.headers.get('etag'), '"mesh-1"');
    // Reproduce the old topology: this same bridge container cannot reach a loopback listener.
    await assert.rejects(
      docker(
        'exec',
        proxy,
        'wget',
        '-q',
        '-O',
        '-',
        '-T',
        '2',
        `http://host.docker.internal:${port}/meshes/arm.obj?version=1`
      )
    );

    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(model)));
    assert.equal(await head.text(), '');
    assert.equal((await fetch(url, { headers: { 'If-None-Match': '"mesh-1"' } })).status, 304);
    assert.equal((await fetch(`http://${address}/mesh_resources/missing.obj`)).status, 404);
    const privateRead = await fetch(url, { headers: { Cookie: 'session=test', Authorization: 'Bearer test' } });
    await privateRead.text();
    assert.equal(requests.at(-1).headers.cookie, undefined);
    assert.equal(requests.at(-1).headers.authorization, undefined);
    const count = requests.length;
    for (const method of ['POST', 'DELETE']) assert.equal((await fetch(url, { method })).status, 405);
    assert.equal(requests.length, count, 'write methods must never reach the asset server');
    await docker('stop', '-t', '1', relay);
    assert.equal((await fetch(url)).status, 502, 'unavailable assets remain a proxy error, not frontend HTML');

    // A separate network namespace stands in for a robot on a non-loopback IP and custom port.
    await mkdir(path.join(work, 'meshes'));
    await writeFile(path.join(work, 'meshes/arm.obj'), model);
    await docker(
      'run',
      '-d',
      '--name',
      remote,
      '-v',
      `${work}:/assets:ro`,
      'caddy:latest',
      'caddy',
      'file-server',
      '--root',
      '/assets',
      '--listen',
      ':18080'
    );
    const remoteIp = await docker(
      'inspect',
      '--format',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      remote
    );
    assert.ok(remoteIp && !remoteIp.startsWith('127.'));
    await docker('rm', relay);
    await startRelay(remoteIp, 18080);
    assert.equal(await (await loadMesh()).text(), model, 'remote BACKEND_HOST must not be rewritten to loopback');
  }
);
