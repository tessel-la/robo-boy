import { useLayoutEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';
import type { AssistantMessage, AssistantSettings } from './types';
import type { AssistantVoiceState } from './components/AssistantSpeechTextarea';

/** Native XR renders this view of the existing assistant; credentials never cross the bridge. */
export interface AssistantPresentation {
  read(): {
    open: boolean;
    draft: string;
    messages: readonly AssistantMessage[];
    busy: boolean;
    progress: readonly string[];
    error: string;
    tags: readonly string[];
    voice: AssistantVoiceState;
    settings: Pick<AssistantSettings, 'provider' | 'model' | 'baseUrl' | 'voiceLanguage'> & { hasApiKey: boolean };
  };
  open(): void;
  close(): void;
  setDraft(text: string): void;
  send(): void;
  stop(): void;
  newConversation(): void;
  clearContext(): void;
  startVoice(): void;
  stopVoice(): void;
  cancelVoice(): void;
  configure(
    patch: Partial<Pick<AssistantSettings, 'provider' | 'model' | 'baseUrl' | 'voiceLanguage' | 'apiKey'>>
  ): void;
}
const registry = createPanelPresentationRegistry<AssistantPresentation>();
export const ASSISTANT_PRESENTATION_ID = 'global-assistant';
export const getAssistantPresentation = (scope?: string) => registry.get(ASSISTANT_PRESENTATION_ID, scope);
export function useAssistantPresentation(scope: string | undefined, presentation: AssistantPresentation) {
  const latest = useRef(presentation);
  latest.current = presentation;
  useLayoutEffect(
    () =>
      registry.register(
        ASSISTANT_PRESENTATION_ID,
        {
          read: () => latest.current.read(),
          open: () => latest.current.open(),
          close: () => latest.current.close(),
          setDraft: text => latest.current.setDraft(text),
          send: () => latest.current.send(),
          stop: () => latest.current.stop(),
          startVoice: () => latest.current.startVoice(),
          stopVoice: () => latest.current.stopVoice(),
          cancelVoice: () => latest.current.cancelVoice(),
          configure: patch => latest.current.configure(patch),
          newConversation: () => latest.current.newConversation(),
          clearContext: () => latest.current.clearContext(),
        },
        scope
      ),
    [scope]
  );
}
