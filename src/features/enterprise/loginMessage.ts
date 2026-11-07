import type { Branding } from './config';

type Message = Branding['loginSlides'][number];
const fallback = new Map<string, string>();
const keyFor = (scope: string) => `robo-boy-login-message-v1:${scope}`;
const fingerprint = (message: Message) => JSON.stringify([message.title, message.message]);

export function readLoginMessage(scope: string): string | null {
  if (fallback.has(scope)) return fallback.get(scope)!;
  try {
    return localStorage.getItem(keyFor(scope));
  } catch {
    return null;
  }
}

export function rememberLoginMessage(scope: string, message: Message): void {
  const value = fingerprint(message);
  try {
    localStorage.setItem(keyFor(scope), value);
    fallback.delete(scope);
  } catch {
    // A blocked/quota-limited store must not block login or repeat within this app process.
    fallback.set(scope, value);
  }
}

/** Exclude the previous pair when a different message exists; stale stored text never becomes UI. */
export function chooseLoginMessage(messages: readonly Message[], previous: string | null): Message {
  const alternatives = messages.filter(message => fingerprint(message) !== previous);
  const choices = alternatives.length ? alternatives : messages;
  return choices[Math.floor(Math.random() * choices.length)];
}
