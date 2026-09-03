import React, { useId } from 'react';
import { BlackboardInputBinding, BlackboardOutputBinding, BlackboardValueType } from '../types';
import ContainedSelect from './ContainedSelect';
import './BlackboardBindingEditor.css';

type Binding = BlackboardInputBinding | BlackboardOutputBinding;

export interface BlackboardPathSuggestion {
  path: string;
  rosType?: string;
}

interface Props {
  direction: 'input' | 'output';
  bindings: Binding[];
  onChange: (bindings: Binding[]) => void;
  blackboardVariables?: string[];
  blackboardValues?: Record<string, unknown>;
  blackboardTypes?: Record<string, BlackboardValueType>;
  pathSuggestions?: Array<string | BlackboardPathSuggestion>;
  pathLabel?: string;
  emptyHint?: string;
}

const pathOf = (binding: Binding) => ('targetPath' in binding ? binding.targetPath : binding.sourcePath);

const valueKind = (value: unknown): 'unknown' | 'boolean' | 'number' | 'string' | 'array' | 'object' => {
  if (value === undefined || value === null) return 'unknown';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'object';
};

export const isBlackboardValueCompatible = (value: unknown, rosType?: string): boolean => {
  if (!rosType || value === undefined || value === null) return true;
  const normalized = rosType.toLowerCase();
  if (normalized.endsWith('[]')) return Array.isArray(value);
  if (['bool', 'boolean'].includes(normalized)) return typeof value === 'boolean';
  if (/^(u?int(8|16|32|64)?|byte|char|float(32|64)?|double)$/.test(normalized)) return typeof value === 'number';
  if (normalized === 'string' || normalized === 'wstring') return typeof value === 'string';
  return typeof value === 'object' && !Array.isArray(value);
};

export const isBlackboardTypeCompatible = (type: BlackboardValueType | undefined, rosType?: string): boolean => {
  if (!type || !rosType) return true;
  const normalized = rosType.toLowerCase();
  if (['bool', 'boolean'].includes(normalized)) return type === 'bool';
  if (/^u?int(8|16|32)?$/.test(normalized) || ['byte', 'char'].includes(normalized)) return type === 'int32';
  if (/^u?int64$/.test(normalized)) return type === 'int64' || type === 'int32';
  if (['float', 'float32'].includes(normalized)) return ['float32', 'int32'].includes(type);
  if (['double', 'float64'].includes(normalized)) return ['float64', 'float32', 'int32', 'int64'].includes(type);
  if (normalized === 'string' || normalized === 'wstring') return type === 'string';
  if (normalized.endsWith('[]')) {
    return normalized.startsWith('string') ? type === 'stringArray' : type === 'numberArray';
  }
  if (normalized.includes('vector3')) return type === 'vector3';
  if (normalized.includes('/point')) return type === 'point' || type === 'vector3';
  if (normalized.includes('quaternion')) return type === 'quaternion';
  if (normalized.includes('/pose')) return type === 'pose';
  if (normalized.includes('/twist')) return type === 'twist';
  if (normalized.includes('/time')) return type === 'time';
  if (normalized.includes('/duration')) return type === 'duration';
  return type === 'json';
};

const BlackboardBindingEditor: React.FC<Props> = ({
  direction,
  bindings,
  onChange,
  blackboardVariables = [],
  blackboardValues = {},
  blackboardTypes = {},
  pathSuggestions = [],
  pathLabel = direction === 'input' ? 'Target field' : 'Source field',
  emptyHint,
}) => {
  const id = useId().replace(/:/g, '');
  const suggestions = pathSuggestions.map(suggestion => (
    typeof suggestion === 'string' ? { path: suggestion } : suggestion
  ));
  const variables = Array.from(
    new Set([...blackboardVariables, ...bindings.map(binding => binding.variable)].filter(Boolean))
  ).sort();

  const update = (index: number, field: 'path' | 'variable', value: string) => {
    onChange(
      bindings.map((binding, bindingIndex) => {
        if (bindingIndex !== index) return binding;
        if (field === 'variable') return { ...binding, variable: value };
        return direction === 'input'
          ? { variable: binding.variable, targetPath: value }
          : { variable: binding.variable, sourcePath: value };
      })
    );
  };

  const add = () =>
    onChange([
      ...bindings,
      direction === 'input'
        ? { targetPath: suggestions[0]?.path || '', variable: '' }
        : { sourcePath: suggestions[0]?.path || '', variable: '' },
    ]);

  return (
    <section className={`bbe ${direction}`} aria-label={`${direction} blackboard bindings`}>
      <div className="bbe-heading">
        <div>
          <strong>{direction === 'input' ? 'Read from blackboard' : 'Write to blackboard'}</strong>
          <span>{direction === 'input' ? 'Use a stored value in this node' : 'Store a result for later nodes'}</span>
        </div>
        <button type="button" className="bbe-add" onClick={add}>
          + Connect
        </button>
      </div>

      {bindings.length === 0 ? (
        <button type="button" className="bbe-empty" onClick={add}>
          <span className="bbe-empty-port" aria-hidden="true" />
          {emptyHint || 'No values connected yet'}
        </button>
      ) : (
        <div className="bbe-list">
          {bindings.map((binding, index) => (
            <div
              className={`bbe-row${direction === 'input' && binding.variable && !(blackboardTypes[binding.variable] ? isBlackboardTypeCompatible(blackboardTypes[binding.variable], suggestions.find(suggestion => suggestion.path === pathOf(binding))?.rosType) : isBlackboardValueCompatible(blackboardValues[binding.variable], suggestions.find(suggestion => suggestion.path === pathOf(binding))?.rosType)) ? ' incompatible' : ''}`}
              key={`${index}-${pathOf(binding)}`}
            >
              <label>
                <span>{pathLabel}</span>
                {suggestions.length > 0 ? (
                  <ContainedSelect
                    ariaLabel={`${pathLabel} ${index + 1}`}
                    value={pathOf(binding)}
                    onChange={next => update(index, 'path', next)}
                    options={[
                      { value: '', label: 'Select parameter…' },
                      ...(pathOf(binding) && !suggestions.some(suggestion => suggestion.path === pathOf(binding))
                        ? [{ value: pathOf(binding), label: `${pathOf(binding)} · custom` }]
                        : []),
                      ...suggestions.map(suggestion => ({
                        value: suggestion.path,
                        label: `${suggestion.path}${suggestion.rosType ? ` · ${suggestion.rosType}` : ''}`,
                      })),
                    ]}
                  />
                ) : (
                  <input
                    aria-label={`${pathLabel} ${index + 1}`}
                    value={pathOf(binding)}
                    onChange={event => update(index, 'path', event.target.value)}
                    placeholder="field.path"
                    spellCheck={false}
                  />
                )}
              </label>
              <span
                className="bbe-wire"
                title={direction === 'input' ? 'Value flows into node' : 'Value flows into blackboard'}
              >
                <i />
                {direction === 'input' ? '←' : '→'}
                <i />
              </span>
              <label>
                <span>Blackboard key</span>
                {direction === 'input' ? (
                  <ContainedSelect
                    ariaLabel={`Blackboard key ${index + 1}`}
                    value={binding.variable}
                    onChange={next => update(index, 'variable', next)}
                    options={[
                      { value: '', label: 'Select value…' },
                      ...variables
                      .filter(variable => variable === binding.variable || (blackboardTypes[variable]
                        ? isBlackboardTypeCompatible(blackboardTypes[variable], suggestions.find(suggestion => suggestion.path === pathOf(binding))?.rosType)
                        : isBlackboardValueCompatible(blackboardValues[variable], suggestions.find(suggestion => suggestion.path === pathOf(binding))?.rosType)))
                      .map(variable => ({
                        value: variable,
                        label: `${variable} · ${blackboardTypes[variable] || valueKind(blackboardValues[variable])}`,
                      })),
                    ]}
                  />
                ) : (
                  <input
                    aria-label={`Blackboard key ${index + 1}`}
                    list={`${id}-variables`}
                    value={binding.variable}
                    onChange={event => update(index, 'variable', event.target.value)}
                    placeholder="value_name"
                    spellCheck={false}
                  />
                )}
              </label>
              <button
                type="button"
                className="bbe-remove"
                onClick={() => onChange(bindings.filter((_, bindingIndex) => bindingIndex !== index))}
                aria-label={`Remove mapping ${index + 1}`}
                title="Remove connection"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <datalist id={`${id}-variables`}>
        {variables.map(variable => (
          <option key={variable} value={variable} />
        ))}
      </datalist>
    </section>
  );
};

export const completeBindings = <T extends Binding>(bindings: T[]): T[] =>
  bindings.filter(binding => pathOf(binding).trim() && binding.variable.trim());

export default BlackboardBindingEditor;
