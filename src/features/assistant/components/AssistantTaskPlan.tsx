import { FaCheckCircle, FaCircle, FaClock, FaExclamationCircle, FaDotCircle } from 'react-icons/fa';
import type { AgentEvent } from '../runtime/session';
import { AssistantDisclosure } from './AssistantDisclosure';

const states = {
  done: { label: 'Done', Icon: FaCheckCircle },
  running: { label: 'In progress', Icon: FaDotCircle },
  pending: { label: 'Pending', Icon: FaCircle },
  waiting: { label: 'Waiting for approval/input', Icon: FaClock },
  blocked: { label: 'Blocked', Icon: FaExclamationCircle },
};
export function AssistantTaskPlan({ event, live }: { event: AgentEvent; live: boolean }) {
  const tasks = event.tasks ?? [];
  if (!tasks.length) return null;
  const complete = tasks.filter(task => task.status === 'done').length;
  return (
    <AssistantDisclosure
      className="assistant-task-plan"
      defaultOpen={live || complete < tasks.length}
      summary={
        <span>
          Tasks{' '}
          <strong>
            {complete}/{tasks.length}
          </strong>
          {!live && complete < tasks.length && <small> · unfinished</small>}
        </span>
      }
    >
      <ol aria-label="Task checklist">
        {tasks.map(task => {
          const status = task.status === 'running' && !live ? 'pending' : task.status;
          const { label, Icon } = states[status] ?? states.pending;
          return (
            <li key={task.id} className={`is-${status}`}>
              <Icon aria-hidden="true" />
              <div>
                <span>{task.label}</span>
                <small>{label}</small>
                {task.evidence && <small className="assistant-task-evidence">{task.evidence}</small>}
              </div>
            </li>
          );
        })}
      </ol>
    </AssistantDisclosure>
  );
}
