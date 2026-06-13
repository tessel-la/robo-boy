import React, { FormEvent, useEffect, useRef, useState } from 'react';

interface NodeNameEditorProps {
  initialName: string;
  defaultName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

const MAX_NODE_NAME_LENGTH = 80;

const NodeNameEditor: React.FC<NodeNameEditorProps> = ({ initialName, defaultName, onSave, onClose }) => {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedName = name.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedName) return;
    onSave(normalizedName);
  };

  return (
    <div className="bt-node-name-overlay" onClick={onClose}>
      <form
        className="bt-node-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bt-node-name-title"
        onSubmit={handleSubmit}
        onClick={event => event.stopPropagation()}
      >
        <div className="bt-node-name-header">
          <div>
            <div className="bt-node-name-kicker">Node settings</div>
            <h2 id="bt-node-name-title">Name node</h2>
          </div>
          <button type="button" className="bt-node-name-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <label className="bt-node-name-label" htmlFor="bt-node-name-input">
          Node name
        </label>
        <input
          ref={inputRef}
          id="bt-node-name-input"
          className="bt-node-name-input"
          value={name}
          maxLength={MAX_NODE_NAME_LENGTH}
          onChange={event => setName(event.target.value)}
          spellCheck={false}
        />

        <div className="bt-node-name-default">
          <span title={defaultName}>Default: {defaultName}</span>
          {name !== defaultName && (
            <button type="button" onClick={() => setName(defaultName)}>
              Reset
            </button>
          )}
        </div>

        <div className="bt-node-name-actions">
          <button type="button" className="bt-node-name-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="bt-node-name-save" disabled={!normalizedName}>
            Save name
          </button>
        </div>
      </form>
    </div>
  );
};

export default NodeNameEditor;
