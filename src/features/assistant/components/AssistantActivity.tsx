import type { AgentEvent } from '../runtime/session';

const statusLabels: Record<AgentEvent['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Canceled',
  paused: 'Paused',
};

/** One treatment for live and completed tool activity. Details stay in the transcript,
 * not the fixed composer, so a long task cannot displace the conversation on a phone. */
export function AssistantActivity({ events }: { events: AgentEvent[] }) {
  if (!events.length) return null;
  const activity = events.filter(event => event.type !== 'usage');
  const usage = events.filter(event => event.type === 'usage');
  const current = [...events].reverse().find(event => event.status === 'running' || event.status === 'paused');
  const eventLabel = (event: AgentEvent) => (event.type === 'tool' ? event.label.replace(/_/g, ' ') : event.label);
  return (
    <>
      {current && (
        <p className="assistant-current-activity">
          {statusLabels[current.status]}: {eventLabel(current)}
        </p>
      )}
      {activity.length > 0 && <details className="assistant-tool-events">
        <summary>Agent activity ({activity.length})</summary>
        <ol className="assistant-event-list">
          {activity.map(event => {
            const label = eventLabel(event);
            const title = `${event.type === 'child' ? 'Investigation: ' : ''}${label}`;
            const heading = (
              <>
                <span className="assistant-event-label">{title}</span>
                <span className={`assistant-event-status is-${event.status}`}>{statusLabels[event.status]}</span>
              </>
            );
            return (
              <li key={event.id}>
                {event.detail ? (
                  <details>
                    <summary>{heading}</summary>
                    <pre tabIndex={0}>{event.detail}</pre>
                  </details>
                ) : (
                  <div className="assistant-event-heading">{heading}</div>
                )}
              </li>
            );
          })}
        </ol>
      </details>}
      {usage.length > 0 && <details className="assistant-tool-events assistant-usage-events"><summary>Model usage ({usage.length} {usage.length === 1 ? 'request' : 'requests'})</summary><ul>{usage.map(event => <li key={event.id}>{event.detail ?? 'Token counts unavailable.'}</li>)}</ul></details>}
    </>
  );
}
