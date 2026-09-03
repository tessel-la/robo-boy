import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fail = message => {
  console.error(`[panel-stage] ${message}`);
  process.exit(1);
};

// A gitignored selection lets a machine embed panels that are not in the tracked workspace --
// unreleased or private ones -- without committing them. Falls back to the tracked config.
const localOverride = resolve(projectRoot, 'local-panel-sources.json');
const defaultConfig = existsSync(localOverride)
  ? localOverride
  : resolve(projectRoot, 'config/panel-sources.local.json');

const parseArguments = argv => {
  const options = {
    config: defaultConfig,
    output: resolve(projectRoot, '.panel-stage/public'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--config' && value) options.config = resolve(projectRoot, value);
    else if (argument === '--output' && value) options.output = resolve(projectRoot, value);
    else fail(`unknown or incomplete argument: ${argument}`);
    index += 1;
  }
  return options;
};

const runInstaller = (config, output) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [resolve(projectRoot, 'scripts/install-panels.mjs'), '--config', config, '--output', resolve(output, 'panels')],
      { cwd: projectRoot, env: process.env, stdio: 'inherit' }
    );
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`panel installer exited after signal ${signal}`));
      else if (code !== 0) rejectRun(new Error(`panel installer exited with code ${code}`));
      else resolveRun();
    });
  });

const options = parseArguments(process.argv.slice(2));

try {
  await rm(options.output, { recursive: true, force: true });
  await mkdir(dirname(options.output), { recursive: true });
  await cp(resolve(projectRoot, 'public'), options.output, { recursive: true });
  console.log(`[panel-stage] using ${relative(projectRoot, options.config) || options.config}`);
  await runInstaller(options.config, options.output);
  console.log(`[panel-stage] prepared public assets in ${options.output}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
