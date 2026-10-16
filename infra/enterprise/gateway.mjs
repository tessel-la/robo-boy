/** Optional enterprise boundary. OIDC is delegated to openid-client; robot ownership stays in the ROS gateway. */
import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as oidc from 'openid-client';
import httpProxy from 'http-proxy';
import { WebSocket, WebSocketServer } from 'ws';
import { secureOrigin, loadBranding, enabled } from './config.mjs';

const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
const cookie = (request, name) =>
  request.headers.cookie
    ?.split(';')
    .map(v => v.trim())
    .find(v => v.startsWith(name + '='))
    ?.slice(name.length + 1);
const mediaPath = path => /^\/(video_stream|mesh_resources|recordings)(\/|$)/.test(path);
const publicPath = path =>
  ['/', '/index.html', '/favicon.ico', '/manifest.webmanifest'].includes(path) ||
  /^\/(assets|branding|panels)\//.test(path);

async function jsonBody(request) {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 8192) throw new Error('Request too large');
  }
  return JSON.parse(data || '{}');
}

/** One broker per robot deployment, like the control authority. Restart signs out all sessions. */
export async function createEnterpriseGateway(options) {
  const origin = secureOrigin(options.origin);
  const secure = origin.startsWith('https:');
  const sessionCookie = secure ? '__Host-roboboy_session' : 'roboboy_session';
  const loginCookie = secure ? '__Host-roboboy_login' : 'roboboy_login';
  const nativeOrigins = new Set(
    options.nativeOrigins ?? [
      'app://robo-boy',
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]
  );
  const clock = options.clock ?? Date.now;
  const ttl = options.sessionSeconds ?? 3600;
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86400)
    throw new Error('Session lifetime must be 60–86400 seconds.');
  const upstream = new URL(options.upstream);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.protocol !== 'http:')
    throw new Error('Enterprise upstream must be private loopback HTTP.');
  const brand = options.branding ?? loadBranding();
  if (options.enabled === false) {
    const transport = httpProxy.createProxyServer({ target: upstream.origin, ws: true, changeOrigin: true });
    transport.on('proxyRes', (result, request) => {
      delete result.headers['set-cookie'];
      if (nativeOrigins.has(request.headers.origin)) {
        result.headers['access-control-allow-origin'] = request.headers.origin;
        result.headers['access-control-expose-headers'] = 'Accept-Ranges, Content-Range, ETag, Location, Link';
        result.headers.vary = 'Origin';
      }
    });
    transport.on('error', (_error, _request, response) => {
      response.writeHead?.(502);
      response.end?.('Robot backend unavailable.');
      response.destroy?.();
    });
    const connections = new Set();
    const server = http.createServer((request, response) => {
      if (request.method === 'OPTIONS' && nativeOrigins.has(request.headers.origin)) {
        response.writeHead(204, {
          'Access-Control-Allow-Origin': request.headers.origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          Vary: 'Origin',
        });
        response.end();
        return;
      }
      if (new URL(request.url, origin).pathname.startsWith('/auth/')) {
        response.writeHead(404);
        response.end();
        return;
      }
      delete request.headers.cookie;
      delete request.headers['x-roboboy-session'];
      transport.web(request, response);
    });
    server.on('connection', socket => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });
    server.on('upgrade', (request, socket, head) => {
      delete request.headers.cookie;
      delete request.headers['x-roboboy-session'];
      transport.ws(request, socket, head);
    });
    return {
      server,
      sweep() {},
      close: async () => {
        for (const socket of connections) socket.destroy();
        transport.close();
        await new Promise(resolve => server.close(resolve));
      },
    };
  }
  const config =
    options.oidc ??
    (await oidc.discovery(new URL(options.issuer), options.clientId, options.clientSecret, undefined, { timeout: 10 }));
  oidc.enableNonRepudiationChecks(config);
  const sessions = new Map();
  const media = new Map();
  const transactions = new Map();
  const pending = new Map();
  const sockets = new Set();
  const proxy = httpProxy.createProxyServer({
    target: upstream.origin,
    ws: true,
    xfwd: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  });
  proxy.on('error', (_error, _request, response) => {
    if (response?.writeHead && !response.headersSent) response.writeHead(502);
    response?.end?.('Robot backend unavailable.');
    response?.destroy?.();
  });
  proxy.on('proxyRes', (upstreamResponse, request) => {
    delete upstreamResponse.headers['set-cookie'];
    if (request.enterpriseProtected) upstreamResponse.headers['cache-control'] = 'private, no-store';
    upstreamResponse.headers['referrer-policy'] = 'no-referrer';
    delete upstreamResponse.headers['access-control-allow-origin'];
    delete upstreamResponse.headers['access-control-allow-credentials'];
    if (nativeOrigins.has(request.headers.origin)) {
      upstreamResponse.headers['access-control-allow-origin'] = request.headers.origin;
      upstreamResponse.headers['access-control-expose-headers'] = 'Accept-Ranges, Content-Range, ETag, Location, Link';
      upstreamResponse.headers.vary = 'Origin';
    }
  });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 10000000, perMessageDeflate: false });
  const setCookie = (name, value, age) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const valid = session => session && session.expires > clock();
  const identify = request => {
    const authorization = request.headers['x-roboboy-session'];
    if (authorization !== undefined)
      return typeof authorization === 'string' && /^[A-Za-z0-9_-]{43}$/.test(authorization)
        ? sessions.get(hash(authorization))
        : undefined;
    const value = cookie(request, sessionCookie);
    return value ? sessions.get(hash(value)) : undefined;
  };
  const reply = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    response.end(JSON.stringify(body));
  };
  const remove = session => {
    sessions.delete(session.key);
    media.delete(session.media);
    for (const close of session.connections) close();
    session.connections.clear();
  };
  const track = (session, resource) => {
    const close = () => (resource.terminate ? resource.terminate() : resource.destroy());
    session.connections.add(close);
    resource.once('close', () => session.connections.delete(close));
  };
  const sweep = () => {
    for (const session of sessions.values()) if (!valid(session)) remove(session);
    for (const collection of [transactions, pending]) {
      for (const [key, value] of collection)
        if (value.expires <= clock()) {
          if (value.session) remove(value.session);
          collection.delete(key);
        }
    }
  };
  const timer = setInterval(sweep, 1000);
  timer.unref();
  const failHandoff = id => {
    const attempt = pending.get(id);
    if (attempt) attempt.failed = true;
  };

  const server = http.createServer(async (request, response) => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const requestOrigin = request.headers.origin;
    const native = nativeOrigins.has(requestOrigin);
    if (native) {
      response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-RoboBoy-Session');
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    let nativeCallback;
    try {
      sweep();
      const url = new URL(request.url, origin);
      if (
        url.pathname === '/' ||
        url.pathname === '/index.html' ||
        (url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/auth/media/'))
      )
        response.setHeader('X-Frame-Options', 'DENY');
      if (url.origin !== origin || /%(2f|5c|25)|\\/i.test(url.pathname))
        return reply(response, 400, { error: 'Invalid request path.' });
      if (request.method === 'OPTIONS') return reply(response, native || requestOrigin === origin ? 204 : 403, null);
      // Cookie-authenticated mutations require the exact public origin. Native clients use a bearer.
      if (
        !['GET', 'HEAD'].includes(request.method) &&
        !request.headers['x-roboboy-session'] &&
        requestOrigin !== origin &&
        !(native && url.pathname.startsWith('/auth/native/'))
      )
        return reply(response, 403, { error: 'Request origin rejected.' });
      if (url.pathname === '/auth/native/start' && request.method === 'POST') {
        if (!native) return reply(response, 403, { error: 'Native origin required.' });
        if (pending.size >= 128) return reply(response, 429, { error: 'Too many pending sign-ins.' });
        const { challenge } = await jsonBody(request);
        if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge))
          return reply(response, 400, { error: 'Invalid sign-in challenge.' });
        const id = random();
        pending.set(id, { challenge, origin: requestOrigin, expires: clock() + 300000 });
        return reply(response, 200, { id, browserUrl: `${origin}/auth/login?native=${id}` });
      }
      if (url.pathname === '/auth/native/poll' && request.method === 'POST') {
        const { id, secret } = await jsonBody(request);
        const attempt = pending.get(id);
        if (
          !native ||
          !attempt ||
          attempt.origin !== requestOrigin ||
          typeof secret !== 'string' ||
          secret.length !== 43 ||
          !equal(hash(secret), attempt.challenge)
        )
          return reply(response, 403, { error: 'Sign-in handoff rejected.' });
        if (attempt.failed) {
          pending.delete(id);
          return reply(response, 401, { error: 'Sign-in was cancelled or rejected. Start again.' });
        }
        if (!attempt.session) return reply(response, 202, { pending: true });
        pending.delete(id);
        return reply(response, 200, {
          user: attempt.session.user,
          expires: attempt.session.expires,
          token: attempt.token,
          media: attempt.session.media,
        });
      }
      if (url.pathname === '/auth/login' && request.method === 'GET') {
        if (transactions.size >= 128) return reply(response, 429, { error: 'Too many pending sign-ins.' });
        const nativeId = url.searchParams.get('native');
        if (nativeId && (!pending.has(nativeId) || pending.get(nativeId).started))
          return reply(response, 400, { error: 'Sign-in has expired. Start again in the app.' });
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        const browser = random();
        transactions.set(state, { verifier, nonce, browser: hash(browser), nativeId, expires: clock() + 300000 });
        if (nativeId) pending.get(nativeId).started = true;
        const target = oidc.buildAuthorizationUrl(config, {
          redirect_uri: `${origin}/auth/callback`,
          scope: 'openid profile email',
          prompt: 'select_account',
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
          nonce,
        });
        response.writeHead(302, {
          Location: target.href,
          'Set-Cookie': setCookie(loginCookie, browser, 300),
          'Cache-Control': 'no-store',
        });
        return response.end();
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state');
        const attempt = transactions.get(state);
        nativeCallback = attempt?.nativeId;
        transactions.delete(state);
        if (!attempt || !equal(hash(cookie(request, loginCookie) ?? ''), attempt.browser)) {
          failHandoff(nativeCallback);
          return reply(response, 400, { error: 'Sign-in could not be verified. Start again.' });
        }
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          pkceCodeVerifier: attempt.verifier,
          expectedState: state,
          expectedNonce: attempt.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (
          !claims?.sub ||
          !Number.isFinite(claims.exp) ||
          (options.requiredGroup && (!Array.isArray(claims.groups) || !claims.groups.includes(options.requiredGroup)))
        ) {
          failHandoff(nativeCallback);
          return reply(response, 403, { error: 'Your account is not assigned access to this deployment.' });
        }
        if (sessions.size >= 1024) {
          failHandoff(nativeCallback);
          return reply(response, 503, { error: 'Session capacity reached. Try again later.' });
        }
        const token = random();
        const session = {
          key: hash(token),
          media: random(),
          user: { id: claims.sub, name: String(claims.name || claims.preferred_username || claims.sub).slice(0, 128) },
          expires: Math.min(claims.exp * 1000, clock() + ttl * 1000),
          connections: new Set(),
        };
        if (!valid(session))
          return reply(response, 401, { error: 'The identity provider returned an expired sign-in.' });
        if (attempt.nativeId) {
          const handoff = pending.get(attempt.nativeId);
          if (!handoff || handoff.session) return reply(response, 400, { error: 'Sign-in handoff expired.' });
          handoff.session = session;
          handoff.token = token;
        } else {
          const previous = identify(request);
          if (previous) remove(previous);
        }
        sessions.set(session.key, session);
        media.set(session.media, session);
        if (attempt.nativeId) {
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Set-Cookie': setCookie(loginCookie, '', 0),
            'Content-Security-Policy':
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          });
          return response.end(
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(brand.name)}</title><main style="font:18px system-ui;max-width:35rem;margin:15vh auto;padding:24px"><h1>Sign-in complete</h1><p>Signed in as ${escape(session.user.name)}. Return to ${escape(brand.name)} and confirm this account.</p><p>You can close this browser tab.</p></main>`
          );
        }
        response.writeHead(303, {
          Location: '/',
          'Cache-Control': 'no-store',
          'Set-Cookie': [setCookie(sessionCookie, token, ttl), setCookie(loginCookie, '', 0)],
        });
        return response.end();
      }
      const session = identify(request);
      if (url.pathname === '/auth/session' && request.method === 'GET')
        return reply(
          response,
          valid(session) ? 200 : 401,
          valid(session) ? { user: session.user, expires: session.expires } : { error: 'Sign in to continue.' }
        );
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        if (session) remove(session);
        return reply(response, 200, {}, { 'Set-Cookie': setCookie(sessionCookie, '', 0) });
      }
      if (url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/auth/media/'))
        return reply(response, 404, { error: 'Unknown authentication endpoint.' });
      let authorization = session;
      const mediaRequest = /^\/auth\/media\/([A-Za-z0-9_-]{43})(\/.*)$/.exec(url.pathname);
      if (mediaRequest) {
        authorization = media.get(mediaRequest[1]);
        if (!['GET', 'HEAD'].includes(request.method) || !mediaPath(mediaRequest[2]))
          return reply(response, 403, { error: 'This credential only allows robot media reads.' });
        url.pathname = mediaRequest[2];
      }
      const developmentAsset =
        options.developmentAssets &&
        (/^\/(src|node_modules|@id)\//.test(url.pathname) ||
          ['/@vite/client', '/@react-refresh', '/package.json'].includes(url.pathname));
      if (
        !valid(authorization) &&
        !(request.method === 'GET' && !mediaRequest && (publicPath(url.pathname) || developmentAsset))
      )
        return reply(response, 401, { error: 'Sign in to continue.' });
      request.url = url.pathname + url.search;
      // Enterprise credentials never reach backends. Feature-owned Authorization headers
      // (Panel Manager admin token, media-gateway credentials) remain independent.
      delete request.headers.cookie;
      for (const key of Object.keys(request.headers))
        if (key.startsWith('x-auth-') || key.startsWith('x-forwarded-') || key.startsWith('x-roboboy-'))
          delete request.headers[key];
      if (valid(authorization)) {
        request.enterpriseProtected = true;
        response.setHeader('Cache-Control', 'private, no-store');
        track(authorization, response);
      }
      proxy.web(request, response);
    } catch {
      failHandoff(nativeCallback);
      // Provider errors can contain codes and credentials. Never return or log their raw text.
      if (!response.headersSent)
        reply(response, 400, { error: 'Sign-in or request failed. Start again or contact your administrator.' });
      else response.destroy();
    }
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, origin);
    if (
      url.pathname !== '/websocket' ||
      sockets.size >= 1024 ||
      url.search ||
      (request.headers.origin && request.headers.origin !== origin && !nativeOrigins.has(request.headers.origin))
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wsServer.handleUpgrade(request, socket, head, client => {
      sockets.add(client);
      client.once('close', () => sockets.delete(client));
      let upstreamSocket;
      let activeSession;
      let authorized = false;
      const queued = [];
      let queuedBytes = 0;
      const deadline = setTimeout(() => client.close(1008, 'Sign-in required'), 10000);
      const connect = session => {
        if (!valid(session)) return client.close(1008, 'Sign-in required');
        authorized = true;
        activeSession = session;
        clearTimeout(deadline);
        track(session, client);
        upstreamSocket = new WebSocket(new URL('/websocket', upstream).href.replace('http:', 'ws:'), {
          maxPayload: 10000000,
        });
        upstreamSocket.on('open', () => {
          if (!valid(session) || client.readyState !== WebSocket.OPEN) return upstreamSocket.close();
          for (const [data, binary] of queued) upstreamSocket.send(data, { binary });
          queued.length = 0;
        });
        upstreamSocket.on('message', (data, binary) => {
          if (!valid(session) || client.bufferedAmount > 20000000) return client.terminate();
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
        });
        upstreamSocket.on('error', () => client.close(1011, 'Robot backend unavailable'));
        upstreamSocket.on('close', () => client.close(1001, 'Robot backend disconnected'));
      };
      client.on('message', (data, binary) => {
        if (!authorized) {
          if (binary || data.length > 4096) return client.close(1009, 'Authentication frame rejected');
          try {
            const message = JSON.parse(data.toString());
            const session =
              message.op === 'roboboy_auth' && typeof message.token === 'string' && message.token.length === 43
                ? sessions.get(hash(message.token))
                : undefined;
            if (!valid(session)) return client.close(1008, 'Sign-in required');
            return connect(session);
          } catch {
            return client.close(1008, 'Sign-in required');
          }
        }
        if (!valid(activeSession) || upstreamSocket?.bufferedAmount > 20000000) return client.terminate();
        if (upstreamSocket?.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary });
        else {
          queuedBytes += data.length;
          if (queuedBytes > 1000000) return client.close(1009, 'Connection queue full');
          queued.push([data, binary]);
        }
      });
      client.once('close', () => {
        clearTimeout(deadline);
        upstreamSocket?.close();
      });
      client.on('error', () => client.close());
      const session = identify(request);
      if (valid(session)) connect(session);
    });
  });
  return {
    server,
    sweep,
    close: async () => {
      clearInterval(timer);
      for (const session of sessions.values()) remove(session);
      for (const socket of sockets) socket.terminate();
      wsServer.close();
      proxy.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const required = key => {
      if (!process.env[key]) throw new Error(`Missing ${key}`);
      return process.env[key];
    };
    const authentication = enabled(process.env.ROBOBOY_ENTERPRISE_LOGIN ?? 'true');
    const secret = authentication ? readFileSync(required('ROBOBOY_OIDC_CLIENT_SECRET_FILE'), 'utf8').trim() : '';
    if (authentication && !secret) throw new Error('Empty client secret');
    const gateway = await createEnterpriseGateway({
      origin: required('ROBOBOY_ENTERPRISE_ORIGIN'),
      upstream: process.env.ROBOBOY_ENTERPRISE_UPSTREAM || 'http://127.0.0.1:4181',
      enabled: authentication,
      issuer: authentication ? required('ROBOBOY_OIDC_ISSUER') : '',
      clientId: authentication ? required('ROBOBOY_OIDC_CLIENT_ID') : '',
      clientSecret: secret,
      requiredGroup: process.env.ROBOBOY_OIDC_REQUIRED_GROUP || '',
      sessionSeconds: Number(process.env.ROBOBOY_AUTH_SESSION_SECONDS || '3600'),
      branding: loadBranding(process.env.ROBOBOY_BRANDING_FILE),
      ...(process.env.ROBOBOY_AUTH_NATIVE_ORIGINS
        ? {
            nativeOrigins: process.env.ROBOBOY_AUTH_NATIVE_ORIGINS.split(',')
              .map(value => value.trim())
              .filter(Boolean),
          }
        : {}),
    });
    gateway.server.listen(4180, '127.0.0.1');
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => void gateway.close().then(() => process.exit(0)));
    console.log(
      authentication
        ? 'Enterprise authentication gateway started on loopback.'
        : 'Enterprise gateway started with login explicitly disabled.'
    );
  } catch {
    console.error(
      'Enterprise authentication could not start. Check the issuer, client registration, secret file and deployment configuration.'
    );
    process.exitCode = 1;
  }
}
