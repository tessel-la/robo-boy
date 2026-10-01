import React, { useEffect, useRef, useState } from 'react';
import { BehaviorTree } from '../types';
import { localRepositoryFiles, RepositoryTreeFile } from './treeRepository';

export default function TreeRepositoryBrowser({
  onLoad,
  disabled,
  onImportLibrary,
}: {
  onLoad: (tree: BehaviorTree) => void;
  disabled: boolean;
  onImportLibrary?: (tree: BehaviorTree) => void;
}) {
  const [files, setFiles] = useState<RepositoryTreeFile[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  const open = async (file: RepositoryTreeFile, add = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const tree = await file.load(controller.signal);
      if (!controller.signal.aborted) {
        if (add) onImportLibrary?.(tree);
        else onLoad(tree);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  };
  const shown = files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="bt-menu-section bt-repository-browser">
      <label className="bt-menu-label">Trees from a folder</label>
      <p className="bt-menu-hint">
        Choose a folder containing JSON or XML trees, including a local repository checkout.
      </p>
      <button className="bt-menu-action-btn" disabled={disabled || busy} onClick={() => folder.current?.click()}>
        {folderName ? 'Change folder' : 'Open local folder'}
      </button>
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        aria-label="Repository folder"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={event => {
          const selected = Array.from(event.target.files || []);
          if (!selected.length) return;
          setFiles(localRepositoryFiles(selected));
          setFolderName(selected[0].webkitRelativePath.split('/')[0] || 'Selected folder');
          setFilter('');
          setError(null);
          event.target.value = '';
        }}
      />
      {busy && <p role="status">Opening tree…</p>}
      {error && (
        <p role="alert" className="bt-native-error">
          {error}
        </p>
      )}
      {folderName && (
        <>
          <div className="bt-folder-heading">
            <strong title={folderName}>{folderName}</strong>
            <span>
              {files.length} {files.length === 1 ? 'tree file' : 'tree files'}
            </span>
          </div>
          <input
            type="search"
            aria-label="Search repository trees"
            placeholder="Search files or folders…"
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
          <p className="bt-menu-hint">
            Open a file to replace the current tree.
            {onImportLibrary && ' Add imports its subtrees into the current tree.'}
          </p>
          <ul className="bt-repository-files" aria-label="Folder tree files">
            {shown.slice(0, 100).map(file => {
              const parts = file.path.split('/');
              const name = parts.pop()!;
              const directory = parts.slice(1).join('/') || 'Folder root';
              return (
                <li className="bt-repository-file-row" key={file.path}>
                  <button
                    className="bt-menu-tree-row"
                    disabled={disabled || busy}
                    aria-label={`Open ${file.path}`}
                    title={file.path}
                    onClick={() => void open(file)}
                  >
                    <span className="bt-folder-format" aria-hidden="true">
                      {file.format}
                    </span>
                    <span className="bt-folder-file-info">
                      <strong>{name}</strong>
                      <small>{directory}</small>
                    </span>
                  </button>
                  {onImportLibrary && file.format === 'XML' && (
                    <button
                      className="bt-folder-add"
                      disabled={disabled || busy}
                      aria-label={`Add subtrees from ${file.path}`}
                      title="Add subtrees to the current tree"
                      onClick={() => void open(file, true)}
                    >
                      <span aria-hidden="true">+</span> Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {shown.length > 100 && (
            <p className="bt-menu-hint">Showing 100 of {shown.length} files. Narrow the search to see others.</p>
          )}
          {shown.length === 0 && (
            <p className="bt-menu-hint">
              {files.length ? 'No matching tree files.' : 'This folder has no JSON or XML tree files.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
