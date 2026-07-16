'use client';

import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { generateId } from '@/lib/utils';

interface UseAIChatOptions {
  resumeId: string;
  sessionId?: string;
  initialMessages?: UIMessage[];
}

export function useAIChat({ resumeId, sessionId, initialMessages }: UseAIChatOptions) {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<UIMessage[]>([]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai/chat',
        body: () => ({ resumeId, sessionId }),
        headers: () => {
          const fp = typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null;
          const headers: Record<string, string> = {};
          if (fp) headers['x-fingerprint'] = fp;
          return headers;
        },
      }),
    [resumeId, sessionId]
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: sessionId,
    transport,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // Load initial messages when session changes.
  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    const settings = useSettingsStore.getState();
    const profileId = settings.llmBindings.resume;
    const hasResumeProfile = Boolean(
      profileId && settings.llmProfiles.some((profile) => profile.id === profileId),
    );
    if (!hasResumeProfile) {
      const userMsg: UIMessage = {
        id: generateId(),
        role: 'user',
        parts: [{ type: 'text', text: input }],
      };
      const errorMsg: UIMessage = {
        id: generateId(),
        role: 'assistant',
        parts: [{ type: 'text', text: '__API_KEY_MISSING__' }],
      };
      // Keep these messages separate from useChat state so they never get sent to the server
      setLocalMessages((prev) => [...prev, userMsg, errorMsg]);
      setInput('');
      return;
    }

    // Clear local-only messages when user starts a real conversation
    if (localMessages.length > 0) {
      setLocalMessages([]);
    }

    sendMessage({ text: input });
    setInput('');
  }, [input, sendMessage, localMessages]);

  // Merge real chat messages with local-only display messages
  const allMessages = useMemo(
    () => (localMessages.length > 0 ? [...messages, ...localMessages] : messages),
    [messages, localMessages]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setLocalMessages([]);
  }, [setMessages]);

  const clearInput = useCallback(() => setInput(''), []);

  return {
    messages: allMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    status,
    error,
    clearMessages,
    clearInput,
    sendMessage,
  };
}
