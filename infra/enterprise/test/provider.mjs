/** Isolated OIDC issuer and robot HTTP/WS fixture. No connection to a real identity provider or robot. */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { WebSocketServer } from 'ws';
import * as oidc from 'openid-client';
import httpProxy from 'http-proxy';
import { createEnterpriseGateway } from '../gateway.mjs';

export async function fixture({
  publicOrigin,
  upstream,
  frontend,
  developmentAssets = false,
  port = 0,
  nativeOrigins,
  branding,
  robots,
  requiredGroup = '',
  sessionSeconds = 3600,
} = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const received = [];
  let overrides = {};
  let invalidSignature = false;
  const provider = http.createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === '/authorize') {
      const code = randomBytes(16).toString('hex');
      codes.set(code, {
        nonce: url.searchParams.get('nonce'),
        challenge: url.searchParams.get('code_challenge'),
        overrides,
      });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', url.searchParams.get('state'));
      response.writeHead(302, { Location: callback.href });
      return response.end();
    }
    if (url.pathname === '/jwks') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ keys: [jwk] }));
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const params = new URLSearchParams(body);
      const code = codes.get(params.get('code'));
      codes.delete(params.get('code'));
      if (
        !code ||
        createHash('sha256')
          .update(params.get('code_verifier') ?? '')
          .digest('base64url') !== code.challenge ||
        params.get('client_id') !== 'test-client' ||
        params.get('client_secret') !== 'test-secret'
      ) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        return response.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const claims = {
        iss: issuer,
        aud: 'test-client',
        sub: 'employee-1',
        name: 'Alice Employee',
        nonce: code.nonce,
        groups: ['robot-operators'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...code.overrides,
      };
      let id_token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
      if (invalidSignature) {
        const parts = id_token.split('.');
        parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
        id_token = parts.join('.');
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(
        JSON.stringify({
          id_token,
          access_token: 'provider-token-never-sent-to-client',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      );
    }
    response.writeHead(404);
    response.end();
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const issuer = `http://127.0.0.1:${provider.address().port}`;
  const config = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
      response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['RS256'],
    },
    'test-client',
    'test-secret'
  );
  oidc.allowInsecureRequests(config); // Test issuer is loopback HTTP; production has no insecure-issuer option.

  const frontendProxy = httpProxy.createProxyServer({ target: frontend });
  frontendProxy.on('error', (_error, _request, response) => {
    response.writeHead?.(502);
    response.end?.();
  });
  const backend = http.createServer((request, response) => {
    if (frontend && !/^\/(video_stream|recordings|mesh_resources|api|ollama|webrtc)(\/|$)/.test(request.url))
      return frontendProxy.web(request, response);
    received.push({ url: request.url, headers: request.headers, method: request.method });
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'malicious=backend-cookie; Path=/',
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(JSON.stringify({ path: request.url }));
  });
  const backendWs = new WebSocketServer({ server: backend });
  backendWs.on('connection', socket =>
    socket.on('message', data => {
      received.push(JSON.parse(data.toString()));
      socket.send(data.toString());
    })
  );
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  let now = Date.now();
  const origin = publicOrigin || 'https://robot.example';
  const gateway = await createEnterpriseGateway({
    origin,
    upstream: upstream || `http://127.0.0.1:${backend.address().port}`,
    oidc: config,
    nativeOrigins,
    branding,
    requiredGroup,
    robots,
    sessionSeconds,
    developmentAssets,
    clock: () => now,
  });
  gateway.server.listen(port, '127.0.0.1');
  await once(gateway.server, 'listening');
  const url = `http://127.0.0.1:${gateway.server.address().port}`;
  return {
    ...gateway,
    url,
    origin,
    received,
    provider,
    backend,
    overrideClaims: value => {
      overrides = value;
    },
    invalidateSignature: () => {
      invalidSignature = true;
    },
    advance: milliseconds => {
      now += milliseconds;
      gateway.sweep();
    },
    async login(nativeId) {
      const start = await fetch(`${url}/auth/login${nativeId ? '?native=' + nativeId : ''}`, { redirect: 'manual' });
      const cookie = start.headers.getSetCookie()[0].split(';')[0];
      const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
      const callback = new URL(authorize.headers.get('location'));
      const result = await fetch(url + callback.pathname + callback.search, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      return {
        result,
        cookie: result.headers
          .getSetCookie()
          .find(value => value.startsWith('__Host-roboboy_session='))
          ?.split(';')[0],
        callback,
        browserCookie: cookie,
      };
    },
    async close() {
      await gateway.close();
      for (const socket of backendWs.clients) socket.terminate();
      backendWs.close();
      backend.closeAllConnections();
      provider.closeAllConnections();
      frontendProxy.close();
      await Promise.all([
        new Promise(resolve => backend.close(resolve)),
        new Promise(resolve => provider.close(resolve)),
      ]);
    },
  };
}
