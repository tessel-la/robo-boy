import { gt, valid } from 'semver';
import { version as packageVersion } from '../../../package.json';

/**
 * Robo-Boy's releases, as GitHub publishes them. The repository also releases the Panel SDK, so
 * "the latest release" is not necessarily the app's: only tags carrying the app's prefix count.
 */
export const APP_VERSION: string = packageVersion;
export const RELEASE_REPOSITORY = 'tessel-la/robo-boy';
const TAG_PREFIX = 'robo-boy-v';
const API = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;

export const releaseTag = (version: string) => `${TAG_PREFIX}${version}`;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** GitHub's own SHA-256 of the file, which the download is checked against. */
  sha256: string;
}
export interface AppRelease {
  version: string;
  tag: string;
  name: string;
  notes: string;
  publishedAt: string;
  pageUrl: string;
  assets: ReleaseAsset[];
}

/** The kind of installation this app is, as the desktop shell reports it. */
export interface UpdateTarget {
  shell: 'electron' | 'tauri';
  os: 'linux' | 'windows' | 'macos';
  arch: 'x64' | 'arm64';
  package: 'deb' | 'rpm' | 'nsis' | 'dmg';
}

interface GithubRelease {
  draft?: boolean;
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown }[];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function parseRelease(release: GithubRelease): AppRelease | null {
  const tag = text(release.tag_name);
  const version = tag.startsWith(TAG_PREFIX) ? valid(tag.slice(TAG_PREFIX.length)) : null;
  if (release.draft || !version) return null;
  return {
    version,
    tag,
    name: text(release.name) || `Robo-Boy ${version}`,
    notes: text(release.body),
    publishedAt: text(release.published_at),
    pageUrl: text(release.html_url),
    assets: (release.assets ?? []).flatMap(asset => {
      const digest = text(asset.digest);
      const size = typeof asset.size === 'number' ? asset.size : 0;
      return text(asset.name) && text(asset.browser_download_url) && size > 0
        ? [{ name: text(asset.name), url: text(asset.browser_download_url), size, sha256: digest.startsWith('sha256:') ? digest.slice(7) : '' }]
        : [];
    }),
  };
}

/** The newest release of the app, or null when there is none. */
export async function fetchLatestRelease(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<AppRelease | null> {
  let response: Response;
  try {
    response = await fetcher(`${API}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('GitHub could not be reached to check for updates.');
  }
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting update checks from this network for now. Robo-Boy will try again later.');
  if (!response.ok) throw new Error(`GitHub answered the update check with HTTP ${response.status}.`);
  const releases = (await response.json()) as GithubRelease[];
  if (!Array.isArray(releases)) throw new Error('GitHub answered the update check with something unexpected.');
  return releases.map(parseRelease).reduce<AppRelease | null>(
    (newest, release) => (release && (!newest || gt(release.version, newest.version)) ? release : newest),
    null,
  );
}

export const isNewer = (candidate: string, current: string = APP_VERSION) =>
  Boolean(valid(candidate) && valid(current) && gt(candidate, current));

/**
 * Every release publishes each installer under a name that never changes; this is the one this
 * installation was installed from. It is only offered when GitHub has a digest to check it against.
 */
const INSTALLERS: Record<string, string> = {
  'electron/linux/deb/x64': 'Robo-Boy-linux-amd64-electron.deb',
  'electron/linux/deb/arm64': 'Robo-Boy-linux-arm64-electron.deb',
  'electron/macos/dmg/arm64': 'Robo-Boy-macos-arm64-electron.dmg',
  'tauri/linux/deb/x64': 'Robo-Boy-linux-amd64.deb',
  'tauri/linux/rpm/x64': 'Robo-Boy-linux-x86_64.rpm',
  'tauri/windows/nsis/x64': 'Robo-Boy-windows-x64-setup.exe',
  'tauri/macos/dmg/x64': 'Robo-Boy-macos-universal.dmg',
  'tauri/macos/dmg/arm64': 'Robo-Boy-macos-universal.dmg',
};

export function installerFor(release: AppRelease, target: UpdateTarget): ReleaseAsset | undefined {
  const name = INSTALLERS[`${target.shell}/${target.os}/${target.package}/${target.arch}`];
  return release.assets.find(asset => asset.name === name && /^[0-9a-f]{64}$/.test(asset.sha256));
}

/**
 * What runs on the ROS host from this repository: the ROS container and its services, the proxy
 * and the Compose files. A release that touches any of them needs the host updated as well.
 */
const ROS_STACK_PATHS = ['infra/ros/', 'infra/docker/Dockerfile.ros', 'infra/docker/ros_entrypoint.sh', 'infra/caddy/', 'infra/compose/', 'docker-compose.yml', 'config/cyclonedds/'];
export const isRosStackFile = (file: string) =>
  ROS_STACK_PATHS.some(path => (path.endsWith('/') ? file.startsWith(path) : file === path)) && !/\/test_[^/]*\.py$/.test(file);

/** The command that brings a ROS host's checkout of this repository up to date. */
export const ROS_STACK_UPDATE_COMMAND = 'git pull && docker compose up -d --build';

/**
 * The ROS-stack files that changed between two versions, or null when that cannot be told
 * (a version with no release tag, a comparison GitHub truncates, or no answer).
 */
export async function rosStackChangesBetween(from: string, to: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const response = await fetcher(`${API}/compare/${releaseTag(from)}...${releaseTag(to)}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { files?: { filename?: unknown }[] };
    const files = (body.files ?? []).map(file => text(file.filename)).filter(Boolean);
    const changed = files.filter(isRosStackFile);
    // GitHub lists at most 300 files; past that, silence proves nothing.
    return changed.length || files.length < 300 ? changed : null;
  } catch {
    return null;
  }
}
