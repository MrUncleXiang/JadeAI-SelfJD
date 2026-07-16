import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Resume } from '@/types/resume';

import { useResumeStore } from './resume-store';

function fixture(): Resume {
  const now = new Date('2026-07-16T00:00:00.000Z');
  return {
    id: 'resume-save-test',
    userId: 'user-save-test',
    title: 'Resume',
    template: 'classic',
    themeConfig: {
      primaryColor: '#000000',
      accentColor: '#000000',
      fontFamily: 'sans',
      fontSize: 'medium',
      lineSpacing: 1.5,
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
      sectionSpacing: 12,
    },
    isDefault: false,
    language: 'zh',
    sections: [{
      id: 'summary',
      resumeId: 'resume-save-test',
      type: 'summary',
      title: 'Summary',
      sortOrder: 0,
      visible: true,
      content: { text: 'Current summary' },
      createdAt: now,
      updatedAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

describe('resume store save gate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
    useResumeStore.getState().reset();
    useResumeStore.getState().setResume(fixture());
    useResumeStore.setState({ isDirty: true });
  });

  afterEach(() => {
    useResumeStore.getState().reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('only clears dirty state after an accepted server save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    await expect(useResumeStore.getState().save()).resolves.toBe(true);
    expect(useResumeStore.getState().isDirty).toBe(false);
  });

  it('keeps the resume dirty when the server rejects the save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'SAVE_REJECTED' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(useResumeStore.getState().save()).resolves.toBe(false);
    expect(useResumeStore.getState().isDirty).toBe(true);
  });

  it('does not clear edits made while an earlier snapshot is saving', async () => {
    let completeRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      completeRequest = resolve;
    })));

    const saving = useResumeStore.getState().save();
    const current = useResumeStore.getState().currentResume!;
    useResumeStore.setState({
      currentResume: { ...current, title: 'Edited during save' },
      isDirty: true,
    });
    completeRequest(new Response('{}', { status: 200 }));

    await expect(saving).resolves.toBe(false);
    expect(useResumeStore.getState()).toMatchObject({
      isDirty: true,
      currentResume: { title: 'Edited during save' },
    });
  });
});
