import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ROSLIB, { type Ros } from 'roslib';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import { controlSessionFor } from '../robotControl/ControlSession';
import {
  applyNodeParameters,
  loadNodeParameters,
  PARAMETER_LIMIT,
  parameterWriteBlock,
  type ParameterSnapshot,
} from './parameterClient';
import {
  draftConflict,
  formatParameterValue,
  PARAMETER_TYPES,
  parseParameterInput,
  sameParameterValue,
  type NodeParameter,
  type ParameterDraft,
} from './parametersModel';
import type { Resource } from './types';
import './ParametersView.css';

const emptySubscribe = () => () => {};
const emptySnapshot = () => null;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Props {
  ros: Ros | null;
  active: boolean;
  nodes: Resource[];
  node: string;
  onNodeChange: (node: string) => void;
  replay: boolean;
}

/** Drafts belong to this tile and connection, never browser storage or assistant settings. */
export default function ParametersView({ ros, active, nodes, node, onNodeChange, replay }: Props) {
  const [loaded, setLoaded] = useState<{ node: string; data: ParameterSnapshot }>();
  const [draftsByNode, setDraftsByNode] = useState<Record<string, Record<string, ParameterDraft>>>({});
  const [selected, setSelected] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [review, setReview] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const write = useRef<AbortController>();
  const editor = useRef<HTMLTextAreaElement | HTMLSelectElement | null>(null);
  const control = controlSessionFor(ros);
  useSyncExternalStore(control?.subscribe ?? emptySubscribe, control?.getSnapshot ?? emptySnapshot);
  const data = loaded?.node === node ? loaded.data : undefined;
  // Parameter names such as "constructor" and "__proto__" are ordinary ROS names.
  const drafts: Record<string, ParameterDraft> = Object.assign(Object.create(null), draftsByNode[node]);
  const entries = Object.entries(drafts);
  const parameter = data?.parameters.find(item => item.name === selected);
  const conflict = entries.some(([name, draft]) =>
    draftConflict(
      draft,
      data?.parameters.find(item => item.name === name)
    )
  );
  const duplicate = nodes.find(item => item.name === node)?.instances;
  const block =
    parameterWriteBlock(ros) ||
    (node.startsWith('/roboboy/control/external/')
      ? 'Robot-side control policy can only be changed through native ROS.'
      : undefined) ||
    (duplicate && duplicate > 1 ? 'Multiple nodes share this name; parameter updates are disabled.' : undefined) ||
    (!data?.writable ? 'This node does not expose a parameter update service.' : undefined);

  useEffect(() => {
    setLoaded(undefined);
    setDraftsByNode({});
    setSelected('');
    setReview(false);
    setError('');
    setNotice('');
    setApplying(false);
    return () => write.current?.abort();
  }, [ros]);
  useEffect(() => {
    setSelected('');
    setReview(false);
    setError('');
    setNotice('');
  }, [node]);
  useEffect(() => {
    if (!active || !ros || !node || replay) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    loadNodeParameters(ros, node, controller.signal)
      .then(
        data => {
          if (!controller.signal.aborted) setLoaded({ node, data });
        },
        error => {
          if (!controller.signal.aborted) {
            setLoaded(undefined);
            setError(message(error));
          }
        }
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ros, node, active, replay, refresh]);
  useEffect(() => {
    if (!active || !ros || !node || replay) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const events = new ROSLIB.Topic({
      ros,
      name: '/parameter_events',
      messageType: 'rcl_interfaces/msg/ParameterEvent',
      throttle_rate: 0,
      queue_length: 10,
    });
    events.subscribe((event: { node?: string }) => {
      if (event.node !== node) return;
      clearTimeout(timer);
      timer = setTimeout(() => setRefresh(value => value + 1), 200);
    });
    return () => {
      clearTimeout(timer);
      events.unsubscribe();
    };
  }, [ros, node, active, replay]);
  useEffect(() => {
    if (parameter) editor.current?.focus();
  }, [selected]);

  const updateDrafts = (next: Record<string, ParameterDraft>) =>
    setDraftsByNode(previous => ({ ...previous, [node]: next }));
  const selectParameter = (item: NodeParameter) => {
    setSelected(item.name);
    setText(formatParameterValue(drafts[item.name]?.value ?? item.value));
    setReview(false);
    setError('');
  };
  const stage = () => {
    if (!parameter) return;
    try {
      const value = parseParameterInput(parameter, text);
      if (!drafts[parameter.name] && entries.length >= 32) throw new Error('Stage at most 32 changes per node.');
      const next: Record<string, ParameterDraft> = Object.assign(Object.create(null), drafts);
      if (sameParameterValue(value, parameter.value)) delete next[parameter.name];
      else next[parameter.name] = { original: drafts[parameter.name]?.original ?? parameter, value };
      updateDrafts(next);
      setError('');
      setNotice('Edit staged. Review changes before applying them to the robot.');
    } catch (error) {
      setError(message(error));
    }
  };
  const apply = async () => {
    if (!ros || !active || replay || applying || block || conflict || loading) return;
    const controller = new AbortController();
    write.current = controller;
    setApplying(true);
    setError('');
    setNotice('');
    try {
      const results = await applyNodeParameters(ros, node, drafts, data!.atomic, controller.signal);
      if (controller.signal.aborted) return;
      // Every submitted draft is consumed, including rejected ones. A fresh edit is explicit.
      setDraftsByNode(previous => ({ ...previous, [node]: {} }));
      const failed = results.filter(result => !result.successful);
      setNotice(`${results.length - failed.length} of ${results.length} changes applied.`);
      if (failed.length)
        setError(failed.map(result => `${result.name}: ${result.reason || 'Rejected by the node.'}`).join('\n'));
      setSelected('');
      setReview(false);
      setRefresh(value => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(message(error));
        setReview(false);
        setRefresh(value => value + 1);
      }
    } finally {
      if (!controller.signal.aborted) setApplying(false);
    }
  };

  if (replay)
    return (
      <p className="de-empty">
        Parameters were not recorded in this MCAP. Select Live robot to browse the connected robot.
      </p>
    );
  if (!ros) return <p className="de-empty">Connect to a live robot to browse parameters.</p>;
  return (
    <section className="de-parameters" aria-label="ROS 2 parameters" aria-busy={loading || applying}>
      <div className="de-parameter-toolbar">
        <label>
          Node
          <select
            aria-label="Parameter node"
            value={node}
            disabled={applying}
            onChange={event => onNodeChange(event.target.value)}
          >
            <option value="">Select a node…</option>
            {node && !nodes.some(item => item.name === node) && <option value={node}>{node} (not discovered)</option>}
            {nodes.map(item => (
              <option key={item.id} value={item.name}>
                {item.name}
                {Object.keys(draftsByNode[item.name] ?? {}).length
                  ? ` (${Object.keys(draftsByNode[item.name]).length} staged)`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            aria-label="Search parameters"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <button
          aria-label="Refresh parameters"
          disabled={!node || loading || applying || !active}
          onClick={() => setRefresh(value => value + 1)}
        >
          <FiRefreshCw />
          Refresh
        </button>
      </div>
      {error && (
        <p className="de-warning de-parameter-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="de-muted de-parameter-message" role="status">
          {notice}
        </p>
      )}
      {node && block && <p className="de-muted de-parameter-message">{block}</p>}
      {data && data.total > PARAMETER_LIMIT && (
        <p className="de-warning">
          Showing the first {PARAMETER_LIMIT} of {data.total} parameters.
        </p>
      )}
      {!node ? (
        <p className="de-empty">
          Select a node to read its parameters. No robot setting changes until you review and apply edits.
        </p>
      ) : !data ? (
        <p className="de-empty">
          {loading
            ? 'Reading node parameters…'
            : 'Parameters unavailable. The node must expose ROS 2 parameter services.'}
        </p>
      ) : (
        <>
          <div className="de-parameter-actions">
            <span>
              {data.parameters.length} parameters · {entries.length} staged
            </span>
            <button
              disabled={!entries.length || applying}
              onClick={() => {
                updateDrafts({});
                setReview(false);
                setSelected('');
                setError('');
                setNotice('Staged changes discarded.');
              }}
            >
              Discard changes
            </button>
            <button
              disabled={!entries.length || applying || loading}
              onClick={() => {
                setReview(true);
                setSelected('');
                setError('');
              }}
            >
              Review changes
            </button>
          </div>
          {review ? (
            <section className="de-parameter-review" aria-label="Review parameter changes">
              <h3>Review changes on {node}</h3>
              <p>
                {data.atomic
                  ? 'The node accepts all changes together or rejects all of them.'
                  : 'Changes are applied individually. Some may succeed while others are rejected; each result is reported.'}
              </p>
              <ul>
                {entries.map(([name, draft]) => {
                  const issue = draftConflict(
                    draft,
                    data.parameters.find(item => item.name === name)
                  );
                  return (
                    <li key={name}>
                      <strong>{name}</strong>
                      <code>
                        {JSON.stringify(draft.original.value)} → {JSON.stringify(draft.value)}
                      </code>
                      {issue && <span className="de-warning">{issue}</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="de-muted">
                Live values and constraints are checked again before applying. Other robot software can still change
                them at the same time.
              </p>
              <div className="de-parameter-actions">
                <button disabled={applying} onClick={() => setReview(false)}>
                  Back to parameters
                </button>
                <button
                  disabled={!!block || conflict || applying || loading || !active || !entries.length}
                  onClick={() => void apply()}
                >
                  {applying ? 'Applying…' : 'Apply changes'}
                </button>
              </div>
            </section>
          ) : (
            <div className="de-parameter-content" data-editing={!!parameter}>
              <div className="de-parameter-list" aria-label="Parameter list">
                {!data.parameters.some(item =>
                  `${item.name} ${item.descriptor.description}`.toLowerCase().includes(query.toLowerCase())
                ) && (
                  <p className="de-empty">
                    {data.total ? 'No parameters match this search.' : 'This node has no declared parameters.'}
                  </p>
                )}
                {data.parameters
                  .filter(item =>
                    `${item.name} ${item.descriptor.description}`.toLowerCase().includes(query.toLowerCase())
                  )
                  .map(item => (
                    <button
                      key={item.name}
                      aria-label={`Edit ${item.name}`}
                      aria-pressed={selected === item.name}
                      disabled={applying}
                      onClick={() => selectParameter(item)}
                    >
                      <strong>{item.name}</strong>
                      <code>{item.error ? 'Value unavailable' : JSON.stringify(item.value)}</code>
                      <span>
                        {PARAMETER_TYPES[item.type] ?? 'unknown'}
                        {item.descriptor.read_only ? ' · Read-only' : ''}
                        {drafts[item.name] ? ' · Staged' : ''}
                      </span>
                    </button>
                  ))}
              </div>
              {parameter && (
                <section className="de-parameter-editor" aria-label={`Edit parameter ${parameter.name}`}>
                  <button onClick={() => setSelected('')}>
                    <FiArrowLeft />
                    Back to list
                  </button>
                  <h3>{parameter.name}</h3>
                  <span>{PARAMETER_TYPES[parameter.type]}</span>
                  <p>{parameter.descriptor.description || 'No description provided by the node.'}</p>
                  {parameter.descriptor.additional_constraints && <p>{parameter.descriptor.additional_constraints}</p>}
                  {[...parameter.descriptor.integer_range, ...parameter.descriptor.floating_point_range].map(
                    (range, index) => (
                      <p key={index}>
                        Range: {range.from_value} to {range.to_value} · Step: {range.step || 'any'}
                      </p>
                    )
                  )}
                  {parameter.descriptor.dynamic_typing && (
                    <p className="de-muted">Dynamic type; this editor preserves its current type.</p>
                  )}
                  <p>
                    Current value: <code>{JSON.stringify(parameter.value)}</code>
                  </p>
                  {parameter.error && <p className="de-warning">{parameter.error}</p>}
                  {drafts[parameter.name] && draftConflict(drafts[parameter.name], parameter) && (
                    <p className="de-warning">{draftConflict(drafts[parameter.name], parameter)}</p>
                  )}
                  <label>
                    Proposed value
                    {parameter.type === 1 ? (
                      <select
                        ref={element => {
                          editor.current = element;
                        }}
                        aria-label="Proposed value"
                        value={text}
                        onChange={event => setText(event.target.value)}
                        disabled={parameter.descriptor.read_only || applying}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <textarea
                        ref={element => {
                          editor.current = element;
                        }}
                        aria-label="Proposed value"
                        value={text}
                        maxLength={65536}
                        onChange={event => setText(event.target.value)}
                        disabled={
                          parameter.descriptor.read_only || applying || !!parameter.error || parameter.type === 0
                        }
                        rows={parameter.type >= 5 ? 5 : 3}
                      />
                    )}
                  </label>
                  {parameter.type >= 5 && (
                    <p className="de-muted">Enter a JSON array. Byte arrays use numbers from 0 to 255.</p>
                  )}
                  <button
                    disabled={
                      parameter.descriptor.read_only || !!parameter.error || parameter.type === 0 || applying || loading
                    }
                    onClick={stage}
                  >
                    Stage change
                  </button>
                  {drafts[parameter.name] && (
                    <button
                      disabled={applying}
                      onClick={() => {
                        const next = { ...drafts };
                        delete next[parameter.name];
                        updateDrafts(next);
                        setText(formatParameterValue(parameter.value));
                        setError('');
                        setNotice('Edit discarded.');
                      }}
                    >
                      Discard this edit
                    </button>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
