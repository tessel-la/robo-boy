import { BrowserWindow, dialog, session, type WebContents } from 'electron';
import { isEmbedHost } from '../src/runtime/embedTarget';

/** Media playback needs no capture grant. Hardware capture always needs the operator's approval. */
export function configurePermissions(rendererUrl: string): void {
  const expected = new URL(rendererUrl);
  const documents = new WeakMap<WebContents, { microphone: boolean; pending?: Promise<boolean> }>();
  const sameOrigin = (value: string | undefined) => {
    try {
      const url = new URL(value ?? '');
      // URL.origin is "null" for custom schemes in Node.
      return url.protocol === expected.protocol && url.host === expected.host;
    } catch {
      return false;
    }
  };
  const trustedWindow = (contents: WebContents | null): contents is WebContents =>
    !!contents && !contents.isDestroyed() && !!BrowserWindow.fromWebContents(contents) && sameOrigin(contents.getURL());
  const fullscreenFrame = (url: string | undefined) => {
    if (sameOrigin(url)) return true;
    try {
      const parsed = new URL(url ?? '');
      return parsed.protocol === 'app:' && isEmbedHost(parsed.hostname);
    } catch {
      return false;
    }
  };
  const panelSandbox = (url: string) => {
    try {
      return fullscreenFrame(url) && new URL(url).pathname === '/panel-sandbox.html';
    } catch {
      return false;
    }
  };
  const documentFor = (contents: WebContents) => {
    let document = documents.get(contents);
    if (!document) {
      document = { microphone: false };
      documents.set(contents, document);
      // Revoke on reload as well as origin changes; late dialog answers cannot grant a new page.
      contents.on('did-start-navigation', details => {
        if (details.isMainFrame) documents.set(contents, { microphone: false });
      });
    }
    return document;
  };

  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!trustedWindow(contents)) return false;
    if (permission === 'fullscreen') return fullscreenFrame(details.requestingUrl);
    return (
      permission === 'media' &&
      details.isMainFrame &&
      sameOrigin(details.requestingUrl) &&
      details.mediaType === 'audio' &&
      documentFor(contents).microphone
    );
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!trustedWindow(contents)) {
      callback(false);
      return;
    }
    if (permission === 'fullscreen') {
      callback(fullscreenFrame(details.requestingUrl));
      return;
    }
    // Chromium also requires the host's manifest-derived camera/microphone delegation for these
    // opaque-origin frames. Do not grant their requests silently or reuse another panel's consent.
    if (
      permission === 'media' &&
      !details.isMainFrame &&
      panelSandbox(details.requestingUrl) &&
      'mediaTypes' in details &&
      details.mediaTypes?.length &&
      details.mediaTypes.every(type => type === 'audio' || type === 'video')
    ) {
      const document = documentFor(contents);
      const hardware = details.mediaTypes.includes('video')
        ? details.mediaTypes.includes('audio')
          ? 'camera and microphone'
          : 'camera'
        : 'microphone';
      void dialog
        .showMessageBox(BrowserWindow.fromWebContents(contents)!, {
          type: 'question',
          title: 'Allow panel capture?',
          message: `Allow an installed Robo-Boy panel to use your ${hardware}?`,
          detail: 'Only allow this for a panel you trust. The panel can send captured media to its approved services.',
          buttons: ['Cancel', 'Allow capture'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .then(
          ({ response }) => callback(response === 1 && trustedWindow(contents) && documents.get(contents) === document),
          () => callback(false)
        );
      return;
    }
    if (
      permission !== 'media' ||
      !details.isMainFrame ||
      !sameOrigin(details.requestingUrl) ||
      !('mediaTypes' in details) ||
      details.mediaTypes?.length !== 1 ||
      details.mediaTypes[0] !== 'audio'
    ) {
      callback(false);
      return;
    }
    const document = documentFor(contents);
    if (document.microphone) {
      callback(true);
      return;
    }
    if (!document.pending) {
      document.pending = dialog
        .showMessageBox(BrowserWindow.fromWebContents(contents)!, {
          type: 'question',
          title: 'Allow microphone access?',
          message: 'Allow Robo-Boy to use your microphone for voice input?',
          detail:
            'Voice recognition or transcription may send audio to the selected speech service or AI provider. Access lasts until this page reloads.',
          buttons: ['Cancel', 'Allow microphone'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .then(
          ({ response }) => {
            const allowed = response === 1 && trustedWindow(contents) && documents.get(contents) === document;
            document.microphone = allowed;
            return allowed;
          },
          () => false
        )
        .finally(() => {
          document.pending = undefined;
        });
    }
    void document.pending.then(callback);
  });
}
