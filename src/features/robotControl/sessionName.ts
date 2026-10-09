import { getDesktopBridge } from '../../runtime/desktopBridge';

const SESSION_NAME_KEY = 'roboboy-control-session-name-v1';

function displayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return (
    value
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, 64) || undefined
  );
}

/** A chosen label wins over the native account name. Browsers have no OS identity API. */
export async function defaultSessionName(): Promise<string | undefined> {
  try {
    const saved = displayName(localStorage.getItem(SESSION_NAME_KEY));
    if (saved) return saved;
  } catch {
    /* Private browser storage may be unavailable. */
  }
  try {
    const desktop = getDesktopBridge();
    if (desktop?.getUsername) return displayName(await desktop.getUsername());
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      return displayName(await invoke('session_username'));
    }
  } catch {
    /* Older native shells keep the gateway's generated label. */
  }
  return undefined;
}

/** Persist only a name confirmed by the gateway. */
export function rememberSessionName(name: string): void {
  try {
    localStorage.setItem(SESSION_NAME_KEY, name);
  } catch {
    /* Display labels remain usable without storage. */
  }
}
