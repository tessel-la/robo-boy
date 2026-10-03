import { app, ipcMain, shell, type WebContents } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Updates for the packaged shell: the Linux .deb and the Apple Silicon Mac app.
 *
 * Everything that has to be trusted happens here rather than in the page. Neither the release
 * the page saw nor a checksum it passes is trusted. Node's fetch keeps its own certificate checks,
 * independent of Chromium's exceptions for local robots: the release is looked up again here,
 * the installer is fetched only from GitHub's hosts, checked against the SHA-256 GitHub publishes,
 * and installed only from the path this module wrote.
 */

const REPOSITORY = 'tessel-la/robo-boy';
const TAG = /^robo-boy-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** What an Electron install can update itself from: its own package, by system and architecture. */
const INSTALLERS = new Set(['Robo-Boy-linux-amd64-electron.deb', 'Robo-Boy-linux-arm64-electron.deb', 'Robo-Boy-macos-arm64-electron.dmg']);
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_SIZE = 1024 * 1024 * 1024;
const HEADERS = { 'User-Agent': 'Robo-Boy-updater', Accept: 'application/vnd.github+json' };

let controller: AbortController | undefined;
/** The installer this module downloaded and checked; the only file it will install. */
let verified: string | undefined;

const run = (command: string, args: string[], timeout = 5000) =>
  new Promise<boolean>(resolve => execFile(command, args, { timeout }, error => resolve(!error)));

/** The .app bundle this copy runs from, or undefined when it is not running from one. */
const macBundle = () => {
  const end = process.execPath.indexOf('.app/Contents/MacOS/');
  return end < 0 ? undefined : process.execPath.slice(0, end + '.app'.length);
};

/**
 * Only a packaged copy can replace itself: on Linux one installed from its .deb, on a Mac one running
 * from its app bundle. A development or unpacked build cannot.
 */
const target = async () => {
  if (!app.isPackaged) return null;
  const arch = process.arch === 'arm64' ? ('arm64' as const) : ('x64' as const);
  if (process.platform === 'darwin') return macBundle() ? { shell: 'electron' as const, os: 'macos' as const, arch, package: 'dmg' as const } : null;
  if (process.platform !== 'linux') return null;
  if (!(await run('dpkg-query', ['-S', process.execPath]))) return null;
  return { shell: 'electron' as const, os: 'linux' as const, arch, package: 'deb' as const };
};

interface Asset { url: string; size: number; sha256: string }

async function lookUp(tag: string, name: string, signal: AbortSignal): Promise<Asset> {
  if (!TAG.test(tag) || !INSTALLERS.has(name)) throw new Error('That is not a Robo-Boy installer.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`, { headers: HEADERS, signal });
  if (!response.ok) throw new Error(`GitHub did not describe release ${tag} (HTTP ${response.status}).`);
  const release = (await response.json()) as { assets?: { name?: string; browser_download_url?: string; size?: number; digest?: string }[] };
  const asset = release.assets?.find(candidate => candidate.name === name);
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '')?.[1];
  const url = asset?.browser_download_url ?? '';
  if (!asset || !sha256 || !url.startsWith(`https://github.com/${REPOSITORY}/releases/download/${tag}/`)) {
    throw new Error(`Release ${tag} has no checkable ${name}.`);
  }
  if (!asset.size || asset.size > MAX_SIZE) throw new Error(`${name} is not a size Robo-Boy expects.`);
  return { url, size: asset.size, sha256 };
}

async function download(sender: WebContents, tag: string, name: string) {
  controller?.abort();
  const current = (controller = new AbortController());
  verified = undefined;
  const asset = await lookUp(tag, name, current.signal);
  const directory = path.join(app.getPath('temp'), 'robo-boy-update');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);

  const response = await fetch(asset.url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: current.signal });
  const host = URL.canParse(response.url) ? new URL(response.url).hostname : '';
  if (!DOWNLOAD_HOSTS.has(host)) throw new Error('The installer was redirected away from GitHub; nothing was installed.');
  if (!response.ok || !response.body) throw new Error(`GitHub did not send the installer (HTTP ${response.status}).`);

  const hash = createHash('sha256');
  const output = createWriteStream(file, { mode: 0o644 });
  let received = 0;
  let reported = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > asset.size) throw new Error('The installer is larger than GitHub says it is; nothing was installed.');
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise<void>(resolve => output.once('drain', () => resolve()));
      if (Date.now() - reported > 100) { reported = Date.now(); sender.send('roboboy:update-progress', received, asset.size); }
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => (error ? reject(error) : resolve())));
  } catch (error) {
    output.destroy();
    await rm(directory, { recursive: true, force: true });
    throw current.signal.aborted ? new Error('The download was cancelled.') : error;
  }
  sender.send('roboboy:update-progress', received, asset.size);
  if (received !== asset.size || hash.digest('hex') !== asset.sha256) {
    await rm(directory, { recursive: true, force: true });
    throw new Error('The download does not match the release (its checksum differs), so nothing was installed. Try again.');
  }
  verified = file;
}

/**
 * Replaces this app's bundle with the one in the checked disk image, keeping the old bundle until the
 * new one is in place so a failure puts everything back, then opens the new one. As the Tauri app does.
 */
async function installMacBundle(file: string) {
  const bundle = macBundle();
  if (!bundle) throw new Error('Robo-Boy is not running from an app bundle. Open the installer instead.');
  const mount = path.join(path.dirname(file), 'mount');
  await mkdir(mount, { recursive: true });
  if (!(await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file], 60_000))) {
    throw new Error('The disk image could not be opened. Open the installer instead.');
  }
  try {
    const source = (await readdir(mount)).find(entry => entry.endsWith('.app'));
    if (!source) throw new Error('The disk image holds no app.');
    const staged = `${bundle}-update`;
    const previous = `${bundle}-previous`;
    await rm(staged, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
    if (!(await run('ditto', [path.join(mount, source), staged], 300_000))) {
      await rm(staged, { recursive: true, force: true });
      throw new Error('The new version could not be copied next to this one. Open the installer instead.');
    }
    try {
      await rename(bundle, previous);
    } catch {
      await rm(staged, { recursive: true, force: true });
      throw new Error('Robo-Boy could not replace itself here. Open the installer instead.');
    }
    try {
      await rename(staged, bundle);
    } catch {
      await rename(previous, bundle).catch(() => undefined);
      throw new Error('Robo-Boy could not replace itself here. Open the installer instead.');
    }
    await rm(previous, { recursive: true, force: true });
  } finally {
    await run('hdiutil', ['detach', '-quiet', mount], 30_000);
  }
  spawn('open', ['-n', bundle], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
}

/** Installs the checked package (through the system's own password prompt on Linux), then restarts into it. */
async function install() {
  if (!verified) throw new Error('There is no checked installer to install.');
  const file = verified;
  if (process.platform === 'darwin') return installMacBundle(file);
  const code = await new Promise<number | 'missing'>(resolve => {
    const child = spawn('pkexec', ['/usr/bin/apt-get', 'install', '-y', file], { stdio: 'ignore' });
    child.on('error', () => resolve('missing'));
    child.on('exit', status => resolve(status ?? 1));
  });
  if (code === 'missing') throw new Error('This system has no way to ask for administrator rights (pkexec). Open the installer instead.');
  // pkexec answers 126 when the prompt is dismissed and 127 when authentication fails.
  if (code === 126 || code === 127) throw new Error('Installing needs administrator approval, and it was not given.');
  if (code !== 0) throw new Error(`The package manager could not install the update (exit ${code}). Open the installer instead.`);
  app.relaunch();
  app.exit(0);
}

export function registerUpdater(): void {
  ipcMain.handle('roboboy:update-target', () => target());
  ipcMain.handle('roboboy:update-download', (event, tag: string, name: string) => download(event.sender, String(tag), String(name)));
  ipcMain.handle('roboboy:update-cancel', () => { controller?.abort(); });
  ipcMain.handle('roboboy:update-install', () => install());
  // Only ever a release page of this repository, named by its tag, in the system browser.
  ipcMain.handle('roboboy:update-open-release', (_event, tag: string) => {
    if (!TAG.test(String(tag))) throw new Error('That is not a Robo-Boy release.');
    return shell.openExternal(`https://github.com/${REPOSITORY}/releases/tag/${tag}`);
  });
  ipcMain.handle('roboboy:update-open-installer', async () => {
    if (!verified) throw new Error('There is no checked installer to open.');
    const failure = await shell.openPath(verified);
    if (failure) throw new Error(failure);
  });
}
