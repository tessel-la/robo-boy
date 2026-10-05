// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSubscription } from './claudeSubscription';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async original => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => fixture.home,
}));

// Exercise real pipes, process termination and temporary-file cleanup without provider credentials.
describe.skipIf(process.platform === 'win32')('Claude subprocess lifecycle', () => {
  let directory: string, config: string, runtime: ClaudeSubscription;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'roboboy-cli-test-'));
    fixture.home = directory;
    const bin = join(directory, '.local', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, 'claude'),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') console.log('2.1.278 (Claude Code)');
else if (args[0] === '--help') console.log('--restricted --safe-mode --tools --strict-mcp-config --setting-sources --no-session-persistence');
else if (args[0] === 'auth') console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'test@example.test' }));
else if (args[args.indexOf('--model') + 1] === 'hang') {
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'started'), 'yes');
  setInterval(() => {}, 1000);
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => { input += data; });
  process.stdin.on('end', () => {
    const details = {
      args, input: JSON.parse(input), cwd: process.cwd(),
      instructions: fs.readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8'),
      apiKey: process.env.ANTHROPIC_API_KEY,
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      config: process.env.CLAUDE_CONFIG_DIR,
    };
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(details) }));
  });
}
`,
      { mode: 0o700 }
    );
    vi.stubEnv('PATH', bin);
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-use');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'must-not-use');
    config = join(directory, 'config');
    runtime = new ClaudeSubscription(config);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it('transmits history and images over stdin and cleans up private prompt files', async () => {
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'previous answer' },
      { role: 'user' as const, content: 'next', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }] },
    ];
    const details = JSON.parse(
      await runtime.send(
        {
          provider: 'anthropic',
          model: 'sonnet',
          systemPrompt: 'Robot operations require review.',
          messages,
          jsonMode: true,
        },
        new AbortController().signal
      )
    );
    expect(details.config).toBe(config);
    expect(details.apiKey).toBeUndefined();
    expect(details.token).toBeUndefined();
    expect(details.args).toContain('--restricted');
    expect(details.instructions).toContain('Robot operations require review.');
    expect(details.input.message.content[0].text).toBe(
      JSON.stringify(messages.map(({ role, content }) => ({ role, content })))
    );
    expect(details.input.message.content[1].source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: 'aGVsbG8=',
    });
    await expect(readFile(join(details.cwd, 'instructions.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('terminates cancelled processes and removes their temporary directories', async () => {
    const controller = new AbortController();
    const pending = runtime.send(
      { provider: 'anthropic', model: 'hang', systemPrompt: 'rules', messages: [{ role: 'user', content: 'hello' }] },
      controller.signal
    );
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    await vi.waitFor(async () => expect(await readFile(join(config, 'started'), 'utf8')).toBe('yes'));
    controller.abort();
    await rejected;
    expect((await readdir(config)).filter(name => name.startsWith('chat-'))).toEqual([]);
  });
});
