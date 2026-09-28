import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION, fetchLatestRelease, installerFor, isNewer, isRosStackFile, rosStackChangesBetween, type AppRelease } from './releases';
import packageJson from '../../../package.json';

const DIGEST = 'a'.repeat(64);
const asset = (name: string, digest: string | null = `sha256:${DIGEST}`) => ({ name, browser_download_url: `https://github.com/tessel-la/robo-boy/releases/download/x/${name}`, size: 1234, digest });
const github = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchLatestRelease', () => {
  it('takes the newest app release, ignoring drafts and the other things the repository releases', async () => {
    const fetcher = github([
      { tag_name: 'panel-sdk-v9.0.0', assets: [] },
      { tag_name: 'robo-boy-v0.15.0-alpha', draft: true, assets: [] },
      { tag_name: 'robo-boy-v0.13.0-alpha', name: 'robo-boy: v0.13.0-alpha', assets: [asset('Robo-Boy-windows-x64-setup.exe')] },
      { tag_name: 'robo-boy-v0.14.0-alpha', name: 'robo-boy: v0.14.0-alpha', body: '### Features', published_at: '2026-09-27T10:00:00Z', html_url: 'https://github.com/tessel-la/robo-boy/releases/tag/robo-boy-v0.14.0-alpha', assets: [asset('Robo-Boy-windows-x64-setup.exe'), { name: 'broken', size: 0 }] },
    ]);
    const release = await fetchLatestRelease(fetcher);
    expect(release).toMatchObject({ version: '0.14.0-alpha', tag: 'robo-boy-v0.14.0-alpha', notes: '### Features', assets: [{ name: 'Robo-Boy-windows-x64-setup.exe', size: 1234, sha256: DIGEST }] });
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/tessel-la/robo-boy/releases?per_page=30', expect.objectContaining({ cache: 'no-store' }));
  });

  it('explains what kept it from checking', async () => {
    await expect(fetchLatestRelease(vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).rejects.toThrow('GitHub could not be reached');
    await expect(fetchLatestRelease(github({}, 403))).rejects.toThrow('limiting update checks');
    await expect(fetchLatestRelease(github({}, 500))).rejects.toThrow('HTTP 500');
    await expect(fetchLatestRelease(github({ message: 'x' }))).rejects.toThrow('something unexpected');
    await expect(fetchLatestRelease(github([]))).resolves.toBeNull();
  });
});

describe('versions and installers', () => {
  it('knows its own version and orders pre-releases', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(isNewer('0.14.0-alpha', '0.13.0-alpha')).toBe(true);
    expect(isNewer('0.13.0', '0.13.0-alpha')).toBe(true);
    expect(isNewer('0.13.0-alpha', '0.13.0-alpha')).toBe(false);
    expect(isNewer('not-a-version', '0.1.0')).toBe(false);
  });

  it('offers the installer this copy was installed from, only when GitHub can vouch for it', () => {
    const release = { assets: [
      { name: 'Robo-Boy-linux-amd64-electron.deb', url: 'u', size: 1, sha256: DIGEST },
      { name: 'Robo-Boy-linux-arm64-electron.deb', url: 'u', size: 1, sha256: '' },
      { name: 'Robo-Boy-macos-universal.dmg', url: 'u', size: 1, sha256: DIGEST },
      { name: 'Robo-Boy-macos-arm64-electron.dmg', url: 'u', size: 1, sha256: DIGEST },
    ] } as AppRelease;
    expect(installerFor(release, { shell: 'electron', os: 'linux', arch: 'x64', package: 'deb' })?.name).toBe('Robo-Boy-linux-amd64-electron.deb');
    expect(installerFor(release, { shell: 'electron', os: 'linux', arch: 'arm64', package: 'deb' })).toBeUndefined();
    expect(installerFor(release, { shell: 'tauri', os: 'macos', arch: 'arm64', package: 'dmg' })?.name).toBe('Robo-Boy-macos-universal.dmg');
    // The Electron Mac app is Apple Silicon only; an Intel Mac running it is sent to the release page.
    expect(installerFor(release, { shell: 'electron', os: 'macos', arch: 'arm64', package: 'dmg' })?.name).toBe('Robo-Boy-macos-arm64-electron.dmg');
    expect(installerFor(release, { shell: 'electron', os: 'macos', arch: 'x64', package: 'dmg' })).toBeUndefined();
    expect(installerFor(release, { shell: 'tauri', os: 'windows', arch: 'x64', package: 'nsis' })).toBeUndefined();
  });
});

describe('ROS stack changes', () => {
  it('counts what runs on the ROS host, not its tests or the app', () => {
    expect(['infra/ros/recording_runner.py', 'infra/docker/Dockerfile.ros', 'infra/caddy/Caddyfile', 'docker-compose.yml', 'config/cyclonedds/default.xml'].every(isRosStackFile)).toBe(true);
    expect(['infra/ros/test_recording_runner.py', 'src/App.tsx', 'infra/docker/Dockerfile.dev', 'docs/record-replay.md'].some(isRosStackFile)).toBe(false);
  });

  it('compares the two releases on GitHub', async () => {
    const fetcher = github({ files: [{ filename: 'src/App.tsx' }, { filename: 'infra/ros/recording_runner.py' }, { filename: 'docker-compose.yml' }] });
    await expect(rosStackChangesBetween('0.13.0-alpha', '0.14.0-alpha', fetcher)).resolves.toEqual(['infra/ros/recording_runner.py', 'docker-compose.yml']);
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/tessel-la/robo-boy/compare/robo-boy-v0.13.0-alpha...robo-boy-v0.14.0-alpha', expect.anything());
    await expect(rosStackChangesBetween('0.13.0-alpha', '0.14.0-alpha', github({ files: [{ filename: 'src/App.tsx' }] }))).resolves.toEqual([]);
  });

  it('does not claim anything it cannot tell', async () => {
    const truncated = github({ files: Array.from({ length: 300 }, (_, index) => ({ filename: `src/file${index}.ts` })) });
    await expect(rosStackChangesBetween('0.13.0-alpha', '0.14.0-alpha', truncated)).resolves.toBeNull();
    await expect(rosStackChangesBetween('0.13.0-dev', '0.14.0-alpha', github({ message: 'Not Found' }, 404))).resolves.toBeNull();
    await expect(rosStackChangesBetween('a', 'b', vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).resolves.toBeNull();
  });
});
