import React, { useEffect, useRef, useState } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';

// Relocated near-verbatim from the former behaviorTree/components/AgentSpeechTextarea.tsx — this
// widget is generic (voice-to-text into a textarea), not BT-specific. CSS classes renamed from
// `bt-agent-*` to `assistant-*`; styles live in AssistantPanel.css (this component owns no CSS of
// its own, matching the original).

interface SpeechRecognitionResultLike {
  isFinal?: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

interface AssistantSpeechTextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onTranscribeAudio?: (audio: Blob) => Promise<string>;
  /** Grow the textarea with its content instead of scrolling inside a fixed box. */
  autoGrow?: boolean;
  /**
   * Keeps the recording as an attachment instead of transcribing it. When given, the microphone
   * records rather than dictating, and the clip is handed over on stop -- the user can play it back
   * and send the audio itself, or convert it to text from the attachment.
   */
  onRecordAudio?: (audio: Blob, durationSeconds: number) => void;
  /**
   * Renders a control row under the textarea. The voice button joins `start` there instead of
   * sitting inside the textarea, so a composer can group it with its own tools.
   */
  toolbar?: { start?: React.ReactNode; end?: React.ReactNode };
  /**
   * A copy of `value` rendered behind the textarea so parts of the draft can be highlighted. A
   * textarea cannot style its own content; the backdrop supplies the marks and the real text sits
   * on top of them, so it must lay out identically (same font, padding, wrapping, scroll).
   */
  highlight?: React.ReactNode;
}

const speechErrorMessage = (code?: string) => {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone permission was denied.';
  if (code === 'audio-capture') return 'No microphone is available.';
  if (code === 'network') return 'Voice recognition could not reach its speech service.';
  if (code === 'language-not-supported') return 'Voice recognition does not support this language.';
  if (code === 'no-speech') return 'No speech was detected.';
  return 'Voice recognition stopped unexpectedly.';
};

const AssistantSpeechTextarea: React.FC<AssistantSpeechTextareaProps> = ({
  id,
  label,
  value,
  onChange,
  rows,
  placeholder,
  className = '',
  autoFocus,
  textareaRef,
  onKeyDown,
  onTranscribeAudio,
  autoGrow,
  toolbar,
  highlight,
  onRecordAudio,
}) => {
  const textareaNodeRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const valueRef = useRef(value);
  const [isListening, setIsListening] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const speechWindow = typeof window === 'undefined' ? null : (window as SpeechWindow);
  const SpeechRecognition = speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition;

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const node = textareaNodeRef.current;
    if (!autoGrow || !node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [autoGrow, value]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
    },
    []
  );

  const appendTranscript = (transcript: string) => {
    const current = valueRef.current.trimEnd();
    const next = current ? `${current} ${transcript}` : transcript;
    valueRef.current = next;
    onChange(next);
  };

  const transcribeRecording = async (audio: Blob) => {
    if (!onTranscribeAudio) return;
    setIsTranscribing(true);
    try {
      const transcript = (await onTranscribeAudio(audio)).trim();
      if (!transcript) throw new Error('The speech model returned an empty transcript.');
      appendTranscript(transcript);
    } catch (cause) {
      setSpeechError(cause instanceof Error ? cause.message : 'Audio transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const stopListening = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    } else {
      recognitionRef.current?.stop();
    }
  };

  const startRecognition = () => {
    if (!SpeechRecognition) return false;
    setSpeechError('');

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = event => {
      setIsListening(false);
      recognitionRef.current = null;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setSpeechError(speechErrorMessage(event.error));
      } else if (event.error !== 'aborted') {
        setSpeechError(speechErrorMessage(event.error));
      }
    };
    recognition.onresult = event => {
      const transcripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (transcript && result.isFinal !== false) transcripts.push(transcript);
      }
      if (transcripts.length === 0) return;
      appendTranscript(transcripts.join(' '));
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setSpeechError('Voice recognition is already active.');
      return false;
    }
    return true;
  };

  const startRecording = (stream: MediaStream) => {
    if (typeof MediaRecorder === 'undefined' || (!onTranscribeAudio && !onRecordAudio)) return false;
    const startedAt = Date.now();
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    streamRef.current = stream;
    audioChunksRef.current = [];
    recorder.ondataavailable = event => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach(track => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
      setIsListening(false);
      if (audio.size === 0) {
        setSpeechError('No audio was recorded.');
        return;
      }
      if (onRecordAudio) onRecordAudio(audio, Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
      else void transcribeRecording(audio);
    };
    recorder.start();
    setIsListening(true);
    return true;
  };

  const startListening = async () => {
    setSpeechError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setSpeechError('Microphone access requires HTTPS or localhost in this browser.');
      return;
    }
    setIsRequestingPermission(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (SpeechRecognition && !onRecordAudio) {
        stream.getTracks().forEach(track => track.stop());
        startRecognition();
      } else if (!startRecording(stream)) {
        stream.getTracks().forEach(track => track.stop());
        setSpeechError('This browser cannot record or recognize speech.');
      }
    } catch (cause) {
      const error = cause as DOMException;
      setSpeechError(
        error?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access and try again.'
          : error?.name === 'NotFoundError'
            ? 'No microphone is available.'
            : 'Could not access the microphone.'
      );
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const handleVoiceClick = () => {
    if (isListening) {
      stopListening();
    } else {
      void startListening();
    }
  };

  const busyStatus = isRequestingPermission
    ? 'Waiting for microphone…'
    : isListening
      ? onRecordAudio ? 'Recording' : 'Listening'
      : isTranscribing
        ? 'Transcribing…'
        : '';

  const voiceButton = (
    <button
      type="button"
      className={`assistant-mic${isListening ? ' listening' : ''}`}
      onClick={handleVoiceClick}
      disabled={isRequestingPermission || isTranscribing}
      aria-label={`${isListening ? 'Stop' : 'Start'} voice input for ${label}`}
      aria-pressed={isListening}
      title={isListening ? 'Stop voice input' : 'Start voice input'}
    >
      {isListening ? <FaStop aria-hidden="true" /> : <FaMicrophone aria-hidden="true" />}
    </button>
  );

  return (
    <div className={`${className} assistant-speech-field`.trim()}>
      <label className="assistant-field-label" htmlFor={id}>
        {label}
      </label>
      <span className={`assistant-textarea-shell${toolbar ? ' has-toolbar' : ''}${highlight ? ' has-highlight' : ''}`}>
        {highlight ? <div className="assistant-textarea-highlight" ref={highlightRef} aria-hidden="true">{highlight}</div> : null}
        <textarea
          id={id}
          ref={node => {
            textareaNodeRef.current = node;
            if (textareaRef) (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
          }}
          rows={rows}
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={highlight ? event => { if (highlightRef.current) highlightRef.current.scrollTop = event.currentTarget.scrollTop; } : undefined}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        {!toolbar && voiceButton}
      </span>
      {toolbar && (
        <div className="assistant-speech-toolbar">
          {/* The status takes the tools' place inside this fixed-height row rather than adding a
              row of its own, so starting to talk never resizes the composer under the transcript. */}
          {busyStatus ? (
            <div className="assistant-speech-toolbar-start">
              {voiceButton}
              <span className={`assistant-speech-status${isListening ? ' is-listening' : ''}`} role="status">
                {isListening && (
                  <span className="assistant-listening-wave" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                {busyStatus}
              </span>
            </div>
          ) : (
            <div className="assistant-speech-toolbar-start">
              {toolbar.start}
              {voiceButton}
            </div>
          )}
          {toolbar.end}
        </div>
      )}
      {!toolbar && busyStatus && (
        <span className={`assistant-speech-status${isListening ? ' is-listening' : ''}`} role="status">
          {isListening && (
            <span className="assistant-listening-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
          {busyStatus}
        </span>
      )}
      {speechError && (
        <span className="assistant-speech-error" role="alert">
          {speechError}
        </span>
      )}
    </div>
  );
};

export default AssistantSpeechTextarea;
