import { getDesktopBridge } from '../runtime/desktopBridge';
import { embedHostFor, normalizeEmbedBaseUrl, parseEmbedPorts } from '../runtime/embedTarget';

/**
 * The URL a panel sandbox is served from.
 *
 * Beside the app by default, which in a browser is the robot's own proxy. The Electron shell serves
 * the app from its bundle, so a connection with a robot proxy gets its sandbox on that robot's
 * embed host instead, where the panel's same-origin `/<port>/` frames reach the robot: through its
 * proxy, or for `directPorts` straight from the robot's own port.
 */
export const getPanelSandboxUrl = (embedBaseUrl: string, directPorts: number[] = []): string => {
  const bridge = getDesktopBridge();
  const target = bridge?.registerEmbedTarget ? normalizeEmbedBaseUrl(embedBaseUrl) : null;
  if (target) bridge!.registerEmbedTarget!(target, parseEmbedPorts(directPorts));
  const url = target
    ? new URL(`app://${embedHostFor(target)}/panel-sandbox.html`)
    : new URL('panel-sandbox.html', document.baseURI);
  url.searchParams.set('parentOrigin', window.location.origin);
  return url.href;
};
