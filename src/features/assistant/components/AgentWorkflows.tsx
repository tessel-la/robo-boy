import { useState } from 'react';
import { importSkill, loadSkills, storeSkills } from '../runtime/skills';

export function AgentWorkflows() {
  const [skills, setSkills] = useState(loadSkills),
    [error, setError] = useState('');
  return (
    <details className="assistant-workflows">
      <summary>Skills and workflows</summary>
      <p>Enabled instructions guide the agent. Importing is a trust decision; scripts and hooks are not executed.</p>
      {skills.map(skill => (
        <label key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={event => {
              const next = skills.map(item =>
                item.id === skill.id ? { ...item, enabled: event.target.checked } : item
              );
              try {
                storeSkills(next);
                setSkills(next);
              } catch (cause) {
                setError(String(cause));
              }
            }}
          />
          <span>
            {skill.name}
            <small style={{ display: 'block' }}>{skill.description}</small>
          </span>
        </label>
      ))}
      <label style={{ display: 'block', minHeight: 44 }}>
        Import trusted SKILL.md
        <input
          type="file"
          accept=".md,text/markdown,text/plain"
          onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 24_000) {
              setError('Skill exceeds 24 KiB.');
              return;
            }
            void file
              .text()
              .then(text => {
                const next = [...skills, importSkill(text)];
                storeSkills(next);
                setSkills(next);
                setError('');
              })
              .catch(cause => setError(String(cause)));
            event.target.value = '';
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
