import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { config } from '@/lib/config';
import { claimContentHash, normalizeClaim, safeJsonRecord } from '@/lib/career/normalize';
import type {
  CareerFactStatus,
  CareerFactType,
  CareerKnowledgePolicy,
  CareerSnapshotImportInput,
} from '@/lib/career/types';

import { db } from '../index';
import {
  careerFactClaims,
  careerFactEvidence,
  careerFactRelations,
  careerFacts,
  factReviewEvents,
  sourceDocuments,
  sourceRepositories,
  sourceSnapshots,
} from '../schema';

type FactRow = typeof careerFacts.$inferSelect;
type EvidenceRow = typeof careerFactEvidence.$inferSelect;
type ClaimRow = typeof careerFactClaims.$inferSelect;
type ReviewEventRow = typeof factReviewEvents.$inferSelect;

export class CareerRepositoryError extends Error {
  constructor(public readonly code:
    | 'FACT_NOT_FOUND'
    | 'INVALID_FACT_STATE'
    | 'FACT_CONTENT_CONFLICT'
    | 'INVALID_MERGE'
    | 'IMPORT_CONFLICT'
  ) {
    super(code);
    this.name = 'CareerRepositoryError';
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function factState(row: FactRow) {
  return {
    id: row.id,
    factType: row.factType,
    canonicalKey: row.canonicalKey,
    title: row.title,
    summary: row.summary,
    structuredData: parseJsonColumn<Record<string, unknown>>(row.structuredData, {}),
    status: row.status,
    contentHash: row.contentHash,
    supersedesFactId: row.supersedesFactId,
    supersededByFactId: row.supersededByFactId,
  };
}

function serializeFact(
  row: FactRow,
  evidence: EvidenceRow[] = [],
  claims: ClaimRow[] = [],
  reviewEvents: ReviewEventRow[] = [],
) {
  return {
    ...row,
    factType: row.factType as CareerFactType,
    status: row.status as CareerFactStatus,
    structuredData: parseJsonColumn<Record<string, unknown>>(row.structuredData, {}),
    confidence: row.confidenceBasisPoints / 10_000,
    evidence: evidence.map((item) => ({ ...item, stale: Boolean(item.stale) })),
    claims: claims.map((item) => ({ ...item })),
    reviewEvents: reviewEvents.map((item) => ({
      ...item,
      beforeState: parseJsonColumn<Record<string, unknown> | null>(item.beforeState, null),
      afterState: parseJsonColumn<Record<string, unknown> | null>(item.afterState, null),
    })),
  };
}

async function attachDetails(rows: FactRow[], includeEvents = false) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [evidenceRows, claimRows, eventRows] = await Promise.all([
    db.select().from(careerFactEvidence)
      .where(inArray(careerFactEvidence.careerFactId, ids))
      .orderBy(careerFactEvidence.path, careerFactEvidence.locator),
    db.select().from(careerFactClaims)
      .where(inArray(careerFactClaims.careerFactId, ids))
      .orderBy(careerFactClaims.claimType, careerFactClaims.normalizedClaim),
    includeEvents
      ? db.select().from(factReviewEvents)
        .where(inArray(factReviewEvents.careerFactId, ids))
        .orderBy(desc(factReviewEvents.createdAt))
      : Promise.resolve([] as ReviewEventRow[]),
  ]);
  return rows.map((row) => serializeFact(
    row,
    evidenceRows.filter((item: EvidenceRow) => item.careerFactId === row.id),
    claimRows.filter((item: ClaimRow) => item.careerFactId === row.id),
    eventRows.filter((item: ReviewEventRow) => item.careerFactId === row.id),
  ));
}

function factInsertValues(input: {
  id?: string;
  userId: string;
  factType: CareerFactType;
  canonicalKey: string;
  title: string;
  summary: string;
  structuredData: Record<string, unknown>;
  contentHash: string;
  confidence?: number;
  supersedesFactId?: string | null;
  createdBy: 'import' | 'ai' | 'user';
  sourceParserId?: string | null;
  sourceParserVersion?: string | null;
}) {
  return {
    id: input.id || crypto.randomUUID(),
    userId: input.userId,
    factType: input.factType,
    canonicalKey: input.canonicalKey,
    title: input.title,
    summary: input.summary,
    structuredData: input.structuredData,
    status: 'draft' as const,
    confidenceBasisPoints: Math.max(0, Math.min(10_000, Math.round((input.confidence ?? 1) * 10_000))),
    contentHash: input.contentHash,
    supersedesFactId: input.supersedesFactId || null,
    createdBy: input.createdBy,
    sourceParserId: input.sourceParserId || null,
    sourceParserVersion: input.sourceParserVersion || null,
  } satisfies typeof careerFacts.$inferInsert;
}

function eventValues(input: {
  userId: string;
  factId: string;
  actorUserId?: string | null;
  action: 'imported' | 'edited' | 'approved' | 'rejected' | 'merged' | 'superseded';
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  note?: string | null;
}) {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    careerFactId: input.factId,
    actorUserId: input.actorUserId || null,
    action: input.action,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    note: input.note || null,
  } satisfies typeof factReviewEvents.$inferInsert;
}

export const careerRepository = {
  async listFactsOwned(userId: string, filters: { status?: CareerFactStatus; factType?: CareerFactType } = {}) {
    const predicates = [eq(careerFacts.userId, userId)];
    if (filters.status) predicates.push(eq(careerFacts.status, filters.status));
    if (filters.factType) predicates.push(eq(careerFacts.factType, filters.factType));
    const rows = await db.select().from(careerFacts)
      .where(and(...predicates))
      .orderBy(desc(careerFacts.updatedAt), careerFacts.title);
    return attachDetails(rows);
  },

  async findFactOwned(userId: string, factId: string, includeEvents = true) {
    const rows = await db.select().from(careerFacts).where(and(
      eq(careerFacts.id, factId),
      eq(careerFacts.userId, userId),
    )).limit(1);
    if (!rows[0]) return null;
    return (await attachDetails(rows, includeEvents))[0];
  },

  async editFactOwned(userId: string, factId: string, input: {
    title: string;
    summary: string;
    structuredData: Record<string, unknown>;
    contentHash: string;
  }) {
    const now = new Date();
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const existing = tx.select().from(careerFacts).where(and(
          eq(careerFacts.id, factId), eq(careerFacts.userId, userId),
        )).limit(1).get();
        if (!existing) throw new CareerRepositoryError('FACT_NOT_FOUND');
        if (existing.status === 'superseded') throw new CareerRepositoryError('INVALID_FACT_STATE');
        const conflict = tx.select({ id: careerFacts.id }).from(careerFacts).where(and(
          eq(careerFacts.userId, userId),
          eq(careerFacts.canonicalKey, existing.canonicalKey),
          eq(careerFacts.contentHash, input.contentHash),
          ne(careerFacts.id, factId),
        )).limit(1).get();
        if (conflict) throw new CareerRepositoryError('FACT_CONTENT_CONFLICT');
        if (existing.status === 'draft') {
          const before = factState(existing);
          tx.update(careerFacts).set({
            title: input.title,
            summary: input.summary,
            structuredData: input.structuredData,
            contentHash: input.contentHash,
            createdBy: 'user',
            updatedAt: now,
          }).where(and(eq(careerFacts.id, factId), eq(careerFacts.userId, userId))).run();
          const updated = tx.select().from(careerFacts).where(eq(careerFacts.id, factId)).limit(1).get()!;
          tx.insert(factReviewEvents).values(eventValues({
            userId, factId, actorUserId: userId, action: 'edited', beforeState: before, afterState: factState(updated),
          })).run();
          return updated;
        }

        const next = factInsertValues({
          userId,
          factType: existing.factType as CareerFactType,
          canonicalKey: existing.canonicalKey,
          title: input.title,
          summary: input.summary,
          structuredData: input.structuredData,
          contentHash: input.contentHash,
          confidence: existing.confidenceBasisPoints / 10_000,
          supersedesFactId: existing.id,
          createdBy: 'user',
          sourceParserId: existing.sourceParserId,
          sourceParserVersion: existing.sourceParserVersion,
        });
        tx.insert(careerFacts).values(next).run();
        const evidence = tx.select().from(careerFactEvidence)
          .where(and(eq(careerFactEvidence.userId, userId), eq(careerFactEvidence.careerFactId, factId))).all();
        for (const item of evidence) {
          tx.insert(careerFactEvidence).values({
            ...item, id: crypto.randomUUID(), careerFactId: next.id,
          }).run();
        }
        const claims = tx.select().from(careerFactClaims)
          .where(and(eq(careerFactClaims.userId, userId), eq(careerFactClaims.careerFactId, factId))).all();
        for (const item of claims) {
          tx.insert(careerFactClaims).values({
            ...item, id: crypto.randomUUID(), careerFactId: next.id,
          }).run();
        }
        tx.insert(factReviewEvents).values(eventValues({
          userId, factId: next.id, actorUserId: userId, action: 'edited',
          beforeState: factState(existing), afterState: factState(next as FactRow),
        })).run();
        return tx.select().from(careerFacts).where(eq(careerFacts.id, next.id)).limit(1).get()!;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.select().from(careerFacts).where(and(
        eq(careerFacts.id, factId), eq(careerFacts.userId, userId),
      )).limit(1);
      const existing = rows[0];
      if (!existing) throw new CareerRepositoryError('FACT_NOT_FOUND');
      if (existing.status === 'superseded') throw new CareerRepositoryError('INVALID_FACT_STATE');
      const conflicts = await tx.select({ id: careerFacts.id }).from(careerFacts).where(and(
        eq(careerFacts.userId, userId),
        eq(careerFacts.canonicalKey, existing.canonicalKey),
        eq(careerFacts.contentHash, input.contentHash),
        ne(careerFacts.id, factId),
      )).limit(1);
      if (conflicts[0]) throw new CareerRepositoryError('FACT_CONTENT_CONFLICT');
      if (existing.status === 'draft') {
        const before = factState(existing);
        await tx.update(careerFacts).set({
          title: input.title,
          summary: input.summary,
          structuredData: input.structuredData,
          contentHash: input.contentHash,
          createdBy: 'user',
          updatedAt: now,
        }).where(and(eq(careerFacts.id, factId), eq(careerFacts.userId, userId)));
        const updatedRows = await tx.select().from(careerFacts).where(eq(careerFacts.id, factId)).limit(1);
        await tx.insert(factReviewEvents).values(eventValues({
          userId, factId, actorUserId: userId, action: 'edited',
          beforeState: before, afterState: factState(updatedRows[0]),
        }));
        return updatedRows[0];
      }

      const next = factInsertValues({
        userId,
        factType: existing.factType as CareerFactType,
        canonicalKey: existing.canonicalKey,
        title: input.title,
        summary: input.summary,
        structuredData: input.structuredData,
        contentHash: input.contentHash,
        confidence: existing.confidenceBasisPoints / 10_000,
        supersedesFactId: existing.id,
        createdBy: 'user',
        sourceParserId: existing.sourceParserId,
        sourceParserVersion: existing.sourceParserVersion,
      });
      await tx.insert(careerFacts).values(next);
      const evidence = await tx.select().from(careerFactEvidence)
        .where(and(eq(careerFactEvidence.userId, userId), eq(careerFactEvidence.careerFactId, factId)));
      if (evidence.length > 0) {
        await tx.insert(careerFactEvidence).values(evidence.map((item: EvidenceRow) => ({
          ...item, id: crypto.randomUUID(), careerFactId: next.id,
        })));
      }
      const claims = await tx.select().from(careerFactClaims)
        .where(and(eq(careerFactClaims.userId, userId), eq(careerFactClaims.careerFactId, factId)));
      if (claims.length > 0) {
        await tx.insert(careerFactClaims).values(claims.map((item: ClaimRow) => ({
          ...item, id: crypto.randomUUID(), careerFactId: next.id,
        })));
      }
      await tx.insert(factReviewEvents).values(eventValues({
        userId, factId: next.id, actorUserId: userId, action: 'edited',
        beforeState: factState(existing), afterState: factState(next as FactRow),
      }));
      const created = await tx.select().from(careerFacts).where(eq(careerFacts.id, next.id)).limit(1);
      return created[0];
    });
  },

  async reviewFactOwned(userId: string, factId: string, decision: 'approve' | 'reject', note?: string) {
    const now = new Date();
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const existing = tx.select().from(careerFacts).where(and(
          eq(careerFacts.id, factId), eq(careerFacts.userId, userId),
        )).limit(1).get();
        if (!existing) throw new CareerRepositoryError('FACT_NOT_FOUND');
        if (existing.status !== 'draft') throw new CareerRepositoryError('INVALID_FACT_STATE');
        const evidenceCount = tx.select({ id: careerFactEvidence.id }).from(careerFactEvidence)
          .where(and(eq(careerFactEvidence.userId, userId), eq(careerFactEvidence.careerFactId, factId)))
          .limit(1).get();
        if (!evidenceCount) throw new CareerRepositoryError('INVALID_FACT_STATE');
        const before = factState(existing);
        tx.update(careerFacts).set({
          status: nextStatus,
          approvedBy: decision === 'approve' ? userId : null,
          approvedAt: decision === 'approve' ? now : null,
          updatedAt: now,
        }).where(and(eq(careerFacts.id, factId), eq(careerFacts.userId, userId))).run();
        const supersededIds = new Set<string>();
        if (decision === 'approve') {
          if (existing.supersedesFactId) supersededIds.add(existing.supersedesFactId);
          const relations = tx.select().from(careerFactRelations).where(and(
            eq(careerFactRelations.userId, userId),
            eq(careerFactRelations.careerFactId, factId),
            eq(careerFactRelations.relationType, 'merged-from'),
          )).all();
          relations.forEach((relation: typeof careerFactRelations.$inferSelect) => supersededIds.add(relation.relatedFactId));
          for (const sourceId of supersededIds) {
            const source = tx.select().from(careerFacts).where(and(
              eq(careerFacts.id, sourceId), eq(careerFacts.userId, userId),
            )).limit(1).get();
            if (!source || source.status === 'superseded') continue;
            tx.update(careerFacts).set({ status: 'superseded', supersededByFactId: factId, updatedAt: now })
              .where(and(eq(careerFacts.id, sourceId), eq(careerFacts.userId, userId))).run();
            tx.insert(factReviewEvents).values(eventValues({
              userId, factId: sourceId, actorUserId: userId, action: 'superseded',
              beforeState: factState(source),
              afterState: { ...factState(source), status: 'superseded', supersededByFactId: factId },
              note: `Superseded by ${factId}`,
            })).run();
          }
        }
        const updated = tx.select().from(careerFacts).where(eq(careerFacts.id, factId)).limit(1).get()!;
        tx.insert(factReviewEvents).values(eventValues({
          userId, factId, actorUserId: userId,
          action: decision === 'approve' ? 'approved' : 'rejected',
          beforeState: before,
          afterState: factState(updated),
          note,
        })).run();
        return updated;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.select().from(careerFacts).where(and(
        eq(careerFacts.id, factId), eq(careerFacts.userId, userId),
      )).limit(1);
      const existing = rows[0];
      if (!existing) throw new CareerRepositoryError('FACT_NOT_FOUND');
      if (existing.status !== 'draft') throw new CareerRepositoryError('INVALID_FACT_STATE');
      const evidenceRows = await tx.select({ id: careerFactEvidence.id }).from(careerFactEvidence)
        .where(and(eq(careerFactEvidence.userId, userId), eq(careerFactEvidence.careerFactId, factId)))
        .limit(1);
      if (!evidenceRows[0]) throw new CareerRepositoryError('INVALID_FACT_STATE');
      const before = factState(existing);
      await tx.update(careerFacts).set({
        status: nextStatus,
        approvedBy: decision === 'approve' ? userId : null,
        approvedAt: decision === 'approve' ? now : null,
        updatedAt: now,
      }).where(and(eq(careerFacts.id, factId), eq(careerFacts.userId, userId)));
      const supersededIds = new Set<string>();
      if (decision === 'approve') {
        if (existing.supersedesFactId) supersededIds.add(existing.supersedesFactId);
        const relations = await tx.select().from(careerFactRelations).where(and(
          eq(careerFactRelations.userId, userId),
          eq(careerFactRelations.careerFactId, factId),
          eq(careerFactRelations.relationType, 'merged-from'),
        ));
        relations.forEach((relation: typeof careerFactRelations.$inferSelect) => supersededIds.add(relation.relatedFactId));
        for (const sourceId of supersededIds) {
          const sources = await tx.select().from(careerFacts).where(and(
            eq(careerFacts.id, sourceId), eq(careerFacts.userId, userId),
          )).limit(1);
          const source = sources[0];
          if (!source || source.status === 'superseded') continue;
          await tx.update(careerFacts).set({ status: 'superseded', supersededByFactId: factId, updatedAt: now })
            .where(and(eq(careerFacts.id, sourceId), eq(careerFacts.userId, userId)));
          await tx.insert(factReviewEvents).values(eventValues({
            userId, factId: sourceId, actorUserId: userId, action: 'superseded',
            beforeState: factState(source),
            afterState: { ...factState(source), status: 'superseded', supersededByFactId: factId },
            note: `Superseded by ${factId}`,
          }));
        }
      }
      const updatedRows = await tx.select().from(careerFacts).where(eq(careerFacts.id, factId)).limit(1);
      await tx.insert(factReviewEvents).values(eventValues({
        userId, factId, actorUserId: userId,
        action: decision === 'approve' ? 'approved' : 'rejected',
        beforeState: before,
        afterState: factState(updatedRows[0]),
        note,
      }));
      return updatedRows[0];
    });
  },

  async mergeFactsOwned(userId: string, factIds: string[], input: {
    factType: CareerFactType;
    canonicalKey: string;
    title: string;
    summary: string;
    structuredData: Record<string, unknown>;
    contentHash: string;
  }) {
    if (factIds.length < 2 || new Set(factIds).size !== factIds.length) {
      throw new CareerRepositoryError('INVALID_MERGE');
    }
    const mergeSync = (tx: typeof db) => {
      const sources = tx.select().from(careerFacts).where(and(
        eq(careerFacts.userId, userId), inArray(careerFacts.id, factIds),
      )).all();
      if (sources.length !== factIds.length || sources.some(
        (row: FactRow) => row.status !== 'draft' && row.status !== 'approved',
      )) {
        throw new CareerRepositoryError('INVALID_MERGE');
      }
      const next = factInsertValues({ userId, ...input, createdBy: 'user', confidence: 1 });
      tx.insert(careerFacts).values(next).run();
      const evidence = tx.select().from(careerFactEvidence).where(and(
        eq(careerFactEvidence.userId, userId), inArray(careerFactEvidence.careerFactId, factIds),
      )).all();
      const evidenceKeys = new Set<string>();
      for (const item of evidence) {
        const key = `${item.sourceDocumentId}\0${item.locator}\0${item.contentHash}`;
        if (evidenceKeys.has(key)) continue;
        evidenceKeys.add(key);
        tx.insert(careerFactEvidence).values({ ...item, id: crypto.randomUUID(), careerFactId: next.id }).run();
      }
      const claims = tx.select().from(careerFactClaims).where(and(
        eq(careerFactClaims.userId, userId), inArray(careerFactClaims.careerFactId, factIds),
      )).all();
      const claimKeys = new Set<string>();
      for (const item of claims) {
        const key = `${item.claimType}\0${item.normalizedClaim}`;
        if (claimKeys.has(key)) continue;
        claimKeys.add(key);
        tx.insert(careerFactClaims).values({ ...item, id: crypto.randomUUID(), careerFactId: next.id }).run();
      }
      for (const sourceId of factIds) {
        tx.insert(careerFactRelations).values({
          id: crypto.randomUUID(), userId, careerFactId: next.id, relatedFactId: sourceId, relationType: 'merged-from',
        }).run();
      }
      tx.insert(factReviewEvents).values(eventValues({
        userId, factId: next.id, actorUserId: userId, action: 'merged',
        beforeState: { sourceFactIds: factIds }, afterState: factState(next as FactRow),
      })).run();
      return tx.select().from(careerFacts).where(eq(careerFacts.id, next.id)).limit(1).get()!;
    };
    if (config.db.type === 'sqlite') return db.transaction(mergeSync);

    return db.transaction(async (tx: typeof db) => {
      const sources = await tx.select().from(careerFacts).where(and(
        eq(careerFacts.userId, userId), inArray(careerFacts.id, factIds),
      ));
      if (sources.length !== factIds.length || sources.some(
        (row: FactRow) => row.status !== 'draft' && row.status !== 'approved',
      )) {
        throw new CareerRepositoryError('INVALID_MERGE');
      }
      const next = factInsertValues({ userId, ...input, createdBy: 'user', confidence: 1 });
      await tx.insert(careerFacts).values(next);
      const evidence = await tx.select().from(careerFactEvidence).where(and(
        eq(careerFactEvidence.userId, userId), inArray(careerFactEvidence.careerFactId, factIds),
      ));
      const evidenceKeys = new Set<string>();
      const uniqueEvidence = evidence.filter((item: EvidenceRow) => {
        const key = `${item.sourceDocumentId}\0${item.locator}\0${item.contentHash}`;
        if (evidenceKeys.has(key)) return false;
        evidenceKeys.add(key);
        return true;
      });
      if (uniqueEvidence.length > 0) {
        await tx.insert(careerFactEvidence).values(uniqueEvidence.map((item: EvidenceRow) => ({
          ...item, id: crypto.randomUUID(), careerFactId: next.id,
        })));
      }
      const claims = await tx.select().from(careerFactClaims).where(and(
        eq(careerFactClaims.userId, userId), inArray(careerFactClaims.careerFactId, factIds),
      ));
      const claimKeys = new Set<string>();
      const uniqueClaims = claims.filter((item: ClaimRow) => {
        const key = `${item.claimType}\0${item.normalizedClaim}`;
        if (claimKeys.has(key)) return false;
        claimKeys.add(key);
        return true;
      });
      if (uniqueClaims.length > 0) {
        await tx.insert(careerFactClaims).values(uniqueClaims.map((item: ClaimRow) => ({
          ...item, id: crypto.randomUUID(), careerFactId: next.id,
        })));
      }
      await tx.insert(careerFactRelations).values(factIds.map((sourceId) => ({
        id: crypto.randomUUID(), userId, careerFactId: next.id, relatedFactId: sourceId,
        relationType: 'merged-from' as const,
      })));
      await tx.insert(factReviewEvents).values(eventValues({
        userId, factId: next.id, actorUserId: userId, action: 'merged',
        beforeState: { sourceFactIds: factIds }, afterState: factState(next as FactRow),
      }));
      const created = await tx.select().from(careerFacts).where(eq(careerFacts.id, next.id)).limit(1);
      return created[0];
    });
  },

  async importSnapshotOwned(input: CareerSnapshotImportInput) {
    const repositoryValues = {
      id: crypto.randomUUID(),
      userId: input.userId,
      sourceType: input.repository.sourceType,
      sourceConnectionId: input.repository.sourceConnectionId || null,
      externalRepositoryId: input.repository.externalRepositoryId,
      fullName: input.repository.fullName,
      defaultBranch: input.repository.defaultBranch,
      selected: true,
    } satisfies typeof sourceRepositories.$inferInsert;

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        tx.insert(sourceRepositories).values(repositoryValues).onConflictDoNothing().run();
        const repository = tx.select().from(sourceRepositories).where(and(
          eq(sourceRepositories.userId, input.userId),
          eq(sourceRepositories.sourceType, input.repository.sourceType),
          eq(sourceRepositories.externalRepositoryId, input.repository.externalRepositoryId),
        )).limit(1).get();
        if (!repository) throw new CareerRepositoryError('IMPORT_CONFLICT');
        const existingSnapshot = tx.select().from(sourceSnapshots).where(and(
          eq(sourceSnapshots.sourceRepositoryId, repository.id),
          eq(sourceSnapshots.commitSha, input.commitSha),
          eq(sourceSnapshots.parserId, input.parserId),
          eq(sourceSnapshots.parserVersion, input.parserVersion),
        )).limit(1).get();
        if (existingSnapshot?.status === 'ready') {
          return { repositoryId: repository.id, snapshotId: existingSnapshot.id, alreadyImported: true,
            documentsCreated: 0, factsCreated: 0, factsReused: 0, evidenceCreated: 0, claimsCreated: 0 };
        }
        if (existingSnapshot) throw new CareerRepositoryError('IMPORT_CONFLICT');
        const snapshotId = crypto.randomUUID();
        tx.insert(sourceSnapshots).values({
          id: snapshotId, userId: input.userId, sourceRepositoryId: repository.id,
          commitSha: input.commitSha, treeSha: input.treeSha || null,
          parentSnapshotId: input.parentSnapshotId || null, status: 'processing',
          parserId: input.parserId, parserVersion: input.parserVersion,
        }).run();
        const documentIds = new Map<string, string>();
        for (const document of input.documents) {
          const id = crypto.randomUUID();
          documentIds.set(document.path, id);
          tx.insert(sourceDocuments).values({
            id, userId: input.userId, sourceSnapshotId: snapshotId,
            path: document.path, blobSha: document.blobSha || null,
            contentHash: document.contentHash, mimeType: document.mimeType,
            sizeBytes: document.sizeBytes, textContent: document.textContent || null,
            parseStatus: document.parseStatus || 'ready',
            securityFindings: document.securityFindings || [],
            llmEligible: document.llmEligible ?? true,
            parserId: input.parserId, parserVersion: input.parserVersion,
          }).run();
        }
        let factsCreated = 0;
        let factsReused = 0;
        let evidenceCreated = 0;
        let claimsCreated = 0;
        for (const candidate of input.facts) {
          let fact = tx.select().from(careerFacts).where(and(
            eq(careerFacts.userId, input.userId),
            eq(careerFacts.canonicalKey, candidate.canonicalKey),
            eq(careerFacts.contentHash, candidate.contentHash),
          )).limit(1).get();
          if (!fact) {
            const values = factInsertValues({
              userId: input.userId, ...candidate, createdBy: 'import',
              sourceParserId: input.parserId, sourceParserVersion: input.parserVersion,
            });
            tx.insert(careerFacts).values(values).run();
            fact = tx.select().from(careerFacts).where(eq(careerFacts.id, values.id)).limit(1).get()!;
            tx.insert(factReviewEvents).values(eventValues({
              userId: input.userId, factId: fact.id, action: 'imported', afterState: factState(fact),
            })).run();
            factsCreated++;
          } else {
            factsReused++;
          }
          for (const evidence of candidate.evidence) {
            const sourceDocumentId = documentIds.get(evidence.documentPath);
            if (!sourceDocumentId) throw new CareerRepositoryError('IMPORT_CONFLICT');
            tx.insert(careerFactEvidence).values({
              id: crypto.randomUUID(), userId: input.userId, careerFactId: fact.id,
              sourceDocumentId, commitSha: input.commitSha, path: evidence.documentPath,
              locator: evidence.locator, contentHash: evidence.contentHash,
              excerptHash: evidence.excerptHash || null, summary: evidence.summary || '',
              parserId: input.parserId, parserVersion: input.parserVersion,
            }).onConflictDoNothing().run();
            evidenceCreated++;
          }
          for (const claim of candidate.claims) {
            const normalized = normalizeClaim(claim.claim);
            if (!normalized) continue;
            tx.insert(careerFactClaims).values({
              id: crypto.randomUUID(), userId: input.userId, careerFactId: fact.id,
              claimType: claim.type, claim: claim.claim, normalizedClaim: normalized,
              contentHash: claimContentHash(claim.type, claim.claim),
            }).onConflictDoNothing().run();
            claimsCreated++;
          }
        }
        tx.update(sourceSnapshots).set({ status: 'ready', completedAt: new Date(), errorCode: null })
          .where(eq(sourceSnapshots.id, snapshotId)).run();
        tx.update(sourceRepositories).set({
          fullName: input.repository.fullName,
          defaultBranch: input.repository.defaultBranch,
          sourceConnectionId: input.repository.sourceConnectionId || repository.sourceConnectionId,
          lastHeadSha: input.commitSha,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(sourceRepositories.id, repository.id)).run();
        return { repositoryId: repository.id, snapshotId, alreadyImported: false,
          documentsCreated: input.documents.length, factsCreated, factsReused, evidenceCreated, claimsCreated };
      });
    }

    return db.transaction(async (tx: typeof db) => {
      await tx.insert(sourceRepositories).values(repositoryValues).onConflictDoNothing();
      const repositories = await tx.select().from(sourceRepositories).where(and(
        eq(sourceRepositories.userId, input.userId),
        eq(sourceRepositories.sourceType, input.repository.sourceType),
        eq(sourceRepositories.externalRepositoryId, input.repository.externalRepositoryId),
      )).limit(1);
      const repository = repositories[0];
      if (!repository) throw new CareerRepositoryError('IMPORT_CONFLICT');
      const existingSnapshots = await tx.select().from(sourceSnapshots).where(and(
        eq(sourceSnapshots.sourceRepositoryId, repository.id),
        eq(sourceSnapshots.commitSha, input.commitSha),
        eq(sourceSnapshots.parserId, input.parserId),
        eq(sourceSnapshots.parserVersion, input.parserVersion),
      )).limit(1);
      if (existingSnapshots[0]?.status === 'ready') {
        return { repositoryId: repository.id, snapshotId: existingSnapshots[0].id, alreadyImported: true,
          documentsCreated: 0, factsCreated: 0, factsReused: 0, evidenceCreated: 0, claimsCreated: 0 };
      }
      if (existingSnapshots[0]) throw new CareerRepositoryError('IMPORT_CONFLICT');
      const snapshotId = crypto.randomUUID();
      await tx.insert(sourceSnapshots).values({
        id: snapshotId, userId: input.userId, sourceRepositoryId: repository.id,
        commitSha: input.commitSha, treeSha: input.treeSha || null,
        parentSnapshotId: input.parentSnapshotId || null, status: 'processing',
        parserId: input.parserId, parserVersion: input.parserVersion,
      });
      const documentIds = new Map<string, string>();
      const documentValues = input.documents.map((document) => {
        const id = crypto.randomUUID();
        documentIds.set(document.path, id);
        return {
          id, userId: input.userId, sourceSnapshotId: snapshotId,
          path: document.path, blobSha: document.blobSha || null,
          contentHash: document.contentHash, mimeType: document.mimeType,
          sizeBytes: document.sizeBytes, textContent: document.textContent || null,
          parseStatus: document.parseStatus || 'ready' as const,
          securityFindings: document.securityFindings || [],
          llmEligible: document.llmEligible ?? true,
          parserId: input.parserId, parserVersion: input.parserVersion,
        } satisfies typeof sourceDocuments.$inferInsert;
      });
      if (documentValues.length > 0) await tx.insert(sourceDocuments).values(documentValues);
      let factsCreated = 0;
      let factsReused = 0;
      let evidenceCreated = 0;
      let claimsCreated = 0;
      for (const candidate of input.facts) {
        const existingFacts = await tx.select().from(careerFacts).where(and(
          eq(careerFacts.userId, input.userId),
          eq(careerFacts.canonicalKey, candidate.canonicalKey),
          eq(careerFacts.contentHash, candidate.contentHash),
        )).limit(1);
        let fact = existingFacts[0];
        if (!fact) {
          const values = factInsertValues({
            userId: input.userId, ...candidate, createdBy: 'import',
            sourceParserId: input.parserId, sourceParserVersion: input.parserVersion,
          });
          await tx.insert(careerFacts).values(values);
          const created = await tx.select().from(careerFacts).where(eq(careerFacts.id, values.id)).limit(1);
          fact = created[0];
          await tx.insert(factReviewEvents).values(eventValues({
            userId: input.userId, factId: fact.id, action: 'imported', afterState: factState(fact),
          }));
          factsCreated++;
        } else {
          factsReused++;
        }
        const evidenceValues = candidate.evidence.map((evidence) => {
          const sourceDocumentId = documentIds.get(evidence.documentPath);
          if (!sourceDocumentId) throw new CareerRepositoryError('IMPORT_CONFLICT');
          return {
            id: crypto.randomUUID(), userId: input.userId, careerFactId: fact.id,
            sourceDocumentId, commitSha: input.commitSha, path: evidence.documentPath,
            locator: evidence.locator, contentHash: evidence.contentHash,
            excerptHash: evidence.excerptHash || null, summary: evidence.summary || '',
            parserId: input.parserId, parserVersion: input.parserVersion,
          } satisfies typeof careerFactEvidence.$inferInsert;
        });
        if (evidenceValues.length > 0) {
          await tx.insert(careerFactEvidence).values(evidenceValues).onConflictDoNothing();
          evidenceCreated += evidenceValues.length;
        }
        const claimValues = candidate.claims.flatMap((claim) => {
          const normalized = normalizeClaim(claim.claim);
          return normalized ? [{
            id: crypto.randomUUID(), userId: input.userId, careerFactId: fact.id,
            claimType: claim.type, claim: claim.claim, normalizedClaim: normalized,
            contentHash: claimContentHash(claim.type, claim.claim),
          } satisfies typeof careerFactClaims.$inferInsert] : [];
        });
        if (claimValues.length > 0) {
          await tx.insert(careerFactClaims).values(claimValues).onConflictDoNothing();
          claimsCreated += claimValues.length;
        }
      }
      await tx.update(sourceSnapshots).set({ status: 'ready', completedAt: new Date(), errorCode: null })
        .where(eq(sourceSnapshots.id, snapshotId));
      await tx.update(sourceRepositories).set({
        fullName: input.repository.fullName,
        defaultBranch: input.repository.defaultBranch,
        sourceConnectionId: input.repository.sourceConnectionId || repository.sourceConnectionId,
        lastHeadSha: input.commitSha,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sourceRepositories.id, repository.id));
      return { repositoryId: repository.id, snapshotId, alreadyImported: false,
        documentsCreated: input.documents.length, factsCreated, factsReused, evidenceCreated, claimsCreated };
    });
  },

  async markEvidenceStaleForMissingBlobsOwned(
    userId: string,
    sourceRepositoryId: string,
    currentBlobShas: ReadonlySet<string>,
  ) {
    const rows = await db.select({
      id: sourceDocuments.id,
      blobSha: sourceDocuments.blobSha,
    }).from(sourceDocuments).innerJoin(
      sourceSnapshots,
      eq(sourceSnapshots.id, sourceDocuments.sourceSnapshotId),
    ).where(and(
      eq(sourceDocuments.userId, userId),
      eq(sourceSnapshots.userId, userId),
      eq(sourceSnapshots.sourceRepositoryId, sourceRepositoryId),
      eq(sourceSnapshots.status, 'ready'),
    ));
    const staleDocumentIds = rows.flatMap((row: { id: string; blobSha: string | null }) => (
      row.blobSha && !currentBlobShas.has(row.blobSha) ? [row.id] : []
    ));
    if (staleDocumentIds.length === 0) return 0;
    const result = await db.update(careerFactEvidence).set({ stale: true }).where(and(
      eq(careerFactEvidence.userId, userId),
      inArray(careerFactEvidence.sourceDocumentId, staleDocumentIds),
    ));
    return Number((result as { changes?: number }).changes || staleDocumentIds.length);
  },

  async loadPolicyOwned(userId: string): Promise<CareerKnowledgePolicy> {
    const approved = await db.select().from(careerFacts).where(and(
      eq(careerFacts.userId, userId),
      eq(careerFacts.status, 'approved'),
    )).orderBy(careerFacts.factType, careerFacts.title);
    const ids = approved.map((fact: FactRow) => fact.id);
    const [evidence, allowedClaims, forbiddenRows] = await Promise.all([
      ids.length > 0
        ? db.select().from(careerFactEvidence).where(and(
          eq(careerFactEvidence.userId, userId),
          inArray(careerFactEvidence.careerFactId, ids),
          eq(careerFactEvidence.stale, false),
        ))
        : Promise.resolve([] as EvidenceRow[]),
      ids.length > 0
        ? db.select().from(careerFactClaims).where(and(
          eq(careerFactClaims.userId, userId),
          inArray(careerFactClaims.careerFactId, ids),
          eq(careerFactClaims.claimType, 'allowed'),
        ))
        : Promise.resolve([] as ClaimRow[]),
      db.select({ claim: careerFactClaims.claim }).from(careerFactClaims)
        .innerJoin(careerFacts, eq(careerFacts.id, careerFactClaims.careerFactId))
        .where(and(
          eq(careerFactClaims.userId, userId),
          eq(careerFacts.userId, userId),
          eq(careerFactClaims.claimType, 'forbidden'),
          ne(careerFacts.status, 'superseded'),
        )),
    ]);
    const facts = approved.map((fact: FactRow) => ({
      id: fact.id,
      factType: fact.factType as CareerFactType,
      title: fact.title,
      summary: fact.summary,
      structuredData: safeJsonRecord(parseJsonColumn(fact.structuredData, {})),
      evidence: evidence.filter((item: EvidenceRow) => item.careerFactId === fact.id).map((item: EvidenceRow) => ({
        id: item.id,
        commitSha: item.commitSha,
        path: item.path,
        locator: item.locator,
        contentHash: item.contentHash,
        summary: item.summary,
      })),
      allowedClaims: allowedClaims.filter((item: ClaimRow) => item.careerFactId === fact.id)
        .map((item: ClaimRow) => item.claim),
    }));
    return {
      facts,
      approvedEvidenceIds: new Set(evidence.map((item: EvidenceRow) => item.id)),
      forbiddenClaims: [...new Set<string>(
        (forbiddenRows as Array<{ claim: string }>).map((row) => row.claim),
      )],
    };
  },
};
