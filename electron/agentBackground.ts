import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, Notification } from 'electron';
import { assertAssistantCaller } from './assistant';

const active = new Set<number>();
const registered = new Set<number>();
let tray: Tray | undefined;
let quitting = false;
export function hasAgentBackground(window: BrowserWindow): boolean {
  return !quitting && active.has(window.webContents.id);
}
export function registerAgentBackground(origin: string): void {
  app.on('before-quit', () => {
    quitting = true;
    active.clear();
  });
  ipcMain.handle('roboboy:agent-background', (event, enabled: unknown) => {
    assertAssistantCaller(event, origin);
    if (typeof enabled !== 'boolean') throw new Error('Invalid background setting.');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (enabled) {
      active.add(event.sender.id);
      if (!registered.has(event.sender.id)) {
        registered.add(event.sender.id);
        event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
          if (mainFrame) active.delete(event.sender.id);
        });
        event.sender.once('destroyed', () => {
          active.delete(event.sender.id);
          registered.delete(event.sender.id);
        });
      }
      if (!tray) {
        const pixels = Buffer.alloc(24 * 24 * 4);
        for (let y = 0; y < 24; y++)
          for (let x = 0; x < 24; x++) {
            const index = (y * 24 + x) * 4;
            const white = (x >= 10 && x <= 13) || (y >= 10 && y <= 13);
            pixels[index] = 255;
            pixels[index + 1] = white ? 255 : 97;
            pixels[index + 2] = white ? 255 : 50;
            pixels[index + 3] = 255;
          }
        tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 24, height: 24 }));
        tray.setToolTip('Robo-Boy — agent monitoring');
        const show = () => {
          for (const candidate of BrowserWindow.getAllWindows()) {
            candidate.show();
            candidate.focus();
          }
        };
        tray.on('click', show);
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: 'Open Robo-Boy', click: show },
            {
              label: 'Stop monitors',
              click: () => {
                active.clear();
                for (const candidate of BrowserWindow.getAllWindows())
                  candidate.webContents.send('roboboy:agent-stop-monitors');
              },
            },
            { label: 'Quit', click: () => app.quit() },
          ])
        );
      }
    } else active.delete(event.sender.id);
  });
  ipcMain.handle('roboboy:agent-notification', (event, title: unknown, body: unknown) => {
    assertAssistantCaller(event, origin);
    if (typeof title !== 'string' || title.length > 120 || typeof body !== 'string' || body.length > 500)
      throw new Error('Invalid notification.');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isFocused() || !Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      window?.show();
      window?.focus();
    });
    notification.show();
  });
}
