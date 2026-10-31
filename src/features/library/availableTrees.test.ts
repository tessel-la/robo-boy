import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  deleteBehaviorTree,
  importBehaviorTree,
  listAvailableBehaviorTrees,
  listBehaviorTrees,
  loadBehaviorTree,
  saveBehaviorTree,
} from '../behaviorTree/storage/treeStorage';
import { bundledReleases } from './official';
import { makeCollection } from './store';
import { getLibraryTree, libraryDocumentId, setLibrarySnapshot } from './runtime';
import type { BehaviorTree } from '../behaviorTree/types';

const reviewer = vi.hoisted(() => ({ reviewImport: vi.fn(), showImportError: vi.fn() }));
vi.mock('./ImportReview', () => reviewer);
beforeEach(() => {
  localStorage.clear();
  setLibrarySnapshot([]);
  vi.clearAllMocks();
});
afterEach(() => setLibrarySnapshot([]));

it('makes hydrated imported trees discoverable without copying templates into authored storage', () => {
  const collection = makeCollection(bundledReleases[0].package);
  const doc = collection.package.documents.find(doc => doc.kind === 'behaviorTree')!;
  const id = libraryDocumentId(collection.id, doc.id);
  const changed = vi.fn();
  window.addEventListener('robo-boy-behavior-trees-changed', changed);
  setLibrarySnapshot([collection]);
  window.removeEventListener('robo-boy-behavior-trees-changed', changed);
  expect(changed).toHaveBeenCalledOnce();
  expect(listAvailableBehaviorTrees()).toEqual([
    expect.objectContaining({ imported: true, tree: expect.objectContaining({ id }) }),
  ]);
  expect(listBehaviorTrees()).toEqual([]);
  const editable = loadBehaviorTree(id)!;
  expect(editable.id).not.toBe(id);
  expect(editable.id).not.toBe((doc.data as BehaviorTree).id);
  editable.name = 'My edited tree';
  expect(saveBehaviorTree(editable)).toBe(true);
  expect(listAvailableBehaviorTrees()).toHaveLength(2);
  expect(listBehaviorTrees()).toHaveLength(1);
  expect(getLibraryTree(id)?.name).toBe((doc.data as BehaviorTree).name);
  expect(deleteBehaviorTree(editable.id)).toBe(true);
  expect(listAvailableBehaviorTrees()).toHaveLength(1);
  expect(listBehaviorTrees()).toEqual([]);
  // Archiving hides templates from new selection while existing workspace references still resolve.
  setLibrarySnapshot([{ ...collection, archivedAt: Date.now() }]);
  expect(listAvailableBehaviorTrees()).toEqual([]);
  expect(getLibraryTree(id)).not.toBeNull();
});

it('preserves unrecognized storage and reports a BT import save failure', async () => {
  const original = '{"version":"future","trees":[]}';
  localStorage.setItem('robo-boy-behavior-trees', original);
  reviewer.reviewImport.mockResolvedValue(true);
  const tree = { id: 'test', name: 'Patrol', nodes: [], edges: [], createdAt: 1, updatedAt: 1 };
  const file = new File([JSON.stringify({ tree })], 'tree.json');
  expect(await importBehaviorTree(file)).toBeNull();
  expect(localStorage.getItem('robo-boy-behavior-trees')).toBe(original);
  expect(reviewer.showImportError).toHaveBeenCalledWith(expect.stringContaining('save'), undefined);
});

it('does not save a BT if its owner closes while import review is pending', async () => {
  const controller = new AbortController();
  reviewer.reviewImport.mockImplementation(() => {
    controller.abort();
    return true;
  });
  const tree = { id: 'test', name: 'Patrol', nodes: [], edges: [], createdAt: 1, updatedAt: 1 };
  expect(await importBehaviorTree(new File([JSON.stringify({ tree })], 'tree.json'), controller.signal)).toBeNull();
  expect(localStorage.length).toBe(0);
});
