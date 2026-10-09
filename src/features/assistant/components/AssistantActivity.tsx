import type { AgentEvent } from '../runtime/session';
import { AssistantDisclosure } from './AssistantDisclosure';
import { AssistantTaskPlan } from './AssistantTaskPlan';

const statusLabels: Record<AgentEvent['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Canceled',
  paused: 'Paused',
};

/** One treatment for live and completed tool activity. Details stay in the transcript,
 * not the fixed composer, so a long task cannot displace the conversation on a phone. */
export function AssistantActivity({
  events,
  live = false,
  modelResponding = false,
}: {
  events: AgentEvent[];
  live?: boolean;
  modelResponding?: boolean;
}) {
  if (!events.length) return null;
  const activity = events.filter(event => event.type !== 'usage' && !event.tasks);
  const usage = events.filter(event => event.type === 'usage');
  const waitingForAnswer = activity.some(event => event.type === 'question' && event.status === 'running');
  const current = live
    ? [...activity]
        .reverse()
        .find(event => event.type !== 'question' && (event.status === 'running' || event.status === 'paused'))
    : undefined;
  const plan = [...events].reverse().find(event => event.tasks?.length);
  const eventLabel = (event: AgentEvent) => (event.type === 'tool' ? event.label.replace(/_/g, ' ') : event.label);
  return (
    <>
      {plan && <AssistantTaskPlan event={plan} live={live} />}
      {current && (
        <p className="assistant-current-activity">
          {statusLabels[current.status]}: {eventLabel(current)}
        </p>
      )}
      {live && !current && !modelResponding && !waitingForAnswer && (
        <p className="assistant-current-activity" role="status">
          Waiting for the model…
        </p>
      )}
      {activity.length > 0 && (
        <AssistantDisclosure className="assistant-tool-events" summary={`Agent activity (${activity.length})`}>
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
                    <AssistantDisclosure summary={heading}>
                      <pre tabIndex={0}>{event.detail}</pre>
                    </AssistantDisclosure>
                  ) : (
                    <div className="assistant-event-heading">{heading}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </AssistantDisclosure>
      )}
      {usage.length > 0 && (
        <AssistantDisclosure
          className="assistant-tool-events assistant-usage-events"
          summary={`Model usage (${usage.length} ${usage.length === 1 ? 'request' : 'requests'})`}
        >
          <ul>
            {usage.map(event => (
              <li key={event.id}>{event.detail ?? 'Token counts unavailable.'}</li>
            ))}
          </ul>
        </AssistantDisclosure>
      )}
    </>
  );
}
