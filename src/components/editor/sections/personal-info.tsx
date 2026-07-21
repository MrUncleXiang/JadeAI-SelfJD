'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, X, Circle, RectangleVertical, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { EditableText } from '../fields/editable-text';
import { EditableSelect } from '../fields/editable-select';
import { FieldWrapper } from '../fields/field-wrapper';
import { useResumeStore } from '@/stores/resume-store';
import type { Resume, ResumeSection, PersonalInfoContent } from '@/types/resume';

interface Props {
  section: ResumeSection;
  onUpdate: (content: Partial<PersonalInfoContent>) => void;
}

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('jade_fingerprint');
}

function hasEditablePersonalContent(content: PersonalInfoContent) {
  return [
    content.fullName,
    content.jobTitle,
    content.age,
    content.gender,
    content.politicalStatus,
    content.ethnicity,
    content.hometown,
    content.maritalStatus,
    content.yearsOfExperience,
    content.educationLevel,
    content.email,
    content.phone,
    content.wechat,
    content.location,
    content.website,
    content.linkedin,
    content.github,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

function normalizeResumeForStore(resume: Resume): Resume {
  return {
    ...resume,
    sections: resume.sections || [],
    themeConfig: resume.themeConfig || {},
    createdAt: resume.createdAt ? new Date(resume.createdAt) : new Date(),
    updatedAt: resume.updatedAt ? new Date(resume.updatedAt) : new Date(),
  };
}

export function PersonalInfoSection({ section, onUpdate }: Props) {
  const t = useTranslations('editor.fields');
  const tTheme = useTranslations('themeEditor');
  const content = section.content as PersonalInfoContent;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentResume, setResume } = useResumeStore();
  const [syncingProfile, setSyncingProfile] = useState(false);
  const avatarStyle = currentResume?.themeConfig?.avatarStyle || 'oneInch';

  const updateAvatarStyle = (style: 'circle' | 'oneInch') => {
    if (!currentResume) return;
    const newConfig = { ...currentResume.themeConfig, avatarStyle: style };
    useResumeStore.setState((state) => ({
      currentResume: state.currentResume
        ? { ...state.currentResume, themeConfig: newConfig }
        : null,
      isDirty: true,
    }));
    useResumeStore.getState()._scheduleSave();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file, 200);
    onUpdate({ avatar: dataUrl });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const syncAccountProfile = async () => {
    if (!currentResume || syncingProfile) return;
    if (
      hasEditablePersonalContent(content)
      && !window.confirm(t('syncAccountProfileConfirm'))
    ) {
      return;
    }

    setSyncingProfile(true);
    try {
      const store = useResumeStore.getState();
      if (store.isDirty) {
        const saved = await store.save();
        if (!saved) throw new Error(t('syncAccountProfileSaveFailed'));
      }

      const fingerprint = getFingerprint();
      const response = await fetch(`/api/resume/${currentResume.id}/personal-info/apply-profile`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(fingerprint ? { 'x-fingerprint': fingerprint } : {}),
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string; error?: string } | null;
        if (body?.code === 'RESUME_PROFILE_EMPTY') {
          throw new Error(t('syncAccountProfileEmpty'));
        }
        throw new Error(body?.error || t('syncAccountProfileFailed'));
      }
      const updated = await response.json() as Resume;
      setResume(normalizeResumeForStore(updated));
      toast.success(t('syncAccountProfileSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('syncAccountProfileFailed'));
    } finally {
      setSyncingProfile(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t('syncAccountProfileHint')}
          </p>
          <button
            type="button"
            onClick={() => void syncAccountProfile()}
            disabled={syncingProfile || !currentResume}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {syncingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {syncingProfile ? t('syncingAccountProfile') : t('syncAccountProfile')}
          </button>
        </div>
      </div>

      {/* Avatar upload + style toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-zinc-300 bg-zinc-50 transition-colors hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
        >
          {content.avatar ? (
            <img src={content.avatar} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <Camera className="h-6 w-6 text-zinc-400" />
          )}
        </button>
        <div className="flex flex-col gap-2">
          {/* Segmented shape toggle */}
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {([
              { value: 'circle' as const, icon: Circle, label: tTheme('avatarCircle') },
              { value: 'oneInch' as const, icon: RectangleVertical, label: tTheme('avatarOneInch') },
            ]).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => updateAvatarStyle(value)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all duration-200 ${
                  avatarStyle === value
                    ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
          {/* Remove avatar */}
          {content.avatar && (
            <button
              type="button"
              onClick={() => onUpdate({ avatar: '' })}
              className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X className="h-3 w-3" />
              {t('clear')}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />
      </div>

      <FieldWrapper>
        <EditableText label={t('fullName')} value={content.fullName} onChange={(v) => onUpdate({ fullName: v })} />
        <EditableText label={t('jobTitle')} value={content.jobTitle} onChange={(v) => onUpdate({ jobTitle: v })} />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('age')} value={content.age || ''} onChange={(v) => onUpdate({ age: v })} />
        <EditableSelect
          label={t('gender')}
          value={content.gender || ''}
          onChange={(v) => onUpdate({ gender: v })}
          options={t('genderOptions').split(',').map((s) => ({ label: s, value: s }))}
        />
      </FieldWrapper>
      <FieldWrapper>
        <EditableSelect
          label={t('politicalStatus')}
          value={content.politicalStatus || ''}
          onChange={(v) => onUpdate({ politicalStatus: v })}
          options={t('politicalStatusOptions').split(',').map((s) => ({ label: s, value: s }))}
        />
        <EditableSelect
          label={t('ethnicity')}
          value={content.ethnicity || ''}
          onChange={(v) => onUpdate({ ethnicity: v })}
          options={t('ethnicityOptions').split(',').map((s) => ({ label: s, value: s }))}
        />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('hometown')} value={content.hometown || ''} onChange={(v) => onUpdate({ hometown: v })} />
        <EditableSelect
          label={t('maritalStatus')}
          value={content.maritalStatus || ''}
          onChange={(v) => onUpdate({ maritalStatus: v })}
          options={t('maritalStatusOptions').split(',').map((s) => ({ label: s, value: s }))}
        />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('yearsOfExperience')} value={content.yearsOfExperience || ''} onChange={(v) => onUpdate({ yearsOfExperience: v })} />
        <EditableSelect
          label={t('educationLevel')}
          value={content.educationLevel || ''}
          onChange={(v) => onUpdate({ educationLevel: v })}
          options={t('educationLevelOptions').split(',').map((s) => ({ label: s, value: s }))}
        />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('email')} value={content.email} onChange={(v) => onUpdate({ email: v })} type="email" />
        <EditableText label={t('phone')} value={content.phone} onChange={(v) => onUpdate({ phone: v })} type="tel" />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('wechat')} value={content.wechat || ''} onChange={(v) => onUpdate({ wechat: v })} />
        <EditableText label={t('location')} value={content.location} onChange={(v) => onUpdate({ location: v })} />
      </FieldWrapper>
      <FieldWrapper>
        <EditableText label={t('website')} value={content.website || ''} onChange={(v) => onUpdate({ website: v })} />
      </FieldWrapper>

    </div>
  );
}
