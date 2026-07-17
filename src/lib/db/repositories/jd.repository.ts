import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { config } from '@/lib/config';
import type {
  JdInputType,
  JdRequirementInput,
  JdRequirementPriority,
  JdRequirementType,
  JdSourceStatus,
} from '@/lib/jd/types';

import { db } from '../index';
import { jdRequirements, jdSources } from '../schema';

type SourceRow = typeof jdSources.$inferSelect;
type RequirementRow = typeof jdRequirements.$inferSelect;

export class JdRepositoryError extends Error {
  constructor(public readonly code: 'JD_SOURCE_NOT_FOUND' | 'JD_SOURCE_STATE_INVALID') {
    super(code);
    this.name = 'JdRepositoryError';
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function serializeRequirement(row: RequirementRow) {
  return {
    ...row,
    requirementType: row.requirementType as JdRequirementType,
    aliases: parseJsonColumn<string[]>(row.aliases, []),
    priority: row.priority as JdRequirementPriority,
    importance: row.importanceBasisPoints / 10_000,
    sourceLocator: parseJsonColumn<Record<string, unknown>>(row.sourceLocator, {}),
  };
}

function serializeSource(row: SourceRow, requirements: RequirementRow[] = []) {
  return {
    ...row,
    inputType: row.inputType as JdInputType,
    status: row.status as JdSourceStatus,
    requirements: requirements.map(serializeRequirement),
  };
}

async function attachRequirements(rows: SourceRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const requirementRows = await db.select().from(jdRequirements)
    .where(inArray(jdRequirements.jdSourceId, ids))
    .orderBy(asc(jdRequirements.sortOrder));
  return rows.map((row) => serializeSource(
    row,
    requirementRows.filter((requirement: RequirementRow) => requirement.jdSourceId === row.id),
  ));
}

function requirementValues(userId: string, jdSourceId: string, inputs: Array<JdRequirementInput & {
  sortOrder: number;
  importance: number;
}>) {
  return inputs.map((input) => ({
    id: crypto.randomUUID(),
    userId,
    jdSourceId,
    requirementType: input.requirementType,
    text: input.text,
    normalizedTerm: input.normalizedTerm || '',
    aliases: input.aliases || [],
    priority: input.priority || 'normal',
    importanceBasisPoints: Math.max(0, Math.min(10_000, Math.round(input.importance * 10_000))),
    sourceLocator: input.sourceLocator || {},
    sortOrder: input.sortOrder,
  } satisfies typeof jdRequirements.$inferInsert));
}

export const jdRepository = {
  async createTextSourceOwned(input: {
    userId: string;
    title: string;
    rawText: string;
    normalizedText: string;
    contentHash: string;
    sizeBytes: number;
  }) {
    const id = crypto.randomUUID();
    await db.insert(jdSources).values({
      id,
      userId: input.userId,
      inputType: 'text',
      title: input.title,
      mimeType: 'text/plain; charset=utf-8',
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      rawText: input.rawText,
      normalizedText: input.normalizedText,
      status: 'draft',
    }).onConflictDoNothing();
    const rows = await db.select().from(jdSources).where(and(
      eq(jdSources.userId, input.userId),
      eq(jdSources.contentHash, input.contentHash),
    )).limit(1);
    if (!rows[0]) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
    return { source: serializeSource(rows[0]), created: rows[0].id === id };
  },

  async listSourcesOwned(userId: string) {
    const rows = await db.select().from(jdSources)
      .where(eq(jdSources.userId, userId))
      .orderBy(desc(jdSources.updatedAt), desc(jdSources.createdAt));
    return attachRequirements(rows);
  },

  async findSourceOwned(userId: string, jdSourceId: string) {
    const rows = await db.select().from(jdSources).where(and(
      eq(jdSources.id, jdSourceId),
      eq(jdSources.userId, userId),
    )).limit(1);
    return rows[0] ? (await attachRequirements(rows))[0] : null;
  },

  async markParsingOwned(userId: string, jdSourceId: string) {
    const existing = await this.findSourceOwned(userId, jdSourceId);
    if (!existing) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
    await db.update(jdSources).set({
      status: 'parsing',
      errorCode: null,
      confirmedAt: null,
      updatedAt: new Date(),
    }).where(and(eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId)));
  },

  async replaceReviewOwned(userId: string, jdSourceId: string, input: {
    title: string;
    company: string;
    jobTitle: string;
    location: string;
    parserId?: string | null;
    parserVersion?: string | null;
    requirements: Array<JdRequirementInput & { sortOrder: number; importance: number }>;
  }) {
    const values = requirementValues(userId, jdSourceId, input.requirements);
    const update = {
      title: input.title,
      company: input.company,
      jobTitle: input.jobTitle,
      location: input.location,
      status: 'needs_review' as const,
      parserId: input.parserId || null,
      parserVersion: input.parserVersion || null,
      errorCode: null,
      confirmedAt: null,
      updatedAt: new Date(),
    };

    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        const source = tx.select({ id: jdSources.id }).from(jdSources).where(and(
          eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId),
        )).limit(1).get();
        if (!source) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
        tx.delete(jdRequirements).where(and(
          eq(jdRequirements.jdSourceId, jdSourceId), eq(jdRequirements.userId, userId),
        )).run();
        if (values.length > 0) tx.insert(jdRequirements).values(values).run();
        tx.update(jdSources).set(update).where(and(
          eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId),
        )).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        const sources = await tx.select({ id: jdSources.id }).from(jdSources).where(and(
          eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId),
        )).limit(1);
        if (!sources[0]) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
        await tx.delete(jdRequirements).where(and(
          eq(jdRequirements.jdSourceId, jdSourceId), eq(jdRequirements.userId, userId),
        ));
        if (values.length > 0) await tx.insert(jdRequirements).values(values);
        await tx.update(jdSources).set(update).where(and(
          eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId),
        ));
      });
    }
    return this.findSourceOwned(userId, jdSourceId);
  },

  async confirmOwned(userId: string, jdSourceId: string) {
    const source = await this.findSourceOwned(userId, jdSourceId);
    if (!source) throw new JdRepositoryError('JD_SOURCE_NOT_FOUND');
    if (source.status !== 'needs_review' || source.requirements.length < 1) {
      throw new JdRepositoryError('JD_SOURCE_STATE_INVALID');
    }
    await db.update(jdSources).set({
      status: 'confirmed',
      confirmedAt: new Date(),
      errorCode: null,
      updatedAt: new Date(),
    }).where(and(eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId)));
    return this.findSourceOwned(userId, jdSourceId);
  },

  async markFailedOwned(userId: string, jdSourceId: string, errorCode: string) {
    await db.update(jdSources).set({
      status: 'failed',
      errorCode: errorCode.slice(0, 120),
      confirmedAt: null,
      updatedAt: new Date(),
    }).where(and(eq(jdSources.id, jdSourceId), eq(jdSources.userId, userId)));
  },

  async countRequirementsOwned(userId: string, jdSourceId: string) {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(jdRequirements).where(and(
      eq(jdRequirements.userId, userId), eq(jdRequirements.jdSourceId, jdSourceId),
    ));
    return Number(rows[0]?.count || 0);
  },
};
