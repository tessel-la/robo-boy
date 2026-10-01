import React, { useEffect, useRef, useState } from 'react';
import { BehaviorTree } from '../types';
import { githubRepositoryFiles, localRepositoryFiles, RepositoryTreeFile } from './treeRepository';

export default function TreeRepositoryBrowser({
  onLoad,
  disabled,
}: {
  onLoad: (tree: BehaviorTree) => void;
  disabled: boolean;
}) {
  const [repository, setRepository] = useState('');
  const [revision, setRevision] = useState('');
  const [files, setFiles] = useState<RepositoryTreeFile[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listed, setListed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15000);
    try {
      await action(controller.signal);
    } catch (err) {
      if (timedOut) setError('Repository request timed out. Retry or open a local folder.');
      else if (!controller.signal.aborted) setError((err as Error).message);
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted || timedOut) setBusy(false);
    }
  };
  const shown = files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="bt-menu-section bt-repository-browser">
      <label className="bt-menu-label">Open from repository</label>
      <button className="bt-menu-action-btn" disabled={disabled || busy} onClick={() => folder.current?.click()}>
        Open local folder
      </button>
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        aria-label="Repository folder"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={event => {
          setFiles(localRepositoryFiles(Array.from(event.target.files || [])));
          setListed(true);
          setError(null);
          event.target.value = '';
        }}
      />
      <form
        onSubmit={event => {
          event.preventDefault();
          void run(async signal => {
            setFiles(await githubRepositoryFiles(repository, revision, signal));
            setListed(true);
          });
        }}
      >
        <label>
          GitHub repository
          <input
            aria-label="GitHub repository"
            placeholder="owner/repository"
            value={repository}
            disabled={disabled || busy}
            onChange={e => setRepository(e.target.value)}
          />
        </label>
        <label>
          Branch, tag or commit
          <input
            aria-label="Repository revision"
            placeholder="Default branch"
            value={revision}
            disabled={disabled || busy}
            onChange={e => setRevision(e.target.value)}
          />
        </label>
        <button className="bt-menu-action-btn" disabled={disabled || busy || !repository.trim()} type="submit">
          Browse repository
        </button>
      </form>
      {busy && <p role="status">Loading repository…</p>}
      {error && (
        <p role="alert" className="bt-native-error">
          {error}
        </p>
      )}
      {listed && (
        <>
          <input
            type="search"
            aria-label="Search repository trees"
            placeholder="Filter files or folder…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <p className="bt-menu-hint">JSON and XML files. Robo Boy validates each tree when opened.</p>
          <div className="bt-repository-files">
            {shown.slice(0, 100).map(file => (
              <button
                className="bt-menu-tree-row"
                key={file.path}
                disabled={disabled || busy}
                onClick={() =>
                  void run(async signal => {
                    const tree = await file.load(signal);
                    if (!signal.aborted) onLoad(tree);
                  })
                }
              >
                <span className="bt-menu-tree-name">{file.path}</span>
                <small>{file.format}</small>
              </button>
            ))}
          </div>
          {shown.length > 100 && (
            <p className="bt-menu-hint">Showing 100 of {shown.length} files. Filter by folder or filename.</p>
          )}
          {shown.length === 0 && <p className="bt-menu-hint">No matching JSON or XML files.</p>}
        </>
      )}
    </div>
  );
}
