import { afterEach, expect, it } from 'vitest';
import { groupLibraryDocuments } from './documents';
import { bundledReleases } from './official';
import { makeCollection } from './store';
import { cloneContent } from './content';
import {
  getLibraryPads,
  getLibraryPad,
  getLibraryTrees,
  getLibraryTree,
  getLibraryWorkspaces,
  libraryDocumentId,
  setLibrarySnapshot,
} from './runtime';

afterEach(() => setLibrarySnapshot([]));
const starter = () => cloneContent(bundledReleases[0].package);
it('lists shared official items once across Catalog and the normal pickers', () => {
  const collections = bundledReleases.map(release => makeCollection(cloneContent(release.package)));
  const groups = groupLibraryDocuments(collections);
  expect(groups).toHaveLength(7);
  expect(
    groups.find(group => group.document.kind === 'pad' && (group.document.data as any).name === 'Joint readout')!
      .members
  ).toHaveLength(2);
  setLibrarySnapshot(collections);
  expect(getLibraryPads()).toHaveLength(2);
  expect(getLibraryTrees()).toHaveLength(2);
  expect(getLibraryWorkspaces()).toHaveLength(3);
});
it('collapses old duplicate collections without deleting IDs used by saved layouts', () => {
  const collections = [1, 2, 3].map(createdAt => ({ ...makeCollection(starter()), createdAt }));
  const before = JSON.stringify(collections);
  const groups = groupLibraryDocuments(collections.reverse());
  expect(groups).toHaveLength(3);
  expect(groups.every(group => group.members.length === 3)).toBe(true);
  expect(groups.every(group => group.collection.createdAt === 1)).toBe(true);
  setLibrarySnapshot(collections);
  expect(getLibraryWorkspaces()).toHaveLength(1);
  for (const item of collections) {
    expect(getLibraryPad(libraryDocumentId(item.id, 'pad/joints'))).toBeTruthy();
    expect(getLibraryTree(libraryDocumentId(item.id, 'bt/readiness'))).toBeTruthy();
  }
  expect(JSON.stringify([...collections].reverse())).toBe(before);
});
it('keeps identical-looking layouts distinct when their packaged controls differ', () => {
  const a = makeCollection(starter());
  const b = makeCollection(starter());
  const pad = b.package.documents.find(doc => doc.kind === 'pad')!.data as any;
  pad.rosConfig.defaultTopic = '/different_robot';
  const groups = groupLibraryDocuments([a, b]);
  expect(groups.filter(group => group.document.kind === 'workspace')).toHaveLength(2);
  expect(groups.filter(group => group.document.kind === 'pad')).toHaveLength(2);
  expect(groups.filter(group => group.document.kind === 'behaviorTree')).toHaveLength(1);
});
it('ignores JSON key order and package-local document IDs when comparing standalone controls', () => {
  const a = makeCollection(starter());
  a.package.documents = [a.package.documents[0]];
  const b = makeCollection(starter());
  const { id, name, ...rest } = b.package.documents[0].data as any;
  b.package.documents = [{ ...b.package.documents[0], id: 'other/package/path', data: { name, ...rest, id } }];
  expect(groupLibraryDocuments([a, b])).toHaveLength(1);
});
it('keeps archived entries separate and excludes individually removed definitions', () => {
  const a = makeCollection(starter());
  const b = { ...makeCollection(starter()), archivedAt: 1 };
  const c = { ...makeCollection(starter()), removedDocumentIds: ['pad/joints'] };
  expect(groupLibraryDocuments([a, b, c])).toHaveLength(3);
  expect(groupLibraryDocuments([a, b, c], true)).toHaveLength(6);
  const pad = groupLibraryDocuments([a, b, c]).find(group => group.document.kind === 'pad')!;
  expect(pad.members.map(member => member.collection.id)).toEqual([a.id]);
});
