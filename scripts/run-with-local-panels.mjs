import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...stageArguments] = process.argv.slice(2);
const supportedCommands = new Set(['dev', 'build', 'build:tauri']);

if (!supportedCommands.has(command)) {
  console.error(`[panel-runner] expected one of: ${[...supportedCommands].join(', ')}`);
  process.exit(1);
}

const run = (executable, arguments_, environment = process.env) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, arguments_, {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    });
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`${executable} exited after signal ${signal}.`));
      else if (code !== 0) rejectRun(new Error(`${executable} exited with code ${code}.`));
      else resolveRun();
    });
  });

try {
  await run(process.execPath, [resolve(projectRoot, 'scripts/stage-local-panels.mjs'), ...stageArguments]);
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await run(npmExecutable, ['run', command], {
    ...process.env,
    ROBOBOY_PUBLIC_DIR: resolve(projectRoot, '.panel-stage/public'),
  });
} catch (error) {
  console.error(`[panel-runner] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
