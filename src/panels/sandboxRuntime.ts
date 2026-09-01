export const panelSandboxBootstrap = (parentOrigin: string) => {
  const createSecureId = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  };
  const sandboxSessionId = createSecureId();
  let port: MessagePort | null = null;
  let instance: {
    mount(container: HTMLElement): void | Promise<void>;
    setActive?(isActive: boolean): void | Promise<void>;
    unmount(): void | Promise<void>;
  } | null = null;
  let connectionSnapshot = { status: 'disconnected', generation: 0 };
  let viewportSnapshot = {
    width: 0,
    height: 0,
    isIntersecting: false,
    isDocumentVisible: true,
    isActive: false,
  };
  let themeSnapshot = { colorScheme: 'light' as 'light' | 'dark', tokens: {} as Record<string, string> };
  const connectionListeners = new Set<(snapshot: typeof connectionSnapshot) => void>();
  const viewportListeners = new Set<(snapshot: typeof viewportSnapshot) => void>();
  const themeListeners = new Set<(snapshot: typeof themeSnapshot) => void>();
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; abort?: () => void }
  >();
  const rosListeners = new Map<string, (message: Record<string, unknown>) => void>();
  let requestSequence = 0;

  const post = (message: unknown) => port?.postMessage(message);
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const detailString = (detail: unknown) => {
    if (detail instanceof Error) return detail.stack || detail.message;
    if (typeof detail === 'string') return detail;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  };
  const rpc = (method: string, params?: unknown, signal?: AbortSignal) => {
    const requestId = String(++requestSequence);
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The request was aborted.', 'AbortError'));
        return;
      }
      const abort = signal
        ? () => {
            pending.delete(requestId);
            post({ type: 'cancel', requestId });
            reject(new DOMException('The request was aborted.', 'AbortError'));
          }
        : undefined;
      signal?.addEventListener('abort', abort!, { once: true });
      pending.set(requestId, {
        resolve: value => {
          signal?.removeEventListener('abort', abort!);
          resolve(value);
        },
        reject: error => {
          signal?.removeEventListener('abort', abort!);
          reject(error);
        },
      });
      post({ type: 'request', requestId, method, params });
    });
  };
  const jsonSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const applyTheme = (value: any) => {
    const colorScheme = value?.colorScheme === 'dark' ? 'dark' : 'light';
    const tokens = Object.fromEntries(
      Object.entries(value?.tokens || {}).filter(
        ([name, tokenValue]) =>
          /^--[a-z0-9-]{1,80}$/i.test(name) && typeof tokenValue === 'string' && tokenValue.length <= 512
      )
    ) as Record<string, string>;
    themeSnapshot = { colorScheme, tokens };
    document.documentElement.style.colorScheme = colorScheme;
    Object.entries(tokens).forEach(([name, tokenValue]) =>
      document.documentElement.style.setProperty(name, tokenValue)
    );
    themeListeners.forEach(listener => listener(themeSnapshot));
  };

  const loadBundleModule = (bundleSource: string): Promise<any> => {
    const bridgeKey = `__roboboyPanelModuleBridge_${createSecureId()}`;
    const bundleUrl = URL.createObjectURL(new Blob([bundleSource], { type: 'text/javascript' }));
    const loaderSource = `
      const bridge = globalThis[${JSON.stringify(bridgeKey)}];
      import(${JSON.stringify(bundleUrl)}).then(
        module => bridge.resolve(module),
        error => bridge.reject(error)
      );
    `;
    const loaderUrl = URL.createObjectURL(new Blob([loaderSource], { type: 'text/javascript' }));

    return new Promise((resolve, reject) => {
      const sandboxGlobal = globalThis as typeof globalThis & Record<string, unknown>;
      const loader = document.createElement('script');
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        loader.remove();
        delete sandboxGlobal[bridgeKey];
        URL.revokeObjectURL(loaderUrl);
        URL.revokeObjectURL(bundleUrl);
        callback();
      };
      sandboxGlobal[bridgeKey] = Object.freeze({
        resolve: (module: unknown) => finish(() => resolve(module)),
        reject: (error: unknown) => finish(() => reject(error)),
      });
      loader.type = 'module';
      loader.src = loaderUrl;
      loader.addEventListener('error', () => finish(() => reject(new Error('Panel bundle module loader failed.'))), {
        once: true,
      });
      document.head.append(loader);
    });
  };

  const initialize = async (value: any) => {
    connectionSnapshot = value.connection;
    viewportSnapshot = value.viewport;
    applyTheme(value.theme);
    let storageValues = structuredClone(value.storage.values);
    const storage = value.storage.enabled
      ? {
          schemaVersion: value.storage.schemaVersion,
          quotaBytes: value.storage.quotaBytes,
          get: (key: string, fallback: unknown) =>
            Object.prototype.hasOwnProperty.call(storageValues, key) ? structuredClone(storageValues[key]) : fallback,
          set: (key: string, nextValue: unknown) => {
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(key)) throw new Error('Invalid panel storage key.');
            const next = { ...storageValues, [key]: structuredClone(nextValue) };
            if (jsonSize(next) > value.storage.quotaBytes) throw new Error('Panel storage quota exceeded.');
            storageValues = next;
            post({ type: 'storage', values: next });
          },
          remove: (key: string) => {
            const next = { ...storageValues };
            delete next[key];
            storageValues = next;
            post({ type: 'storage', values: next });
          },
          sizeBytes: () => jsonSize(storageValues),
        }
      : null;
    const logger = Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map(level => [
        level,
        (message: string, ...details: unknown[]) =>
          post({ type: 'log', level, message: String(message), details: details.map(detailString) }),
      ])
    );
    const ros = value.capabilities.includes('ros')
      ? {
          getTopics: () => rpc('ros.getTopics'),
          selectTopic: (options?: unknown) => rpc('ros.selectTopic', options),
          subscribe: async (options: unknown, listener: (message: Record<string, unknown>) => void) => {
            const result = (await rpc('ros.subscribe', options)) as { subscriptionId: string };
            rosListeners.set(result.subscriptionId, listener);
            return {
              unsubscribe: async () => {
                rosListeners.delete(result.subscriptionId);
                await rpc('ros.unsubscribe', { subscriptionId: result.subscriptionId });
              },
            };
          },
          publish: async (options: unknown) => {
            await rpc('ros.publish', options);
          },
          callService: (options: unknown) => rpc('ros.callService', options),
        }
      : null;
    const network = value.capabilities.includes('network')
      ? {
          endpoints: Object.freeze({ ...value.endpoints }),
          fetch: async (url: string, request: any = {}) => {
            const response = (await rpc(
              'network.fetch',
              {
                url,
                method: request.method,
                headers: request.headers,
                body: request.body,
                cache: request.cache,
              },
              request.signal
            )) as { status: number; statusText: string; headers: Record<string, string>; body: string };
            return {
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              statusText: response.statusText,
              headers: Object.freeze({
                get: (name: string) => response.headers[name.toLowerCase()] ?? null,
              }),
              text: async () => response.body,
              json: async () => JSON.parse(response.body),
            };
          },
        }
      : null;
    const context = Object.freeze({
      panelId: value.panelId,
      instanceId: value.instanceId,
      capabilities: Object.freeze([...value.capabilities]),
      ros,
      storage,
      network,
      runtime: Object.freeze({ ...value.runtime }),
      connection: Object.freeze({
        getSnapshot: () => connectionSnapshot,
        subscribe: (listener: (snapshot: typeof connectionSnapshot) => void) => {
          connectionListeners.add(listener);
          return () => connectionListeners.delete(listener);
        },
      }),
      viewport: Object.freeze({
        getSnapshot: () => viewportSnapshot,
        subscribe: (listener: (snapshot: typeof viewportSnapshot) => void) => {
          viewportListeners.add(listener);
          return () => viewportListeners.delete(listener);
        },
        requestFullscreen: async () => {
          await rpc('viewport.requestFullscreen');
        },
      }),
      theme: Object.freeze({
        getSnapshot: () => themeSnapshot,
        subscribe: (listener: (snapshot: typeof themeSnapshot) => void) => {
          themeListeners.add(listener);
          return () => themeListeners.delete(listener);
        },
      }),
      logger: Object.freeze(logger),
    });

    const module = await loadBundleModule(value.bundleSource);
    const definition = module?.default;
    if (
      !definition ||
      definition.id !== value.panelId ||
      definition.apiVersion !== value.apiVersion ||
      typeof definition.activate !== 'function'
    ) {
      throw new Error('Panel bundle does not export the expected Panel API definition.');
    }
    instance = await definition.activate(context);
    if (!instance || typeof instance.mount !== 'function' || typeof instance.unmount !== 'function') {
      throw new Error('Panel activation must return mount and unmount lifecycle functions.');
    }
    const root = document.getElementById('panel-root');
    if (!root) throw new Error('Panel sandbox root is unavailable.');
    await instance.mount(root);
    await instance.setActive?.(viewportSnapshot.isActive);
    post({ type: 'ready' });
  };

  const dispose = async () => {
    try {
      await instance?.unmount();
    } finally {
      instance = null;
      document.getElementById('panel-root')?.replaceChildren();
      pending.forEach(({ reject }) => reject(new Error('Panel sandbox was disposed.')));
      pending.clear();
      rosListeners.clear();
      themeListeners.clear();
    }
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    if (event.data?.type === 'roboboy-panel-sandbox-probe') {
      window.parent.postMessage({ type: 'roboboy-panel-sandbox-ready', sessionId: sandboxSessionId }, parentOrigin);
      return;
    }
    if (port || event.data?.type !== 'roboboy-panel-port' || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = async portEvent => {
      const message = portEvent.data;
      try {
        if (message.type === 'initialize') await initialize(message.value);
        else if (message.type === 'connection') {
          connectionSnapshot = message.value;
          connectionListeners.forEach(listener => listener(connectionSnapshot));
        } else if (message.type === 'viewport') {
          viewportSnapshot = message.value;
          viewportListeners.forEach(listener => listener(viewportSnapshot));
          await instance?.setActive?.(viewportSnapshot.isActive);
        } else if (message.type === 'theme') {
          applyTheme(message.value);
        } else if (message.type === 'response') {
          const request = pending.get(message.requestId);
          if (!request) return;
          pending.delete(message.requestId);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.value);
        } else if (message.type === 'ros-message') {
          rosListeners.get(message.subscriptionId)?.(message.value);
        } else if (message.type === 'dispose') await dispose();
      } catch (error) {
        post({ type: 'error', message: errorMessage(error) });
      }
    };
    port.start();
  });
  window.addEventListener('error', event => post({ type: 'error', message: event.error?.message || event.message }));
  window.addEventListener('unhandledrejection', event => post({ type: 'error', message: errorMessage(event.reason) }));
};

const escapeHtmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const createPanelSandboxDocument = (parentOrigin: string): string => {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src blob:',
    "connect-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const serializedParentOrigin = JSON.stringify(parentOrigin).replace(/</g, '\\u003c');
  const bootstrap = `(${panelSandboxBootstrap.toString()})(${serializedParentOrigin});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#panel-root{width:100%;height:100%;margin:0;min-width:0;min-height:0;overflow:hidden;color:var(--text-color,#212529);background:var(--background-color,#fff);font-family:var(--font-family-ui,system-ui,sans-serif);color-scheme:light dark}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{border:1px solid var(--border-color,#dee2e6);border-radius:8px;padding:7px 10px;color:var(--button-text-color,#fff);background:var(--primary-color,#32cd32);font-weight:600;cursor:pointer}button:hover{background:var(--primary-hover-color,var(--primary-color,#32cd32))}button:disabled{opacity:.48;cursor:default}input,select,textarea{border:1px solid var(--border-color,#dee2e6);border-radius:8px;padding:7px 9px;color:var(--text-color,#212529);background:var(--background-color,#fff)}:focus-visible{outline:2px solid var(--primary-color,#32cd32);outline-offset:2px}</style></head><body><div id="panel-root"></div><script>${bootstrap}<\/script></body></html>`;
};
