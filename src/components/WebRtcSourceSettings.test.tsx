import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WebRtcSourceSettings from './WebRtcSourceSettings';
const runtime = vi.hoisted(() => ({ webrtcWhepBaseUrl: '/webrtc/', webrtcDiscoveryUrl: '/webrtc/discovery' }));
vi.mock('../runtime/runtimeConfig', () => ({ useRuntimeConfig: () => runtime }));
beforeEach(() => {
  runtime.webrtcWhepBaseUrl = '/webrtc/';
  runtime.webrtcDiscoveryUrl = '/webrtc/discovery';
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it('discovers only ready valid stream paths and maps an explicit selection to standard WHEP', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { name: 'head/camera', ready: true },
              { name: 'idle', ready: false },
              { name: '../bad', ready: true },
            ],
          })
        )
    )
  );
  const change = vi.fn();
  render(<WebRtcSourceSettings value={{}} onChange={change} />);
  await screen.findByRole('option', { name: 'head/camera' });
  expect(screen.queryByRole('option', { name: 'idle' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '../bad' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Available WebRTC streams'), { target: { value: 'head/camera' } });
  expect(change).toHaveBeenCalledWith({ whepUrl: new URL('/webrtc/head/camera/whep', location.href).href });
});
it('keeps manual URL entry available if discovery fails and commits only on blur', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 }))
  );
  const change = vi.fn();
  render(<WebRtcSourceSettings value={{}} onChange={change} />);
  expect(await screen.findByRole('status')).toHaveTextContent('Enter a WHEP URL directly');
  const url = screen.getByLabelText('WHEP URL');
  fireEvent.change(url, { target: { value: ' https://camera.example/whep ' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.blur(url);
  expect(change).toHaveBeenCalledWith({ whepUrl: 'https://camera.example/whep' });
});
it('aborts a pending discovery on unmount', () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    })
  );
  const view = render(<WebRtcSourceSettings value={{}} onChange={vi.fn()} />);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it.each([
  ['https://robot.example:8443/', '/webrtc/', 'https://robot.example:8443/webrtc/head/camera/whep'],
  ['file:///opt/robo-boy/index.html', 'http://10.8.0.22:8889/', 'http://10.8.0.22:8889/head/camera/whep'],
  ['https://operator.example/', 'https://robot.example:9889/', 'https://robot.example:9889/head/camera/whep'],
  [
    'https://fleet.example/',
    'https://fleet.example/robots/duck/webrtc/',
    'https://fleet.example/robots/duck/webrtc/head/camera/whep',
  ],
  ['http://operator.local/', 'http://[fd00::22]:8889/', 'http://[fd00::22]:8889/head/camera/whep'],
])('keeps discovered stream URLs on the configured robot from %s', async (pageUrl, base, expected) => {
  vi.stubGlobal('location', new URL(pageUrl));
  runtime.webrtcWhepBaseUrl = base;
  runtime.webrtcDiscoveryUrl = 'https://gateway.example/discovery';
  const request = vi.fn(async () => new Response(JSON.stringify({ items: [{ name: 'head/camera', ready: true }] })));
  vi.stubGlobal('fetch', request);
  const change = vi.fn();
  render(<WebRtcSourceSettings value={{}} onChange={change} />);
  await screen.findByRole('option', { name: 'head/camera' });
  fireEvent.change(screen.getByLabelText('Available WebRTC streams'), { target: { value: 'head/camera' } });
  expect(request).toHaveBeenCalledWith(runtime.webrtcDiscoveryUrl, expect.objectContaining({ redirect: 'error' }));
  expect(change).toHaveBeenCalledWith({ whepUrl: expected });
});
