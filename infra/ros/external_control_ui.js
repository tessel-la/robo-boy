'use strict';
let key = new URLSearchParams(location.hash.slice(1)).get('key') || '';
try {
  if (key) sessionStorage.setItem('robot-operator-key', key);
  else key = sessionStorage.getItem('robot-operator-key') || '';
} catch { /* The original link still works when storage is unavailable. */ }
// Keep the key in this tab, out of copied URLs and browser history.
history.replaceState(null, '', location.pathname);
const element = (id) => document.getElementById(id);
let busy = false;
let events = [];
let requestSignature = '';
let generation = 0;

function error(message) {
  element('error').textContent = message;
  element('error').hidden = !message;
}

async function api(path, command) {
  const response = await fetch(path, {
    method: command ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: command ? JSON.stringify(command) : undefined,
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new Error(value?.error || 'Operator access failed. Reopen the link from the robot logs.');
  }
  return response.json();
}

function render(state) {
  element('access').textContent = state.allowControl ? 'Access enabled' : 'Access disabled';
  element('access').className = state.allowControl ? 'enabled' : '';
  element('connection').textContent = state.gatewayReady
    ? 'Gateway connected. Each session needs explicit approval.'
    : 'Gateway updates unavailable. Wait for reconnection before approving.';
  element('owner').textContent = state.gatewayReady ? state.owner || 'No one' : 'Unknown';
  element('enable').disabled = busy || state.allowControl;
  element('disable').disabled = busy || !state.allowControl;
  element('download').disabled = false;
  element('count').textContent = String(state.requests.length);
  const signature = JSON.stringify([state.requests, state.allowControl, state.gatewayReady, busy]);
  if (signature !== requestSignature) {
    requestSignature = signature;
    const root = element('requests');
    root.replaceChildren();
    if (!state.requests.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No pending requests.';
      root.append(empty);
    }
    for (const request of state.requests) {
      const row = document.createElement('div');
      row.className = 'request';
      const name = document.createElement('strong');
      name.textContent = request.label;
      const detail = document.createElement('p');
      detail.className = 'hint';
      detail.textContent = `${request.intent} · ${request.ownerApproved ? 'Owner consent ready' : 'Waiting for owner consent'}${request.decision === true ? ' · Robot approval sent' : request.decision === false ? ' · Denial sent' : ''}`;
      const id = document.createElement('code');
      id.textContent = request.requestId;
      const actions = document.createElement('p');
      actions.className = 'row actions';
      for (const approved of [true, false]) {
        const button = document.createElement('button');
        button.textContent = approved ? 'Approve' : 'Deny';
        button.className = approved ? '' : 'secondary';
        button.disabled = busy || !state.gatewayReady || (approved && (!state.allowControl || request.decision === true));
        button.onclick = () => mutate('/api/decision', { requestId: request.requestId, approve: approved });
        actions.append(button);
      }
      row.append(name, detail, id, actions);
      root.append(row);
    }
  }
  events = state.events;
  element('log').textContent = events.map((event) => `${event.time}  ${event.message}`).join('\n');
}

function unavailable() {
  requestSignature = '';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  element('access').textContent = 'Connection unavailable';
  element('access').className = '';
  element('owner').textContent = 'Unknown';
  element('connection').textContent = 'Robot policy unavailable. Controls resume when the connection returns.';
}

async function refresh() {
  if (busy) return;
  const current = generation;
  try {
    const state = await api('/api/status');
    if (current !== generation || busy) return;
    render(state);
    error('');
  } catch (failure) {
    if (current !== generation || busy) return;
    unavailable();
    error(failure.message);
  }
}

async function mutate(path, command) {
  if (busy) return;
  generation += 1;
  busy = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const state = await api(path, command);
    busy = false;
    render(state);
    error('');
  } catch (failure) {
    busy = false;
    await refresh();
    error(failure.message);
  }
}

element('enable').onclick = () => mutate('/api/access', { allowControl: true });
element('disable').onclick = () => mutate('/api/access', { allowControl: false });
element('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([events.map((event) => `${event.time}  ${event.message}`).join('\n')], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'roboboy-control.log';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
refresh();
setInterval(refresh, 1000);
