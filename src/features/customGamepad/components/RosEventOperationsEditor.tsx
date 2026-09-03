import React, { useEffect, useMemo, useState } from 'react';
import type { Ros } from 'roslib';
import type { RosOperation } from '../../../utils/rosOperations';
import { discoverAllROSResources } from '../../behaviorTree/services/rosDiscovery';

type EventName = 'press' | 'release' | 'on' | 'off';

interface Props {
  events: EventName[];
  value: Partial<Record<EventName, RosOperation>>;
  ros: Ros | null;
  onChange: (value: Partial<Record<EventName, RosOperation>>) => void;
}

const labels: Record<EventName, string> = { press: 'Press', release: 'Release', on: 'ON', off: 'OFF' };

const RosEventOperationsEditor: React.FC<Props> = ({ events, value, ros, onChange }) => {
  const [resources, setResources] = useState<Array<{ name: string; type: string; kind: RosOperation['kind'] }>>([]);
  const [payloadErrors, setPayloadErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    if (!ros) return;
    void discoverAllROSResources(ros).then(result => {
      if (cancelled) return;
      setResources([
        ...result.topics.map(item => ({ ...item, kind: 'topic' as const })),
        ...result.services.map(item => ({ name: item.name, type: item.type, kind: 'service' as const })),
        ...result.actions.map(item => ({ name: item.name, type: item.type, kind: 'action' as const })),
      ]);
    });
    return () => { cancelled = true; };
  }, [ros]);

  const resourcesByKind = useMemo(() => ({
    topic: resources.filter(item => item.kind === 'topic'),
    service: resources.filter(item => item.kind === 'service'),
    action: resources.filter(item => item.kind === 'action'),
  }), [resources]);

  const update = (event: EventName, patch: Partial<RosOperation>) => {
    const current = value[event] || { kind: 'topic', name: '', messageType: '', payload: {} };
    onChange({ ...value, [event]: { ...current, ...patch } as RosOperation });
  };

  return (
    <div className="ros-event-operations">
      {events.map(event => {
        const operation = value[event];
        if (!operation) {
          return <button key={event} type="button" className="event-operation-add" onClick={() => update(event, {})}>+ Configure {labels[event]}</button>;
        }
        const listId = `operation-resources-${event}`;
        return (
          <fieldset className="event-operation" key={event}>
            <legend>{labels[event]}</legend>
            <button type="button" className="event-operation-remove" onClick={() => {
              const next = { ...value };
              delete next[event];
              onChange(next);
            }} aria-label={`Remove ${labels[event]} operation`}>x</button>
            <label>Call type
              <select value={operation.kind} onChange={e => update(event, { kind: e.target.value as RosOperation['kind'], name: '', messageType: '' })}>
                <option value="topic">Topic</option><option value="service">Service</option><option value="action">Action</option>
              </select>
            </label>
            <label>Resource
              <input
                list={listId}
                value={operation.name}
                onChange={e => {
                  const match = resourcesByKind[operation.kind].find(item => item.name === e.target.value);
                  update(event, { name: e.target.value, messageType: match?.type || operation.messageType });
                }}
                placeholder="/resource_name"
              />
              <datalist id={listId}>{resourcesByKind[operation.kind].map(item => <option key={item.name} value={item.name}>{item.type}</option>)}</datalist>
            </label>
            <label>ROS type<input value={operation.messageType} onChange={e => update(event, { messageType: e.target.value })} /></label>
            <label className="event-operation-payload">Payload JSON
              <textarea
                defaultValue={JSON.stringify(operation.payload || {}, null, 2)}
                onBlur={e => {
                  try {
                    update(event, { payload: JSON.parse(e.target.value) });
                    setPayloadErrors(previous => ({ ...previous, [event]: '' }));
                  } catch {
                    setPayloadErrors(previous => ({ ...previous, [event]: 'Invalid JSON' }));
                  }
                }}
                spellCheck={false}
              />
              {payloadErrors[event] && <small className="event-operation-error">{payloadErrors[event]}</small>}
            </label>
            {operation.kind !== 'topic' && <label>Timeout (ms)<input type="number" min="1" value={operation.timeoutMs || (operation.kind === 'action' ? 60000 : 10000)} onChange={e => update(event, { timeoutMs: Number(e.target.value) })} /></label>}
          </fieldset>
        );
      })}
    </div>
  );
};

export default RosEventOperationsEditor;
