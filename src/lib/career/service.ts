import type { ActorContext } from '@/lib/auth/service';
import { dbReady } from '@/lib/db';
import {
  careerRepository,
  CareerRepositoryError,
} from '@/lib/db/repositories/career.repository';
import { contentHash } from '@/lib/resume-patch/snapshot';

import { careerFactContentHash, normalizeCareerText, safeJsonRecord } from './normalize';
import type { CareerFactStatus, CareerFactType } from './types';

export class CareerServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'CareerServiceError';
  }
}

function mapRepositoryError(error: CareerRepositoryError): CareerServiceError {
  switch (error.code) {
    case 'FACT_NOT_FOUND':
      return new CareerServiceError(error.code, 404, 'Career fact not found.');
    case 'INVALID_FACT_STATE':
      return new CareerServiceError(error.code, 409, 'Career fact is not in a valid state for this operation.');
    case 'FACT_CONTENT_CONFLICT':
    case 'IMPORT_CONFLICT':
      return new CareerServiceError(error.code, 409, 'Career knowledge state conflicts with this operation.');
    case 'INVALID_MERGE':
      return new CareerServiceError(error.code, 422, 'Select at least two valid facts owned by the current user.');
  }
}

function cleanTitle(value: string) {
  const title = normalizeCareerText(value);
  if (!title || title.length > 200) throw new CareerServiceError('INVALID_FACT_INPUT', 400);
  return title;
}

function cleanSummary(value: string) {
  const summary = normalizeCareerText(value);
  if (summary.length > 5_000) throw new CareerServiceError('INVALID_FACT_INPUT', 400);
  return summary;
}

export const careerService = {
  async listFacts(
    actor: ActorContext,
    filters: { status?: CareerFactStatus; factType?: CareerFactType } = {},
  ) {
    await dbReady;
    return careerRepository.listFactsOwned(actor.userId, filters);
  },

  async getFact(actor: ActorContext, factId: string) {
    await dbReady;
    const fact = await careerRepository.findFactOwned(actor.userId, factId);
    if (!fact) throw new CareerServiceError('FACT_NOT_FOUND', 404);
    return fact;
  },

  async updateFact(actor: ActorContext, factId: string, input: {
    title?: string;
    summary?: string;
    structuredData?: Record<string, unknown>;
  }) {
    await dbReady;
    const existing = await careerRepository.findFactOwned(actor.userId, factId, false);
    if (!existing) throw new CareerServiceError('FACT_NOT_FOUND', 404);
    const title = input.title === undefined ? existing.title : cleanTitle(input.title);
    const summary = input.summary === undefined ? existing.summary : cleanSummary(input.summary);
    const structuredData = input.structuredData === undefined
      ? safeJsonRecord(existing.structuredData)
      : safeJsonRecord(input.structuredData);
    const hash = careerFactContentHash({
      factType: existing.factType,
      canonicalKey: existing.canonicalKey,
      title,
      summary,
      structuredData,
    });
    if (hash === existing.contentHash) return existing;
    try {
      const row = await careerRepository.editFactOwned(actor.userId, factId, {
        title, summary, structuredData, contentHash: hash,
      });
      return (await careerRepository.findFactOwned(actor.userId, row.id))!;
    } catch (error) {
      if (error instanceof CareerRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  async reviewFact(
    actor: ActorContext,
    factId: string,
    decision: 'approve' | 'reject',
    note?: string,
  ) {
    await dbReady;
    try {
      const row = await careerRepository.reviewFactOwned(
        actor.userId,
        factId,
        decision,
        note ? cleanSummary(note) : undefined,
      );
      return (await careerRepository.findFactOwned(actor.userId, row.id))!;
    } catch (error) {
      if (error instanceof CareerRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  async mergeFacts(actor: ActorContext, input: {
    factIds: string[];
    factType: CareerFactType;
    title: string;
    summary: string;
    structuredData?: Record<string, unknown>;
  }) {
    await dbReady;
    const factIds = [...new Set(input.factIds)];
    if (factIds.length < 2 || factIds.length > 20) {
      throw new CareerServiceError('INVALID_MERGE', 422);
    }
    const title = cleanTitle(input.title);
    const summary = cleanSummary(input.summary);
    const structuredData = {
      ...safeJsonRecord(input.structuredData),
      mergedFactIds: [...factIds].sort(),
    };
    const canonicalKey = `merge:${contentHash([...factIds].sort()).slice('sha256:'.length, 31)}`;
    const hash = careerFactContentHash({
      factType: input.factType,
      canonicalKey,
      title,
      summary,
      structuredData,
    });
    try {
      const row = await careerRepository.mergeFactsOwned(actor.userId, factIds, {
        factType: input.factType,
        canonicalKey,
        title,
        summary,
        structuredData,
        contentHash: hash,
      });
      return (await careerRepository.findFactOwned(actor.userId, row.id))!;
    } catch (error) {
      if (error instanceof CareerRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  },

  async loadResumePolicy(userId: string) {
    await dbReady;
    return careerRepository.loadPolicyOwned(userId);
  },
};
