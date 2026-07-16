'use client';

import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResumeStore } from '@/stores/resume-store';
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

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai/chat',
        body: () => ({ resumeId, sessionId: sessionIdRef.current }),
        headers: () => {
          const fp = typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null;
          const headers: Record<string, string> = {};
          if (fp) headers['x-fingerprint'] = fp;
          return headers;
        },
      }),
    [resumeId]
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: sessionId,
    transport,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // Track completed tool call count to detect new tool results
  const completedToolCountRef = useRef(0);

  const reloadResume = useCallback(async () => {
    if (!resumeId) return;
    try {
      const store = useResumeStore.getState();
      // Cancel any pending autosave to prevent overwriting server data
      if (store._saveTimeout) clearTimeout(store._saveTimeout);

      const fp = typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null;
      const res = await fetch(`/api/resume/${resumeId}`, {
        headers: fp ? { 'x-fingerprint': fp } : {},
      });
      if (res.ok) {
        const resume = await res.json();
        useResumeStore.getState().setResume(resume);
      }
    } catch (err) {
      console.error('Failed to reload resume after tool call:', err);
    }
  }, [resumeId]);

  // Reload resume data when new tool results appear during streaming
  useEffect(() => {
    const completedToolCount = messages.reduce((count, m) => {
      if (m.role !== 'assistant' || !m.parts) return count;
      return count + m.parts.filter((p: any) =>
        typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available'
      ).length;
    }, 0);

    if (completedToolCount > completedToolCountRef.current) {
      completedToolCountRef.current = completedToolCount;
      reloadResume();
    }
  }, [messages, reloadResume]);

  // Load initial messages when session changes; sync tool count ref to avoid false reload
  useEffect(() => {
    if (initialMessages) {
      // Pre-calculate tool count from initial messages to avoid triggering a redundant reload
      const initialToolCount = initialMessages.reduce((count, m) => {
        if (m.role !== 'assistant' || !m.parts) return count;
        return count + m.parts.filter((p: any) =>
          typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available'
        ).length;
      }, 0);
      completedToolCountRef.current = initialToolCount;
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

  return {
    messages: allMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    status,
    error,
    clearMessages,
    sendMessage,
  };
}
