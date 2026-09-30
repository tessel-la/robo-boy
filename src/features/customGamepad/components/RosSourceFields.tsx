import React from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import type { FieldKind, MessageFieldOption, TopicInfo } from '../rosMessageUtils';

interface TopicPickerProps {
  topic: string;
  /** The topics offered in the list, already narrowed to what the component can use. */
  topics: readonly TopicInfo[];
  messageType: string;
  isLoading: boolean;
  /** ROS reported topics at all (the list may still be empty after narrowing). */
  hasRosTopics: boolean;
  errorMessage?: string;
  onSelect: (topic: string) => void;
  onCustomChange: (topic: string) => void;
}

/** A topic from what ROS reports, or typed in: the one topic control every component's settings use. */
export const TopicPicker: React.FC<TopicPickerProps> = ({
  topic,
  topics,
  messageType,
  isLoading,
  hasRosTopics,
  errorMessage,
  onSelect,
  onCustomChange,
}) => (
  <div className="setting-group">
    <label htmlFor="topic-select">Topic</label>
    <div className="topic-input-group">
      <div className="topic-input-option">
        <span className="topic-input-label">Available topics</span>
        <select
          id="topic-select"
          value={topic}
          onChange={(event) => onSelect(event.target.value)}
          className="setting-select topic-select"
          disabled={isLoading}
        >
          <option value="">{isLoading ? 'Loading topics...' : 'Select existing topic...'}</option>
          {topics.length > 0 ? (
            topics.map(topicInfo => (
              <option key={topicInfo.name} value={topicInfo.name}>
                {topicInfo.name} ({topicInfo.type})
              </option>
            ))
          ) : messageType ? (
            <option disabled>No {messageType} topics found</option>
          ) : (
            <option disabled>Select message type first</option>
          )}
        </select>
      </div>
      <span className="topic-input-separator">or</span>
      <div className="topic-input-option">
        <label className="topic-input-label" htmlFor="topic-custom">Custom topic</label>
        <input
          id="topic-custom"
          type="text"
          value={topic}
          onChange={(event) => onCustomChange(event.target.value)}
          placeholder="/robot/control"
          className="setting-input topic-input"
        />
      </div>
    </div>
    {errorMessage ? (
      <div className="error-message-inline">
        <div className="error-content-inline">
          <FiAlertTriangle className="error-icon" aria-hidden="true" />
          <span className="error-text">{errorMessage}</span>
        </div>
      </div>
    ) : (
      <>
        {messageType && topics.length === 0 && hasRosTopics && !isLoading && (
          <div className="topic-warning">
            No existing topics found for {messageType}. Please enter a custom topic name below.
          </div>
        )}
        {messageType && !hasRosTopics && !isLoading && (
          <div className="topic-warning">
            No topics available from ROS. Make sure ROS is connected and topics are being published.
          </div>
        )}
      </>
    )}
  </div>
);

interface MessageTypeInputProps {
  value: string;
  /** Types offered as suggestions; any other can be typed. */
  suggestions: readonly string[];
  help: string;
  onChange: (messageType: string) => void;
}

/** A message type typed in, with the common ones and the ones ROS reports offered as suggestions. */
export const MessageTypeInput: React.FC<MessageTypeInputProps> = ({ value, suggestions, help, onChange }) => (
  <div className="setting-group">
    <label htmlFor="message-type">Message type</label>
    <input
      id="message-type"
      type="text"
      list="message-type-suggestions"
      value={value}
      onChange={(event) => onChange(event.target.value.trim())}
      placeholder="e.g. std_msgs/msg/Float64"
      className="setting-input"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
    <datalist id="message-type-suggestions">
      {suggestions.map(type => <option key={type} value={type} />)}
    </datalist>
    <small className="axis-help-text">{help}</small>
  </div>
);

const KIND_LABELS: Record<FieldKind, string> = { number: 'numeric', bool: 'true/false', string: 'text' };

interface FieldPickerProps {
  value: string;
  /** Every field the message type is known to have; the picker lists those of the kinds the component uses. */
  fields: readonly MessageFieldOption[];
  kinds: readonly FieldKind[];
  messageType: string;
  isLoading: boolean;
  direction: 'subscribe' | 'publish';
  onChange: (path: string) => void;
}

/** One field of the message: picked from the fields of a usable kind, or a path typed in for anything else. */
export const FieldPicker: React.FC<FieldPickerProps> = ({ value, fields, kinds, messageType, isLoading, direction, onChange }) => {
  const options = fields.filter(field => kinds.includes(field.kind));
  const kindText = kinds.map(kind => KIND_LABELS[kind]).join(', ');
  return (
    <div className="setting-group">
      <label htmlFor="value-field-select">{direction === 'publish' ? 'Field to send' : 'Field to show'}</label>
      <div className="topic-input-group">
        <div className="topic-input-option">
          <span className="topic-input-label">{isLoading ? 'Reading fields…' : 'Message fields'}</span>
          <select
            id="value-field-select"
            value={options.some(option => option.path === value) ? value : ''}
            onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
            className="setting-select topic-select"
            disabled={isLoading || options.length === 0}
          >
            <option value="">
              {options.length > 0 ? 'Select a field...' : messageType ? `No ${kindText} fields known` : 'Enter a message type first'}
            </option>
            {options.map(option => (
              <option key={option.path} value={option.path}>{option.path} ({option.rosType})</option>
            ))}
          </select>
        </div>
        <span className="topic-input-separator">or</span>
        <div className="topic-input-option">
          <label className="topic-input-label" htmlFor="value-field-custom">Field path</label>
          <input
            id="value-field-custom"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value.trim())}
            placeholder="data or twist.linear.x"
            className="setting-input topic-input"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </div>
      <small className="axis-help-text">
        Uses {kindText} fields. Nested fields are separated by dots; array elements take an index, as in position[0].
      </small>
    </div>
  );
};
