import { describe, beforeEach, expect, it, vi } from 'vitest';
import { importGamepadFile, loadGamepadLibrary } from '../customGamepad/gamepadStorage';
import { importBehaviorTree } from '../behaviorTree/storage/treeStorage';
import { serializePads, readPads } from '../customGamepad/portablePad';
import { serializeTree, readTree } from '../behaviorTree/portableTree';

const reviewer = vi.hoisted(() => ({ reviewImport: vi.fn(), showImportError: vi.fn() }));
vi.mock('./ImportReview', () => reviewer);
const pad = { id: 'existing', name: 'Drive', components: [] };
const tree = { id: 'existing', name: 'Patrol', nodes: [], edges: [], createdAt: 1, updatedAt: 1 };
const file = (data: unknown) => new File([JSON.stringify(data)], 'content.json');
beforeEach(() => {
  localStorage.clear();
  reviewer.reviewImport.mockReset();
  reviewer.showImportError.mockReset();
});

describe('reviewed file import integration', () => {
  it('does not write while reviewing or after cancellation', async () => {
    let finish!: (accepted: boolean) => void;
    reviewer.reviewImport.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const pending = importGamepadFile(file({ layouts: [pad] }));
    await vi.waitFor(() => expect(reviewer.reviewImport).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    finish(false);
    expect(await pending).toMatchObject({ success: false, imported: 0, errors: [] });
    expect(localStorage.length).toBe(0);
  });
  it('rechecks owner cancellation even if a delayed review resolves true', async () => {
    const controller = new AbortController();
    reviewer.reviewImport.mockImplementation(() => {
      controller.abort();
      return true;
    });
    expect(await importGamepadFile(file({ layouts: [pad] }), controller.signal)).toMatchObject({
      success: false,
      imported: 0,
    });
    expect(localStorage.length).toBe(0);
  });
  it('imports independent copies without replacing the existing library', async () => {
    reviewer.reviewImport.mockResolvedValue(true);
    const first = await importGamepadFile(file({ layouts: [pad] }));
    const second = await importGamepadFile(file({ layouts: [pad] }));
    expect(first.idMap.existing).not.toBe(second.idMap.existing);
    expect(loadGamepadLibrary().filter(item => !item.isDefault)).toHaveLength(2);
    expect(reviewer.reviewImport).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Import Pads', action: 'Import copies' }),
      undefined
    );
  });
  it('reports validation/storage failure without partial imports', async () => {
    const malformed = await importGamepadFile(file({ layouts: [pad, {}] }));
    expect(malformed.success).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(reviewer.reviewImport).not.toHaveBeenCalled();
    localStorage.setItem('robo-boy-custom-gamepads', '{"version":"future","customLayouts":[]}');
    reviewer.reviewImport.mockResolvedValue(true);
    expect((await importGamepadFile(file({ layouts: [pad] }))).errors.join(' ')).toContain('Unrecognized Pad storage');
    expect(localStorage.getItem('robo-boy-custom-gamepads')).toContain('future');
  });
  it('opens BT copies only after review and never persists or executes them', async () => {
    reviewer.reviewImport.mockResolvedValue(false);
    expect(await importBehaviorTree(file({ tree }))).toBeNull();
    reviewer.reviewImport.mockResolvedValue(true);
    const imported = await importBehaviorTree(file({ tree }));
    expect(imported?.id).not.toBe(tree.id);
    expect(imported?.name).toBe('Patrol');
    expect(localStorage.length).toBe(0);
    expect(await importBehaviorTree(file({ version: 'future', tree }))).toBeNull();
    expect(reviewer.showImportError).toHaveBeenCalledWith(expect.stringContaining('Unsupported'), undefined);
    const controller = new AbortController();
    controller.abort();
    expect(await importBehaviorTree(file({ tree }), controller.signal)).toBeNull();
  });
  it('round-trips owner exports through the existing wrappers', () => {
    const pads = readPads(JSON.stringify({ layouts: [pad] }));
    expect(readPads(serializePads(pads))).toEqual(pads);
    const decoded = readTree(JSON.stringify({ tree }));
    expect(readTree(serializeTree(decoded))).toEqual(decoded);
  });
});
