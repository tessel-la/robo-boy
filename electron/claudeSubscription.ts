import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { SubscriptionChatRequest, SubscriptionState } from '../src/runtime/assistantSubscription';
import type { HostTools } from '../src/features/assistant/tools/nativeTools';
import { startAssistantMcp } from './assistantMcp';

const INSTALL_MESSAGE =
  'Install or update the official Claude Code CLI (2.1.278 or newer), then try again. See code.claude.com/docs/en/setup.';

/** Do not let ambient API keys, tokens, gateway settings or plugin environment select billing/tools. */
export function claudeEnvironment(configDir: string, hostTools = false): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'WINDIR',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'XDG_CONFIG_HOME',
  ]) {
    if (process.env[name]) result[name] = process.env[name];
  }
  result.CLAUDE_CONFIG_DIR = configDir;
  if (!hostTools) result.CLAUDE_CODE_SAFE_MODE = '1';
  return result;
}

export const CLAUDE_CHAT_FLAGS = [
  '--restricted',
  '--safe-mode',
  '--tools',
  '',
  '--disallowedTools',
  'mcp__*',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true,"autoMemoryEnabled":false}',
  '--disable-slash-commands',
  '--no-chrome',
  '--permission-mode',
  'dontAsk',
  '--no-session-persistence',
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
];

export function claudeHostToolFlags(configFile: string, names: string[], readOnly = false): string[] {
  const flags: string[] = [];
  for (let index = 0; index < CLAUDE_CHAT_FLAGS.length; index++) {
    const flag = CLAUDE_CHAT_FLAGS[index];
    // Safe mode suppresses even explicit MCP servers. Keep restricted mode, disabled built-in
    // tools, no custom settings/hooks/commands and strict MCP as the capability boundary.
    if (flag === '--safe-mode') continue;
    if (flag === '--disallowedTools') { index++; continue; }
    if (flag === '--mcp-config') { flags.push(flag, configFile); index++; continue; }
    flags.push(flag);
  }
  return [...flags, '--allowedTools', names.map(name => `mcp__roboboy__${name}`).join(','), '--max-turns', readOnly ? '10' : '50'];
}

/** A single successful result; only the supplied scoped host tools may appear in the transcript. */
export function claudeResult(output: string, allowedTools?: ReadonlySet<string>): string {
  let result: any;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === 'assistant' && event.message?.content?.some((item: any) => item.type === 'tool_use' && !allowedTools?.has(item.name))) {
      throw new Error('Claude attempted a tool call. Robo-Boy subscription chat does not allow runtime tools.');
    }
    if (event.type === 'result') {
      if (result) throw new Error('Claude returned more than one completed result.');
      result = event;
    }
  }
  if (
    !result ||
    result.is_error ||
    result.subtype !== 'success' ||
    typeof result.result !== 'string' ||
    !result.result.trim()
  ) {
    throw new Error(
      'Claude did not complete the response. Check your subscription or sign in again in Assistant settings.'
    );
  }
  return result.result;
}

export class ClaudeSubscription {
  private executable?: string;
  private discovery?: Promise<string>;
  private prepared?: Promise<void>;
  constructor(private directory: string) {}

  private async binary(): Promise<string> {
    if (this.executable) return this.executable;
    if (this.discovery) return this.discovery;
    this.discovery = this.discoverBinary();
    try {
      return await this.discovery;
    } finally {
      this.discovery = undefined;
    }
  }

  private async discoverBinary(): Promise<string> {
    const directories = [
      join(homedir(), '.local', 'bin'),
      ...(process.env.PATH ?? '').split(delimiter).filter(isAbsolute),
    ];
    for (const directory of directories) {
      const filename = join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude');
      try {
        await access(filename, constants.X_OK);
      } catch {
        continue;
      }
      {
        const version = await this.run(['--version'], AbortSignal.timeout(10_000), undefined, this.directory, filename);
        const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
        if (
          !match ||
          Number(match[1]) < 2 ||
          (Number(match[1]) === 2 && Number(match[2]) === 1 && Number(match[3]) < 278) ||
          (Number(match[1]) === 2 && Number(match[2]) < 1)
        )
          throw new Error(INSTALL_MESSAGE);
        const help = await this.run(['--help'], AbortSignal.timeout(10_000), undefined, this.directory, filename);
        for (const flag of [
          '--restricted',
          '--safe-mode',
          '--tools',
          '--strict-mcp-config',
          '--setting-sources',
          '--no-session-persistence',
          '--effort',
        ]) {
          if (!help.includes(flag)) throw new Error(INSTALL_MESSAGE);
        }
        this.executable = filename;
        return filename;
      }
    }
    throw new Error(INSTALL_MESSAGE);
  }

  private async run(
    args: string[],
    signal: AbortSignal,
    input?: string,
    cwd = this.directory,
    executable?: string,
    onThinking?: (text: string) => void,
    onToken?: (text: string) => void,
    hostTools = false,
    onModelStep?: () => Promise<void>,
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  ): Promise<string> {
    signal.throwIfAborted();
    if (!this.prepared)
      this.prepared = (async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') await chmod(this.directory, 0o700);
        // A previous main-process crash can leave private prompt files behind. Clean only our
        // temporary directories before starting any requests in this single-instance runtime.
        const entries = await readdir(this.directory, { withFileTypes: true });
        await Promise.all(
          entries
            .filter(entry => entry.isDirectory() && /^chat-[A-Za-z0-9]{6}$/.test(entry.name))
            .map(entry => rm(join(this.directory, entry.name), { recursive: true, force: true }))
        );
      })();
    await this.prepared;
    // Discovery probes a candidate explicitly; requests use only a validated binary.
    const binary = executable ?? (await this.binary());
    signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd,
        env: claudeEnvironment(this.directory, hostTools),
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        tooLarge = false;
      let streamBuffer = '';
      let steps = Promise.resolve(), stepFailure: Error | undefined;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const kill = (force = false) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          else child.kill(force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          /* Already exited. */
        }
      };
      const abort = () => {
        if (hardKill) return;
        kill();
        hardKill = setTimeout(() => kill(true), 1000);
        hardKill.unref();
      };
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        if (hardKill) clearTimeout(hardKill);
      };
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => {
        cleanup();
        reject(new Error(INSTALL_MESSAGE));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (tooLarge) return;
        output += chunk;
        if (output.length > 8 * 1024 * 1024) {
          tooLarge = true;
          abort();
        }
        if ((onThinking || onToken || onModelStep || onUsage) && !tooLarge && !signal.aborted) {
          streamBuffer += chunk;
          const lines = streamBuffer.split(/\r?\n/);
          streamBuffer = lines.pop() ?? '';
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.type === 'result' && event.usage) onUsage?.({ inputTokens: event.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens ?? 0 });
              if (event.type === 'stream_event' && event.event?.type === 'message_start' && onModelStep) {
                steps = steps.then(onModelStep).catch(cause => { stepFailure = cause instanceof Error ? cause : new Error(String(cause)); abort(); });
              }
              const delta = event.type === 'stream_event' ? event.event?.delta : undefined;
              if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') onThinking?.(delta.thinking);
              if (delta?.type === 'text_delta' && typeof delta.text === 'string') onToken?.(delta.text);
            } catch { /* Completed output is validated by claudeResult. */ }
          }
        }
      });
      // Drain diagnostics without exposing credentials or the contents of prompts.
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      child.on('close', async code => {
        await steps;
        cleanup();
        if (stepFailure) reject(stepFailure);
        else if (signal.aborted) reject(new Error('Claude request was cancelled or timed out.'));
        else if (tooLarge) reject(new Error('Claude response is too large.'));
        else if (code !== 0 && !(args[0] === 'auth' && args[1] === 'status' && code === 1))
          reject(
            new Error(
              'Claude Code could not complete the request. Check your subscription and sign in again in Assistant settings.'
            )
          );
        else resolve(output);
      });
      if (signal.aborted) abort();
    });
  }

  async getState(): Promise<SubscriptionState> {
    try {
      const status = JSON.parse(await this.run(['auth', 'status', '--json'], AbortSignal.timeout(15_000)));
      const connected = status.loggedIn === true && status.authMethod === 'claude.ai';
      return {
        activeAccountId: 'claude-code',
        accounts: [{ id: 'claude-code', label: status.email ?? 'Claude Code', connected, planEnabled: connected }],
        models: [
          { id: 'sonnet', label: 'Claude Sonnet' },
          { id: 'opus', label: 'Claude Opus' },
          { id: 'haiku', label: 'Claude Haiku' },
        ],
      };
    } catch (error) {
      return { accounts: [], models: [], error: error instanceof Error ? error.message : INSTALL_MESSAGE };
    }
  }

  async signIn(signal: AbortSignal): Promise<void> {
    await this.run(['auth', 'login', '--claudeai'], signal);
  }
  async signOut(signal: AbortSignal): Promise<void> {
    await this.run(['auth', 'logout'], signal);
  }

  async send(request: SubscriptionChatRequest, signal: AbortSignal, onThinking?: (text: string) => void, tools?: HostTools, onToken?: (text: string) => void, onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void): Promise<string> {
    const state = await this.getState();
    if (!state.accounts.some(account => account.planEnabled))
      throw new Error(state.error ?? 'Sign in through Claude Code in Assistant settings before sending.');
    const cwd = await mkdtemp(join(this.directory, 'chat-'));
    let mcp: Awaited<ReturnType<typeof startAssistantMcp>> | undefined;
    let modelStep = Promise.resolve();
    const checkpoint = () => { modelStep = modelStep.then(async () => { await tools?.checkpoint?.(); }); return modelStep; };
    try {
      if (tools) {
        mcp = await startAssistantMcp({ ...tools, execute: async (name, input, id) => { await modelStep; signal.throwIfAborted(); return tools.execute(name, input, id); } }, signal);
        await writeFile(join(cwd, 'mcp.json'), JSON.stringify({ mcpServers: { roboboy: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } }), { mode: 0o600 });
      }
      await writeFile(
        join(cwd, 'instructions.txt'),
        request.systemPrompt +
          '\nThe user message contains conversation history as JSON. Answer its final user turn, using earlier turns as context.' +
          (request.jsonMode ? '\nReturn only one valid JSON object. No markdown or prose outside JSON.' : ''),
        { mode: 0o600 }
      );
      const content: any[] = [
        { type: 'text', text: JSON.stringify(request.messages.map(({ role, content }) => ({ role, content }))) },
      ];
      for (const image of request.messages.at(-1)?.images ?? []) {
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
      }
      const input = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
      const output = await this.run(
        [
          ...(tools ? claudeHostToolFlags(join(cwd, 'mcp.json'), tools.definitions.map(tool => tool.name), tools.scope === 'read-only') : CLAUDE_CHAT_FLAGS),
          '--model',
          request.model,
          ...(request.thinkingEffort ? ['--effort', request.thinkingEffort] : []),
          '--system-prompt-file',
          join(cwd, 'instructions.txt'),
        ],
        signal,
        input,
        cwd,
        undefined,
        onThinking,
        onToken,
        Boolean(tools),
        tools ? checkpoint : undefined,
        onUsage
      );
      signal.throwIfAborted();
      return claudeResult(output, tools ? new Set(tools.definitions.map(tool => `mcp__roboboy__${tool.name}`)) : undefined);
    } finally {
      await mcp?.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
