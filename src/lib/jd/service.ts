import { generateText } from 'ai';

import { extractJson } from '@/lib/ai/extract-json';
import {
  AIConfigError,
  getJsonProviderOptions,
  getModel,
} from '@/lib/ai/provider';
import type { ActorContext } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import {
  jdRepository,
  JdRepositoryError,
} from '@/lib/db/repositories/jd.repository';
import { resolveLlmConfig } from '@/lib/llm/resolver';

import {
  JD_EXTRACTION_PROMPT,
  jdExtractionSchema,
} from './extraction';
import {
  cleanJdField,
  defaultJdTitle,
  jdContentHash,
  JdValidationError,
  locateJdExcerpt,
  normalizeJdText,
  normalizeRequirements,
} from './normalize';
import type { JdExtractionCandidate, JdRequirementInput } from './types';

const JD_PARSER_ID = 'llm-jd-extractor';
const JD_PARSER_VERSION = '1.0.0';

export class JdServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'JdServiceError';
  }
}

function mapRepositoryError(error: JdRepositoryError): JdServiceError {
  if (error.code === 'JD_SOURCE_NOT_FOUND') {
    return new JdServiceError(error.code, 404, 'Job description source not found.');
  }
  return new JdServiceError(error.code, 409, 'Job description source is not ready for this operation.');
}

function mapValidationError(error: JdValidationError): JdServiceError {
  return new JdServiceError(error.code, 400, error.message);
}

function sourceTitle(value: unknown, normalizedText: string) {
  return cleanJdField(value, 240) || defaultJdTitle(normalizedText);
}

function reviewRequirements(
  normalizedText: string,
  candidate: JdExtractionCandidate,
) {
  return normalizeRequirements(candidate.requirements.map((requirement) => {
    const suppliedLocator = requirement.sourceLocator
      && Object.keys(requirement.sourceLocator).length > 0
      ? requirement.sourceLocator
      : undefined;
    const exactLocator = locateJdExcerpt(normalizedText, requirement.sourceText);
    const textLocator = locateJdExcerpt(normalizedText, requirement.text);
    return {
      ...requirement,
      sourceLocator: suppliedLocator
        || (Object.keys(exactLocator).length > 0 ? exactLocator : textLocator),
    };
  }));
}

async function saveCandidate(
  userId: string,
  jdSourceId: string,
  normalizedText: string,
  fallbackTitle: string,
  candidate: JdExtractionCandidate,
  parser: { id?: string | null; version?: string | null } = {},
) {
  const requirements = reviewRequirements(normalizedText, candidate);
  const source = await jdRepository.replaceReviewOwned(userId, jdSourceId, {
    title: sourceTitle(candidate.title || fallbackTitle, normalizedText),
    company: cleanJdField(candidate.company, 240),
    jobTitle: cleanJdField(candidate.jobTitle, 240),
    location: cleanJdField(candidate.location, 240),
    parserId: parser.id,
    parserVersion: parser.version,
    requirements,
  });
  if (!source) throw new JdServiceError('JD_SOURCE_NOT_FOUND', 404);
  return source;
}

export const jdService = {
  async createTextSource(actor: ActorContext, input: { text: string; title?: string }) {
    await dbReady;
    try {
      const normalizedText = normalizeJdText(input.text);
      return jdRepository.createTextSourceOwned({
        userId: actor.userId,
        title: sourceTitle(input.title, normalizedText),
        rawText: input.text,
        normalizedText,
        contentHash: jdContentHash(normalizedText),
        sizeBytes: Buffer.byteLength(input.text, 'utf8'),
      });
    } catch (error) {
      if (error instanceof JdValidationError) throw mapValidationError(error);
      if (error instanceof JdRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  async listSources(actor: ActorContext) {
    await dbReady;
    return jdRepository.listSourcesOwned(actor.userId);
  },

  async getSource(actor: ActorContext, jdSourceId: string) {
    await dbReady;
    const source = await jdRepository.findSourceOwned(actor.userId, jdSourceId);
    if (!source) throw new JdServiceError('JD_SOURCE_NOT_FOUND', 404);
    return source;
  },

  async extractSource(actor: ActorContext, jdSourceId: string) {
    await dbReady;
    const source = await jdRepository.findSourceOwned(actor.userId, jdSourceId);
    if (!source) throw new JdServiceError('JD_SOURCE_NOT_FOUND', 404);
    await jdRepository.markParsingOwned(actor.userId, jdSourceId);
    try {
      const aiConfig = await resolveLlmConfig(actor.userId, 'jd');
      const result = await generateText({
        model: getModel(aiConfig),
        maxOutputTokens: 8_192,
        system: JD_EXTRACTION_PROMPT,
        prompt: `<job_description>\n${source.normalizedText}\n</job_description>`,
        providerOptions: getJsonProviderOptions(aiConfig),
      });
      const candidate = extractJson(result.text, jdExtractionSchema);
      return await saveCandidate(
        actor.userId,
        jdSourceId,
        source.normalizedText,
        source.title,
        candidate,
        { id: JD_PARSER_ID, version: JD_PARSER_VERSION },
      );
    } catch (error) {
      const code = error instanceof AIConfigError ? error.code : 'JD_EXTRACTION_FAILED';
      await jdRepository.markFailedOwned(actor.userId, jdSourceId, code);
      if (error instanceof AIConfigError) {
        throw new JdServiceError(error.code, error.status, error.message);
      }
      if (error instanceof JdValidationError) {
        throw new JdServiceError('JD_EXTRACTION_INVALID', 502, 'The LLM returned invalid JD requirements.');
      }
      throw new JdServiceError('JD_EXTRACTION_FAILED', 502, 'Failed to extract job requirements.');
    }
  },

  async updateReview(actor: ActorContext, jdSourceId: string, input: {
    title?: string;
    company?: string;
    jobTitle?: string;
    location?: string;
    requirements: JdRequirementInput[];
  }) {
    await dbReady;
    const source = await jdRepository.findSourceOwned(actor.userId, jdSourceId);
    if (!source) throw new JdServiceError('JD_SOURCE_NOT_FOUND', 404);
    try {
      return await saveCandidate(
        actor.userId,
        jdSourceId,
        source.normalizedText,
        source.title,
        {
          title: input.title ?? source.title,
          company: input.company ?? source.company,
          jobTitle: input.jobTitle ?? source.jobTitle,
          location: input.location ?? source.location,
          requirements: input.requirements,
        },
        { id: 'user-reviewed', version: '1.0.0' },
      );
    } catch (error) {
      if (error instanceof JdValidationError) throw mapValidationError(error);
      if (error instanceof JdRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  async confirmSource(actor: ActorContext, jdSourceId: string) {
    await dbReady;
    try {
      const source = await jdRepository.confirmOwned(actor.userId, jdSourceId);
      if (!source) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
      return source;
    } catch (error) {
      if (error instanceof JdRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  /** Deterministic acceptance hook; applies the same validation as an LLM result. */
  async applyCandidateForAcceptance(
    actor: ActorContext,
    jdSourceId: string,
    candidate: JdExtractionCandidate,
  ) {
    await dbReady;
    const source = await jdRepository.findSourceOwned(actor.userId, jdSourceId);
    if (!source) throw new JdServiceError('JD_SOURCE_NOT_FOUND', 404);
    return saveCandidate(
      actor.userId,
      jdSourceId,
      source.normalizedText,
      source.title,
      candidate,
      { id: 'acceptance-candidate', version: '1.0.0' },
    );
  },
};
