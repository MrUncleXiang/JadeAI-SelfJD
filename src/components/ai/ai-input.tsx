'use client';

import { useTranslations } from 'next-intl';
import { Cpu, SendHorizonal } from 'lucide-react';
import type { FormEvent, ChangeEvent } from 'react';

interface AIInputProps {
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  modelLabel?: string;
}

export function AIInput({ input, onChange, onSubmit, isLoading, modelLabel }: AIInputProps) {
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
          <div className="flex max-w-[210px] items-center gap-1.5 truncate text-[11px] text-zinc-500">
            <Cpu className="h-3 w-3 shrink-0" />
            <span className="truncate">{modelLabel || 'LLM profile required'}</span>
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 [&:not(:disabled)]:bg-brand [&:not(:disabled)]:text-white [&:not(:disabled)]:hover:bg-brand-hover"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
