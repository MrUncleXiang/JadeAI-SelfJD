'use client';

import type { UIMessage } from 'ai';
import { useTranslations } from 'next-intl';
import { X, Sparkles, Plus, Trash2, Clock, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEditorStore } from '@/stores/editor-store';
import { useResumeStore } from '@/stores/resume-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAIChat } from '@/hooks/use-ai-chat';
import { useMessagePagination } from '@/hooks/use-message-pagination';
import { AIMessage } from './ai-message';
import { AIInput } from './ai-input';
import { ResumeChangeReview } from './resume-change-review';

interface ChatSession {
  id: string;
  title: string;
  updatedAt: Date | number | null;
}

interface AIChatContentProps {
  resumeId: string;
  hideTitle?: boolean;
  initialChangeReviewOpen?: boolean;
  initialChangeSetId?: string;
}

function getHeaders(): Record<string, string> {
  const fp = typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null;
  return fp ? { 'x-fingerprint': fp, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function formatTime(date: Date | number | null) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} · ${h}:${min}`;
}

/** Headless chat body — reusable in both side panel and floating bubble */
export function AIChatContent({
  resumeId,
  hideTitle,
  initialChangeReviewOpen = false,
  initialChangeSetId,
}: AIChatContentProps) {
  const t = useTranslations('ai');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>();
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changeReviewOpen, setChangeReviewOpen] = useState(initialChangeReviewOpen);
  const [changeReviewRefreshKey, setChangeReviewRefreshKey] = useState(0);
  const [isProposing, setIsProposing] = useState(false);

  useEffect(() => {
    if (initialChangeReviewOpen) setChangeReviewOpen(true);
  }, [initialChangeReviewOpen]);

  const { historicalMessages, hasMore, isLoadingMore, loadInitial, loadMore, reset: resetPagination } = useMessagePagination();

  const boundResumeProfile = useSettingsStore((state) => {
    const profileId = state.llmBindings.resume;
    return state.llmProfiles.find((profile) => profile.id === profileId) || null;
  });

  // Fetch sessions for resumeId; reset state synchronously first so stale
  // sessionsLoaded/activeSessionId can't leak a pendingAiMessage to the wrong resume.
  useEffect(() => {
    setSessionsLoaded(false);
    setActiveSessionId(undefined);
    setSessions([]);
    setInitialMessages(undefined);
    resetPagination();

    let cancelled = false;
    const headers = getHeaders();
    fetch(`/api/ai/chat/sessions?resumeId=${resumeId}`, { headers })
      .then((res) => res.json())
      .then(async (data: { sessions: ChatSession[] }) => {
        if (cancelled) return;
        if (data.sessions.length > 0) {
          setSessions(data.sessions);
          const mostRecent = data.sessions[0];
          setActiveSessionId(mostRecent.id);
          const msgs = await loadInitial(mostRecent.id);
          if (cancelled) return;
          setInitialMessages(msgs);
        } else if (!cancelled) {
          await createNewSession(true);
        }
        if (!cancelled) setSessionsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSessionsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  const createNewSession = useCallback(async (isInitial = false) => {
    const headers = getHeaders();
    try {
      const res = await fetch('/api/ai/chat/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ resumeId }),
      });
      const data = await res.json();
      const newSession = data.session;
      if (newSession) {
        setSessions((prev) => [{ id: newSession.id, title: newSession.title, updatedAt: newSession.updatedAt }, ...prev]);
        setActiveSessionId(newSession.id);
        resetPagination();
        setInitialMessages([]);
        if (isInitial) {
          setSessionsLoaded(true);
        }
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [resumeId, resetPagination]);

  const switchSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setHistoryOpen(false);
    const msgs = await loadInitial(sessionId);
    setInitialMessages(msgs);
  }, [activeSessionId, loadInitial]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const headers = getHeaders();
    try {
      await fetch(`/api/ai/chat/sessions/${sessionId}`, { method: 'DELETE', headers });
    } catch (err) {
      console.error('Failed to delete session:', err);
      return;
    }

    // Remove from state (pure updater — no side effects)
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));

    // Handle active session switch outside the updater to avoid Strict Mode double-invocation
    if (sessionId === activeSessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (remaining.length > 0) {
        const nextId = remaining[0].id;
        setActiveSessionId(nextId);
        loadInitial(nextId).then((msgs) => setInitialMessages(msgs));
      } else {
        await createNewSession();
      }
    }
  }, [activeSessionId, sessions, loadInitial, createNewSession]);

  const {
    messages: chatMessages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
    isLoading,
    status,
    error: chatError,
    sendMessage,
    clearInput,
  } = useAIChat({
    resumeId,
    sessionId: activeSessionId,
    initialMessages,
  });

  // Show toast when AI API call fails
  const lastErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (chatError && chatError !== lastErrorRef.current) {
      lastErrorRef.current = chatError;
      const msg = chatError.message || t('errorMessage');
      // Show a user-friendly message for common errors
      if (msg.includes('ETIMEDOUT') || msg.includes('Cannot connect')) {
        toast.error(t('errorMessage'), { description: 'API 连接超时，请检查网络或 API 配置' });
      } else if (msg.includes('INVALID_MODEL_OUTPUT')) {
        toast.error(t('errorMessage'), { description: t('proposalInvalidOutput') });
      } else {
        toast.error(t('errorMessage'), { description: msg.length > 200 ? msg.slice(0, 200) + '...' : msg });
      }
    }
  }, [chatError, t]);

  // Handle pending AI message from other components (e.g. grammar check one-click fix)
  const pendingAiMessage = useEditorStore((s) => s.pendingAiMessage);
  const setPendingAiMessage = useEditorStore((s) => s.setPendingAiMessage);
  useEffect(() => {
    if (pendingAiMessage && sessionsLoaded && activeSessionId) {
      sendMessage({ text: pendingAiMessage });
      setPendingAiMessage(null);
    }
  }, [pendingAiMessage, sessionsLoaded, activeSessionId, sendMessage, setPendingAiMessage]);

  // Merge historical (paginated older) + chat (current session) messages, dedup by id
  const displayMessages = useMemo(() => {
    if (historicalMessages.length === 0) return chatMessages;
    const chatIds = new Set(chatMessages.map((m) => m.id));
    const olderOnly = historicalMessages.filter((m) => !chatIds.has(m.id));
    return [...olderOnly, ...chatMessages];
  }, [historicalMessages, chatMessages]);

  // Wrap handleSubmit to update session title on first message
  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession && activeSession.title === '新对话' && input.trim()) {
      const newTitle = input.trim().slice(0, 50);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, title: newTitle } : s))
      );
    }
    originalHandleSubmit(e);
  }, [sessions, activeSessionId, input, originalHandleSubmit]);

  const createProposal = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || isProposing) return;
    if (!boundResumeProfile) {
      toast.error(t('apiKeyMissing'), { description: t('apiKeyMissingHint') });
      return;
    }

    setIsProposing(true);
    try {
      // Flush local edits first so the proposal is based on the same immutable version
      // the user currently sees in the editor.
      const saved = await useResumeStore.getState().save();
      if (!saved) throw new Error(t('proposalSaveFailed'));
      const response = await fetch(`/api/resumes/${resumeId}/change-sets`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ instruction }),
      });
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = await response.json() as { error?: string; code?: string };
          detail = body.error || body.code || detail;
        } catch { /* keep HTTP detail */ }
        throw new Error(detail);
      }
      clearInput();
      setChangeReviewRefreshKey((value) => value + 1);
      setChangeReviewOpen(true);
      toast.success(t('proposalCreated'));
    } catch (error) {
      toast.error(t('proposalFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsProposing(false);
    }
  }, [boundResumeProfile, clearInput, input, isProposing, resumeId, t]);

  // Smart auto-scroll: only scroll to bottom when user is near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, isLoading]);

  // Track scroll position + trigger loadMore on scroll near top
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
      if (scrollTop < 50 && hasMore && !isLoadingMore) {
        loadMore(scrollRef);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, isLoadingMore, loadMore]);

  return (
    <>
      {/* Header bar */}
      <div className={`flex items-center ${hideTitle ? 'justify-end' : 'justify-between'} border-b px-4 py-3`}>
        {!hideTitle && (
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-zinc-900">{t('panelTitle')}</h3>
          </div>
        )}
        <div className="flex items-center gap-1">
          <ResumeChangeReview
            resumeId={resumeId}
            open={changeReviewOpen}
            onOpenChange={setChangeReviewOpen}
            refreshKey={changeReviewRefreshKey}
            initialChangeSetId={initialChangeSetId}
          />

          {/* History popover */}
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 cursor-pointer p-0"
              >
                <Clock className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0" sideOffset={8}>
              <div className="max-h-80 overflow-y-auto">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="group flex cursor-pointer items-start gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 hover:bg-zinc-50"
                    onClick={() => switchSession(session.id)}
                  >
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800">
                        {session.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {formatTime(session.updatedAt)}
                      </p>
                    </div>
                    <button
                      className="mt-0.5 hidden shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 group-hover:block"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {sessions.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-400">
                    {t('defaultGreeting')}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 cursor-pointer p-0"
            onClick={() => createNewSession()}
            title={t('newChat')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="py-2 text-center text-xs text-zinc-400">
              {t('loadingMore')}
            </div>
          )}
          {hasMore && !isLoadingMore && (
            <button
              className="w-full py-2 text-center text-xs text-zinc-400 hover:text-zinc-600"
              onClick={() => loadMore(scrollRef)}
            >
              {t('loadMore')}
            </button>
          )}
          {displayMessages.length === 0 && (
            <div className="rounded-xl bg-gradient-to-br from-brand-muted to-brand-muted p-3 text-[13px] text-brand">
              {t('defaultGreeting')}
            </div>
          )}
          {displayMessages.map((message) => (
            <AIMessage key={message.id} message={message} />
          ))}
          {status === 'submitted' && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:300ms]" />
              </span>
              {t('thinking')}
            </div>
          )}
          {chatError && status !== 'streaming' && status !== 'submitted' && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
              {t('errorMessage')}
            </div>
          )}
        </div>
      </div>

      <AIInput
        input={input}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        isProposing={isProposing}
        onPropose={() => void createProposal()}
        modelLabel={boundResumeProfile?.modelName}
      />
    </>
  );
}

/** Side-panel wrapper (backward compat) */
export function AIChatPanel({ resumeId }: { resumeId: string }) {
  const { toggleAiChat } = useEditorStore();

  return (
    <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l bg-white">
      <AIChatContent resumeId={resumeId} />
      {/* Close button overlaid on the header */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1 h-7 w-7 cursor-pointer p-0"
        onClick={toggleAiChat}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
