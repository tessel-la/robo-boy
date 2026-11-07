import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentHooks } from './AgentHooks';
import { AgentProfiles } from './AgentProfiles';
import { AgentWorkflows } from './AgentWorkflows';
import { AgentIntegrations } from './AgentIntegrations';
import { loadAgentHooks } from '../runtime/hooks';
import { loadAgentProfiles } from '../runtime/profiles';
import { loadSkills } from '../runtime/skills';
import { loadIntegrations } from '../runtime/integrations';

const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('../runtime/integrations', async importOriginal => ({
  ...(await importOriginal<typeof import('../runtime/integrations')>()),
  listIntegrationTools: mocks.discover,
}));
beforeEach(() => {
  localStorage.clear();
  mocks.discover.mockReset();
});
afterEach(() => vi.restoreAllMocks());
describe('operator-owned agent extensions', () => {
  it('persists disabled-by-default policies, exact tools and explicit block/reminder timing', () => {
    render(<AgentHooks />);
    fireEvent.click(screen.getByText('Tool policies and hooks'));
    fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
    expect(screen.getByLabelText('Enabled')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Enabled'));
    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'read_topic' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'block' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Do not capture this topic.' } });
    expect(loadAgentHooks()[0]).toMatchObject({
      enabled: true,
      tool: 'read_topic',
      action: 'block',
      when: 'before',
      message: 'Do not capture this topic.',
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'note' } });
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'error' } });
    expect(loadAgentHooks()[0].when).toBe('error');
    fireEvent.click(screen.getByRole('button', { name: 'Remove policy' }));
    expect(loadAgentHooks()).toEqual([]);
  });
  it('reports policy persistence failures without pretending the policy was installed', () => {
    render(<AgentHooks />);
    fireEvent.click(screen.getByText('Tool policies and hooks'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Storage full');
    expect(screen.queryByText('Tool policy')).not.toBeInTheDocument();
  });
  it('creates read-only profiles, updates instructions/models and narrows rather than grants tools', () => {
    const selected = vi.fn();
    function Profiles() {
      const [id, setId] = useState<string>();
      return (
        <AgentProfiles
          selected={id}
          onSelect={(value, model) => {
            setId(value);
            selected(value, model);
          }}
        />
      );
    }
    render(<Profiles />);
    fireEvent.click(screen.getByText('Custom agents'));
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(screen.getByLabelText('Read-only')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TF specialist' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Inspect timestamps.' } });
    fireEvent.change(screen.getByLabelText('Model override (same provider/account)'), {
      target: { value: 'fixture-model' },
    });
    fireEvent.click(screen.getByText('Tool subset'));
    fireEvent.click(screen.getByLabelText('save_document'));
    fireEvent.click(screen.getByLabelText('save_document'));
    fireEvent.click(screen.getByLabelText('save_document'));
    fireEvent.click(screen.getByLabelText('Read-only'));
    const profile = loadAgentProfiles().find(item => item.name === 'TF specialist')!;
    expect(profile).toMatchObject({ instructions: 'Inspect timestamps.', model: 'fixture-model', readOnly: false });
    expect(profile.tools).not.toContain('save_document');
    fireEvent.change(screen.getByLabelText('Agent profile'), { target: { value: 'general' } });
    fireEvent.change(screen.getByLabelText('Agent profile'), { target: { value: profile.id } });
    expect(selected).toHaveBeenLastCalledWith(profile.id, 'fixture-model');
  });
  it('imports instruction-only workflows and retains the explicit trust/error boundary', async () => {
    render(<AgentWorkflows />);
    fireEvent.click(screen.getByText('Custom workflows (optional)'));
    expect(loadSkills()).toEqual([]);
    expect(screen.queryByLabelText(/Repair a Pad/)).not.toBeInTheDocument();
    const file = new File(['fixture'], 'SKILL.md', { type: 'text/markdown' });
    const text = vi.fn(
      async () =>
        '---\nname: Inspect battery\ndescription: Read voltage\n---\nRead the battery topic. Never execute the robot.'
    );
    Object.defineProperty(file, 'text', { value: text });
    fireEvent.change(screen.getByLabelText('Import trusted SKILL.md'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/Inspect battery/)).toBeChecked());
    expect(loadSkills().find(item => item.name === 'Inspect battery')?.instructions).toContain('battery topic');
    fireEvent.click(screen.getByLabelText(/Inspect battery/));
    expect(loadSkills().find(item => item.name === 'Inspect battery')?.enabled).toBe(false);
    const oversized = new File(['x'.repeat(24001)], 'SKILL.md');
    fireEvent.change(screen.getByLabelText('Import trusted SKILL.md'), { target: { files: [oversized] } });
    expect(screen.getByRole('alert')).toHaveTextContent('exceeds 24 KiB');
    text.mockResolvedValue('invalid untrusted workflow');
    fireEvent.change(screen.getByLabelText('Import trusted SKILL.md'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('exceeds 24 KiB'));
  });
  it('requires explicit MCP endpoint and per-tool grants, keeps tokens out of storage, and revokes them', async () => {
    mocks.discover.mockResolvedValue([
      { name: 'inspect', description: 'Read status', inputSchema: { type: 'object' } },
    ]);
    render(<AgentIntegrations />);
    fireEvent.click(screen.getByText('Trusted MCP integrations'));
    fireEvent.change(screen.getByLabelText('MCP endpoint'), { target: { value: 'https://fixture.test/mcp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    expect(loadIntegrations()[0].grants).toEqual({});
    fireEvent.change(screen.getByLabelText('MCP token for fixture.test'), {
      target: { value: 'session-fixture-only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discover tools' }));
    await waitFor(() => expect(screen.getByLabelText('Permission for inspect')).toBeVisible());
    expect(screen.getByLabelText('Permission for inspect')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Permission for inspect'), { target: { value: 'read' } });
    expect(loadIntegrations()[0].grants).toEqual({ inspect: 'read' });
    fireEvent.change(screen.getByLabelText('Permission for inspect'), { target: { value: '' } });
    expect(loadIntegrations()[0].grants).toEqual({});
    expect(JSON.stringify(localStorage)).not.toContain('session-fixture-only');
    fireEvent.click(screen.getByRole('button', { name: 'Remove integration' }));
    expect(loadIntegrations()).toEqual([]);
  });
  it('surfaces invalid endpoints and discovery failures without granting tools', async () => {
    render(<AgentIntegrations />);
    fireEvent.click(screen.getByText('Trusted MCP integrations'));
    fireEvent.change(screen.getByLabelText('MCP endpoint'), { target: { value: 'http://remote.test/mcp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(loadIntegrations()).toEqual([]);
    fireEvent.change(screen.getByLabelText('MCP endpoint'), { target: { value: 'https://fixture.test/mcp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    mocks.discover.mockRejectedValue(new Error('Offline fixture'));
    fireEvent.click(screen.getByRole('button', { name: 'Discover tools' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Offline fixture'));
    expect(loadIntegrations()[0].grants).toEqual({});
  });
});
