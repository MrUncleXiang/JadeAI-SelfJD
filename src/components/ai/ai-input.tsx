'use client';

import { useTranslations } from 'next-intl';
import { Cpu, FileDiff, LoaderCircle, SendHorizonal } from 'lucide-react';
import type { FormEvent, ChangeEvent } from 'react';

interface AIInputProps {
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  isProposing?: boolean;
  onPropose?: () => void;
  modelLabel?: string;
}

export function AIInput({
  input,
  onChange,
  onSubmit,
  isLoading,
  isProposing = false,
  onPropose,
  modelLabel,
}: AIInputProps) {
  const t = useTranslations('ai');

  return (
    <form onSubmit={onSubmit} className="p-3">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 transition-colors focus-within:border-zinc-300 focus-within:bg-white">
        {/* Textarea */}
        <textarea
          value={input}
          onChange={onChange}
          placeholder={t('placeholder')}
          rows={2}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const form = e.currentTarget.closest('form');
              if (form) form.requestSubmit();
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex max-w-[105px] items-center gap-1.5 truncate text-[11px] text-zinc-500">
            <Cpu className="h-3 w-3 shrink-0" />
            <span className="truncate">{modelLabel || 'LLM profile required'}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {onPropose && (
              <button
                type="button"
                disabled={isLoading || isProposing || !input.trim()}
                className="flex h-8 cursor-pointer items-center gap-1 rounded-full border border-brand/30 bg-brand-muted px-2.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-40"
                title={t('generateProposalHint')}
                onClick={onPropose}
              >
                {isProposing
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <FileDiff className="h-3.5 w-3.5" />}
                {t('generateProposal')}
              </button>
            )}

            {/* Conversational send button — never writes directly to the resume. */}
            <button
              type="submit"
              disabled={isLoading || isProposing || !input.trim()}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 [&:not(:disabled)]:bg-brand [&:not(:disabled)]:text-white [&:not(:disabled)]:hover:bg-brand-hover"
              title={t('send')}
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
