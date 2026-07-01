import React, { useEffect, useRef, useState } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';

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

interface AgentSpeechTextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  onTranscribeAudio?: (audio: Blob) => Promise<string>;
}

const speechErrorMessage = (code?: string) => {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone permission was denied.';
  if (code === 'audio-capture') return 'No microphone is available.';
  if (code === 'network') return 'Voice recognition could not reach its speech service.';
  if (code === 'language-not-supported') return 'Voice recognition does not support this language.';
  if (code === 'no-speech') return 'No speech was detected.';
  return 'Voice recognition stopped unexpectedly.';
};

const AgentSpeechTextarea: React.FC<AgentSpeechTextareaProps> = ({
  id,
  label,
  value,
  onChange,
  rows,
  placeholder,
  className = '',
  autoFocus,
  textareaRef,
  onTranscribeAudio,
}) => {
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

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

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
    if (typeof MediaRecorder === 'undefined' || !onTranscribeAudio) return false;
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
      if (audio.size > 0) void transcribeRecording(audio);
      else setSpeechError('No audio was recorded.');
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
      if (SpeechRecognition) {
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

  return (
    <div className={`${className} bt-agent-speech-field`.trim()}>
      <label className="bt-agent-field-label" htmlFor={id}>{label}</label>
      <span className="bt-agent-textarea-shell">
        <textarea
          id={id}
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className={`bt-agent-mic${isListening ? ' listening' : ''}`}
          onClick={handleVoiceClick}
          disabled={isRequestingPermission || isTranscribing}
          aria-label={`${isListening ? 'Stop' : 'Start'} voice input for ${label}`}
          aria-pressed={isListening}
          title={isListening ? 'Stop voice input' : 'Start voice input'}
        >
          {isListening ? <FaStop aria-hidden="true" /> : <FaMicrophone aria-hidden="true" />}
        </button>
      </span>
      {isRequestingPermission && <span className="bt-agent-speech-status" role="status">Requesting microphone permission…</span>}
      {isListening && (
        <span className="bt-agent-speech-status is-listening" role="status">
          <span className="bt-agent-listening-wave" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          Listening…
        </span>
      )}
      {isTranscribing && <span className="bt-agent-speech-status" role="status">Transcribing audio…</span>}
      {speechError && <span className="bt-agent-speech-error" role="alert">{speechError}</span>}
    </div>
  );
};

export default AgentSpeechTextarea;
