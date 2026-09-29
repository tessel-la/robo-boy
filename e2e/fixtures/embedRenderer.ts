import { getPanelSandboxUrl } from '../../src/panels/panelSandboxUrl';

// Frames the panel sandbox exactly as ExternalPanelHost does, for a connection's robot proxy.
(window as any).openPanelSandbox = (embedBaseUrl: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-downloads allow-forms');
    frame.referrerPolicy = 'no-referrer';
    frame.style.cssText = 'width:800px;height:500px;border:0';
    frame.src = getPanelSandboxUrl(embedBaseUrl);
    frame.onload = () => resolve(frame.src);
    frame.onerror = () => reject(new Error(`Sandbox failed to load: ${frame.src}`));
    document.body.replaceChildren(frame);
  });
