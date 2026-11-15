import { beforeEach, afterEach, expect, it } from 'vitest';
import { bundledReleases } from './official';
import { makeCollection } from './store';
import { getLibraryWorkspaces, libraryDocumentId, openLibraryWorkspace, setLibrarySnapshot } from './runtime';
import {
  cloneGamepadTemplate,
  deleteCustomGamepad,
  getGamepadLayout,
  loadGamepadLibrary,
  saveCustomGamepad,
} from '../customGamepad/gamepadStorage';

beforeEach(() => {
  localStorage.clear();
  setLibrarySnapshot([]);
});
afterEach(() => setLibrarySnapshot([]));

it('lists imported Pads in the normal picker and preserves templates through authored saves/deletes', () => {
  const item = makeCollection(bundledReleases[0].package);
  const doc = item.package.documents.find(doc => doc.kind === 'pad')!;
  const id = libraryDocumentId(item.id, doc.id);
  setLibrarySnapshot([item]);
  expect(loadGamepadLibrary()).toContainEqual(expect.objectContaining({ id, name: 'Joint readout', isDefault: true }));
  expect(getGamepadLayout(id)?.layout.id).toBe(id);
  const editable = cloneGamepadTemplate(id)!;
  expect(editable.id).not.toBe(id);
  editable.name = 'My joints';
  expect(saveCustomGamepad(editable)).toBe(true);
  expect(JSON.parse(localStorage.getItem('robo-boy-custom-gamepads')!).customLayouts).toHaveLength(1);
  expect(deleteCustomGamepad(editable.id)).toBe(true);
  expect(getGamepadLayout(id)?.name).toBe('Joint readout');
});

it('lists imported layouts and opens fresh panels with their Pad, BT, geometry and 3D dependencies', () => {
  const item = makeCollection(bundledReleases[0].package);
  const before = JSON.stringify(item);
  const doc = item.package.documents.find(doc => doc.kind === 'workspace')!;
  const id = libraryDocumentId(item.id, doc.id);
  setLibrarySnapshot([item]);
  expect(getLibraryWorkspaces()).toEqual([{ id, title: 'Panda inspection' }]);
  const first = openLibraryWorkspace(id)!;
  const second = openLibraryWorkspace(id)!;
  expect(first.workspace?.id).not.toBe(second.workspace?.id);
  expect(first.workspace?.panels.map(panel => panel.id)).not.toEqual(second.workspace?.panels.map(panel => panel.id));
  expect(first.workspace?.panels.find(panel => panel.type === 'pad')?.layoutId).toBe(
    libraryDocumentId(item.id, 'pad/joints')
  );
  expect(first.workspace?.panels.find(panel => panel.type === 'behaviorTree')?.treeId).toBe(
    libraryDocumentId(item.id, 'bt/readiness')
  );
  expect(first.workspace?.tileOrder).toEqual(first.workspace?.panels.map(panel => panel.id));
  expect(first.visualizations).toHaveLength(1);
  expect(first.visualizations![0].panelId).toBe(first.workspace?.panels.find(panel => panel.type === '3d')?.id);
  expect(JSON.stringify(item)).toBe(before);
  expect(localStorage.length).toBe(0);
  setLibrarySnapshot([{ ...item, archivedAt: Date.now() }]);
  expect(getLibraryWorkspaces()).toEqual([]);
  expect(openLibraryWorkspace(id)).toBeNull();
  // Existing workspace references still resolve after archive.
  expect(getGamepadLayout(libraryDocumentId(item.id, 'pad/joints'))).not.toBeNull();
});

it('retains removed imported Pads for existing layouts and customization while hiding them from pickers', () => {
  const item = makeCollection(bundledReleases[0].package);
  const id = libraryDocumentId(item.id, 'pad/joints');
  setLibrarySnapshot([{ ...item, removedDocumentIds: ['pad/joints'] }]);
  expect(loadGamepadLibrary().some(pad => pad.id === id)).toBe(false);
  expect(getGamepadLayout(id)?.name).toBe('Joint readout');
  const copy = cloneGamepadTemplate(id)!;
  expect(copy.name).toBe('Joint readout');
  expect(copy.id).not.toBe(id);
});
