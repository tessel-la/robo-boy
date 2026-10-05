import type { AssistantProviderId } from '../types';
import { thinkingEfforts, selectedThinkingEffort, type ThinkingEffort } from '../providers/thinking';

interface Props {
  provider: AssistantProviderId;
  model: string;
  subscription?: boolean;
  value?: ThinkingEffort;
  disabled?: boolean;
  onChange: (value: ThinkingEffort | undefined) => void;
}

export default function AssistantThinkingSettings({
  provider,
  model,
  subscription = false,
  value,
  disabled,
  onChange,
}: Props) {
  const efforts = thinkingEfforts(provider, model, subscription);
  if (!efforts.length) return null;
  return (
    <label>
      Thinking effort
      <select
        aria-label="Thinking effort"
        disabled={disabled}
        value={selectedThinkingEffort(provider, model, value, subscription) ?? ''}
        onChange={event => onChange((event.target.value || undefined) as ThinkingEffort | undefined)}
      >
        <option value="">Model default</option>
        {efforts.map(effort => (
          <option key={effort} value={effort}>
            {effort === 'xhigh'
              ? 'Extra high'
              : effort === 'max'
                ? 'Maximum'
                : effort[0].toUpperCase() + effort.slice(1)}
          </option>
        ))}
      </select>
      <span className="assistant-subscription-note">
        Higher effort can take longer and use more tokens or plan allowance. Account limits still apply.
      </span>
    </label>
  );
}
