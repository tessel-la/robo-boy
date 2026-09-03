import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentSpeechTextarea from './AgentSpeechTextarea';

class MockSpeechRecognition {
  static instance: MockSpeechRecognition | null = null;
  continuous = false;
  interimResults = true;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }> }) => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.instance = this;
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();

const SpeechHarness = () => {
  const [value, setValue] = useState('Keep clear');
  return (
    <AgentSpeechTextarea
      id="speech-field"
      label="Robot context"
      value={value}
      onChange={setValue}
      rows={3}
    />
  );
};

describe('AgentSpeechTextarea', () => {
  beforeEach(() => {
    trackStop.mockReset();
    getUserMedia.mockReset();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition,
    });
  });

  afterEach(() => {
    MockSpeechRecognition.instance = null;
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    Reflect.deleteProperty(navigator, 'mediaDevices');
    Reflect.deleteProperty(globalThis, 'MediaRecorder');
  });

  it('requests microphone permission, appends dictated text, and toggles listening', async () => {
    render(<SpeechHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input for Robot context' }));

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Listening'));
    expect(document.querySelectorAll('.bt-agent-listening-wave i')).toHaveLength(4);
    expect(trackStop).toHaveBeenCalledOnce();
    expect(MockSpeechRecognition.instance).toMatchObject({
      continuous: true,
      interimResults: false,
    });
    act(() => {
      MockSpeechRecognition.instance?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'avoid the loading bay' } }],
      });
    });
    expect(screen.getByLabelText('Robot context')).toHaveValue('Keep clear avoid the loading bay');

    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input for Robot context' }));
    expect(MockSpeechRecognition.instance?.stop).toHaveBeenCalledOnce();
  });

  it('shows microphone permission errors', async () => {
    render(<SpeechHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input for Robot context' }));
    await waitFor(() => expect(MockSpeechRecognition.instance).not.toBeNull());
    act(() => MockSpeechRecognition.instance?.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone permission was denied.');
  });

  it('keeps typing available when microphone APIs are unavailable', async () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(navigator, 'mediaDevices');
    render(<SpeechHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input for Robot context' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('requires HTTPS or localhost');
    fireEvent.change(screen.getByLabelText('Robot context'), { target: { value: 'Typed context' } });
    expect(screen.getByLabelText('Robot context')).toHaveValue('Typed context');
  });

  it('records and transcribes audio without opening a file picker', async () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    class MockMediaRecorder {
      static instance: MockMediaRecorder | null = null;
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() { MockMediaRecorder.instance = this; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: MockMediaRecorder });
    const transcribe = vi.fn().mockResolvedValue('dock at station two');
    const Harness = () => {
      const [value, setValue] = useState('');
      return <AgentSpeechTextarea id="recorded" label="Behavior" value={value} onChange={setValue} rows={3} onTranscribeAudio={transcribe} />;
    };
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Start voice input for Behavior' }));
    await screen.findByRole('button', { name: 'Stop voice input for Behavior' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input for Behavior' }));

    await waitFor(() => expect(screen.getByLabelText('Behavior')).toHaveValue('dock at station two'));
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob));
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});
