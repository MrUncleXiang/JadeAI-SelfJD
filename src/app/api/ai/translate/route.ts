import { NextRequest } from 'next/server';
import { generateText, type LanguageModel } from 'ai';
import { getModel, getJsonProviderOptions, AIConfigError, type AIConfig } from '@/lib/ai/provider';
import { resolveLlmConfig } from '@/lib/llm/resolver';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { translateInputSchema } from '@/lib/ai/translate-schema';
import { extractJson } from '@/lib/ai/extract-json';
import { z } from 'zod/v4';
import { resumeChangeService, ResumeChangeServiceError } from '@/lib/resume-patch/service';
import { parseResumeSnapshot, type ResumeSnapshotSection } from '@/lib/resume-patch/snapshot';
import { buildTranslationResumePatch, type TranslatedResumeSection } from '@/lib/resume-patch/translation';

type SectionForTranslation = {
  sectionId: string;
  type: string;
  title: string;
  content: unknown;
};

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
};

/** Fields to strip before sending to AI (e.g. base64 avatar), keyed by section type */
const STRIP_FIELDS: Record<string, string[]> = {
  personal_info: ['avatar'],
};

const MAX_CONCURRENCY = 4;
const TRANSLATE_PROMPT_VERSION = 'resume-translate-v1-change-set';

const singleSectionSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  content: z.any(),
});

function getSectionTranslatePrompt(targetLanguage: string): string {
  const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

  return `You are a professional resume translator. Translate the given resume section into ${langName}.

Rules:
- Use professional, formal ${langName} appropriate for resumes
- Translate job titles, descriptions, and achievements naturally
- Keep proper nouns in their commonly recognized form. If no standard translation exists, keep original
- Dates remain in the same format (YYYY-MM)
- Technical terms and programming languages stay in English (e.g., JavaScript, React, AWS)
- Section titles should use standard resume headings in the target language
- Preserve the exact JSON structure, item count, IDs, field names, arrays, and object nesting — only translate string values
- Keep all IDs, URLs, emails, phone numbers, numeric values, programming languages, repository names, and GitHub metadata unchanged
- Do not add, remove, reorder, summarize, embellish, or infer resume facts
- CRITICAL: Return a single valid JSON object. No markdown, no code fences, no extra text.`;
}

async function translateSection(
  section: SectionForTranslation,
  targetLanguage: string,
  model: LanguageModel,
  aiConfig: AIConfig
): Promise<TranslatedResumeSection> {
  const result = await generateText({
    model,
    maxOutputTokens: 4096,
    system: getSectionTranslatePrompt(targetLanguage),
    prompt: `Translate this resume section. Return JSON with keys: sectionId, title, content.\n\n${JSON.stringify(section)}`,
    providerOptions: getJsonProviderOptions(aiConfig),
  });

  return extractJson(result.text, singleSectionSchema);
}

/** Run async tasks with a concurrency limit */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onSettled?: (index: number, result: PromiseSettledResult<R>) => void
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        const r = await fn(items[i]);
        results[i] = { status: 'fulfilled', value: r };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
      onSettled?.(i, results[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function stripHeavyFields(section: ResumeSnapshotSection, strippedFields: Map<string, Record<string, unknown>>) {
  const fieldsToStrip = STRIP_FIELDS[section.type];
  let content: unknown = section.content;

  if (fieldsToStrip && content && typeof content === 'object' && !Array.isArray(content)) {
    const saved: Record<string, unknown> = {};
    const contentRecord: Record<string, unknown> = { ...(content as Record<string, unknown>) };
    for (const field of fieldsToStrip) {
      if (field in contentRecord) {
        saved[field] = contentRecord[field];
        delete contentRecord[field];
      }
    }
    if (Object.keys(saved).length > 0) {
      strippedFields.set(section.id, saved);
    }
    content = contentRecord;
  }

  return {
    sectionId: section.id,
    type: section.type,
    title: section.title,
    content,
  } satisfies SectionForTranslation;
}

function mergeStrippedFields(
  translated: TranslatedResumeSection,
  strippedFields: Map<string, Record<string, unknown>>,
): TranslatedResumeSection {
  const saved = strippedFields.get(translated.sectionId);
  if (!saved) return translated;
  const content = translated.content && typeof translated.content === 'object' && !Array.isArray(translated.content)
    ? { ...(translated.content as Record<string, unknown>), ...saved }
    : translated.content;
  return { ...translated, content };
}

function streamError(error: unknown) {
  if (error instanceof ResumeChangeServiceError) {
    return { code: error.code, error: error.message };
  }
  if (error instanceof Error) {
    if (error.message === 'NO_TRANSLATION_CHANGES') {
      return { code: 'NO_TRANSLATION_CHANGES', error: 'No reviewable translation changes were produced.' };
    }
    if (error.message === 'TOO_MANY_TRANSLATION_CHANGES') {
      return { code: 'TOO_MANY_TRANSLATION_CHANGES', error: 'The translation produced too many review operations. Please translate fewer sections.' };
    }
    return { error: error.message };
  }
  return { error: 'Failed to translate resume' };
}

export async function POST(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await request.json();
    const parsed = translateInputSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: parsed.error.issues }),
        { status: 400 }
      );
    }

    const { resumeId, targetLanguage, sectionIds, mode } = parsed.data;

    const resume = await resumeRepository.findOwnedById(user.id, resumeId);
    if (!resume) {
      return new Response(JSON.stringify({ error: 'Resume not found' }), { status: 404 });
    }

    // Resolve the LLM profile before copy-mode duplication so configuration
    // errors do not leave an unused duplicated resume behind.
    const aiConfig = await resolveLlmConfig(user.id, 'resume');
    const model = getModel(aiConfig);

    // In copy mode, duplicate the resume first. The duplicate is not translated
    // directly; translation is persisted as a reviewable Change Set on that copy.
    let targetResumeId = resumeId;
    let newResumeId: string | undefined;

    if (mode === 'copy') {
      const newTitle = `${resume.title}-${LANGUAGE_NAMES[targetLanguage] || targetLanguage}`;
      const duplicated = await resumeRepository.duplicateOwned(user.id, resumeId, newTitle);
      if (!duplicated) {
        return new Response(JSON.stringify({ error: 'Failed to duplicate resume' }), { status: 500 });
      }
      targetResumeId = duplicated.id;
      newResumeId = duplicated.id;
    }

    const latest = await resumeChangeService.getCurrentVersion(user.id, targetResumeId).catch(async (error) => {
      if (newResumeId) await resumeRepository.deleteOwned(user.id, newResumeId).catch(() => undefined);
      throw error;
    });
    const snapshot = parseResumeSnapshot(latest.snapshot);
    const allSections = sectionIds
      ? snapshot.sections.filter((section) => sectionIds.includes(section.id))
      : snapshot.sections;

    if (allSections.length === 0) {
      if (newResumeId) await resumeRepository.deleteOwned(user.id, newResumeId).catch(() => undefined);
      return new Response(JSON.stringify({ error: 'No sections found to translate' }), { status: 400 });
    }

    const strippedFields = new Map<string, Record<string, unknown>>();
    const sectionsData = allSections.map((section) => stripHeavyFields(section, strippedFields));

    const encoder = new TextEncoder();
    const setResumeLanguage = !sectionIds || allSections.length === snapshot.sections.length;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
          } catch {
            // Stream may have been cancelled by client
          }
        };

        let completed = 0;
        const total = sectionsData.length;
        let failedCount = 0;

        try {
          const results = await runWithConcurrency<typeof sectionsData[number], TranslatedResumeSection>(
            sectionsData,
            MAX_CONCURRENCY,
            async (section) => {
              const translated = await translateSection(section, targetLanguage, model, aiConfig);

              if (translated.sectionId !== section.sectionId) {
                throw new Error('Translated section id does not match the requested section');
              }

              return mergeStrippedFields(translated, strippedFields);
            },
            (_index, result) => {
              completed++;
              if (result.status === 'rejected') {
                failedCount++;
                send({ type: 'progress', completed, total });
              } else {
                const section = (result as PromiseFulfilledResult<TranslatedResumeSection>).value;
                send({ type: 'progress', completed, total, sectionId: section.sectionId });
              }
            }
          );

          if (failedCount > 0) {
            console.error(
              'Some sections failed to translate:',
              results
                .filter((r) => r.status === 'rejected')
                .map((f) => (f as PromiseRejectedResult).reason)
            );
          }

          const translations = results
            .filter((result): result is PromiseFulfilledResult<TranslatedResumeSection> => result.status === 'fulfilled')
            .map((result) => result.value);

          if (translations.length === 0) {
            throw new Error('No sections were translated successfully');
          }

          const patch = buildTranslationResumePatch({
            snapshot,
            baseVersionId: latest.id,
            targetLanguage,
            translations,
            setResumeLanguage,
          });
          const candidate = failedCount > 0
            ? {
                ...patch,
                warnings: [
                  ...patch.warnings,
                  `${failedCount} section(s) failed to translate and were omitted from this proposal.`,
                ].slice(0, 20),
              }
            : patch;

          const changeSet = await resumeChangeService.createFromCandidate({
            userId: user.id,
            resumeId: targetResumeId,
            baseVersionId: latest.id,
            candidate,
            config: aiConfig,
            rawModelOutput: JSON.stringify({ translations }),
            promptVersion: TRANSLATE_PROMPT_VERSION,
          });
          if (!changeSet) throw new Error('Failed to create translation change set');

          send({
            type: 'done',
            resumeId: targetResumeId,
            language: targetLanguage,
            failedCount,
            changeSetId: changeSet.id,
            operationCount: changeSet.operations.length,
            reviewRequired: true,
            ...(newResumeId ? { newResumeId } : {}),
          });
        } catch (err) {
          console.error('Unexpected error during translation:', err);
          if (newResumeId) await resumeRepository.deleteOwned(user.id, newResumeId).catch(() => undefined);
          send({ type: 'error', ...streamError(err), ...(newResumeId ? { rolledBackResumeId: newResumeId } : {}) });
        }

        try {
          controller.close();
        } catch {
          // Already closed
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return new Response(JSON.stringify({ code: error.code, error: error.message }), { status: error.status });
    }
    console.error('POST /api/ai/translate error:', error);
    return new Response(JSON.stringify({ error: 'Failed to translate resume' }), { status: 500 });
  }
}
