import { and, desc, eq, sql } from 'drizzle-orm';

import { config } from '@/lib/config';
import {
  applyPreparedOperations,
  prepareResumePatch,
  type PreparedResumeOperation,
  type ResumePatchReferencePolicy,
} from '@/lib/resume-patch/operations';
import { resumePatchSchema, type ResumePatch } from '@/lib/resume-patch/schema';
import {
  canonicalJson,
  contentHash,
  createResumeSnapshot,
  parseResumeSnapshot,
  type ResumeSnapshot,
} from '@/lib/resume-patch/snapshot';

import { db } from '../index';
import {
  auditEvents,
  resumeChangeOperations,
  resumeChangeSets,
  resumeSections,
  resumeVersions,
  resumes,
} from '../schema';

type ResumeVersionSource = 'manual' | 'ai-change-set' | 'restore' | 'import';
type ChangeSetStatus = 'proposed' | 'validated' | 'stale' | 'partially_applied' | 'applied' | 'rejected' | 'failed';

export class ResumeChangeRepositoryError extends Error {
  constructor(public readonly code:
    | 'RESUME_NOT_FOUND'
    | 'VERSION_NOT_FOUND'
    | 'CHANGE_SET_NOT_FOUND'
    | 'CHANGE_SET_NOT_APPLICABLE'
    | 'STALE_BASE_VERSION'
    | 'INVALID_OPERATION_SELECTION'
  ) {
    super(code);
    this.name = 'ResumeChangeRepositoryError';
  }
}

type CreateChangeSetInput = {
  id?: string;
  userId: string;
  resumeId: string;
  baseVersionId: string;
  patch: ResumePatch;
  prepared: PreparedResumeOperation[];
  llmProfileId?: string | null;
  provider?: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  requestId?: string | null;
  rawModelOutput?: string | null;
};

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function buildResume(row: typeof resumes.$inferSelect, sections: typeof resumeSections.$inferSelect[]) {
  return { ...row, sections };
}

function versionValues(input: {
  userId: string;
  resumeId: string;
  versionNumber: number;
  snapshot: ResumeSnapshot;
  source: ResumeVersionSource;
  createdBy?: string | null;
}) {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    resumeId: input.resumeId,
    versionNumber: input.versionNumber,
    snapshot: input.snapshot,
    source: input.source,
    createdBy: input.createdBy || input.userId,
  } satisfies typeof resumeVersions.$inferInsert;
}

function operationValues(changeSetId: string, prepared: PreparedResumeOperation, sortOrder: number) {
  const operation = prepared.operation;
  return {
    id: crypto.randomUUID(),
    changeSetId,
    operationId: operation.operationId,
    sortOrder,
    type: operation.type,
    sectionId: 'sectionId' in operation ? operation.sectionId ?? null : null,
    itemId: 'itemId' in operation ? operation.itemId ?? null : null,
    expectedHash: operation.expectedHash,
    value: 'value' in operation ? operation.value ?? null : null,
    reason: operation.reason,
    evidenceIds: operation.evidenceIds,
    jdRequirementIds: operation.jdRequirementIds,
    confidenceBasisPoints: Math.round(operation.confidence * 10_000),
    diff: prepared.diff,
  } satisfies typeof resumeChangeOperations.$inferInsert;
}

function serializeChangeSet(
  changeSet: typeof resumeChangeSets.$inferSelect,
  operations: typeof resumeChangeOperations.$inferSelect[],
) {
  return {
    ...changeSet,
    warnings: parseJsonColumn<string[]>(changeSet.warnings, []),
    validationResult: parseJsonColumn<Record<string, unknown>>(changeSet.validationResult, {}),
    operations: operations.map((operation) => ({
      id: operation.id,
      operationId: operation.operationId,
      type: operation.type,
      sectionId: operation.sectionId,
      itemId: operation.itemId,
      expectedHash: operation.expectedHash,
      value: parseJsonColumn(operation.value, null),
      reason: operation.reason,
      evidenceIds: parseJsonColumn<string[]>(operation.evidenceIds, []),
      jdRequirementIds: parseJsonColumn<string[]>(operation.jdRequirementIds, []),
      confidence: operation.confidenceBasisPoints / 10_000,
      diff: parseJsonColumn(operation.diff, {}),
      selected: Boolean(operation.selected),
      result: operation.result,
      errorCode: operation.errorCode,
    })),
  };
}

function writeLiveResumeSync(tx: typeof db, snapshot: ResumeSnapshot) {
  tx.update(resumes)
    .set({
      title: snapshot.resume.title,
      template: snapshot.resume.template,
      themeConfig: snapshot.resume.themeConfig,
      language: snapshot.resume.language,
      updatedAt: new Date(),
    })
    .where(eq(resumes.id, snapshot.resume.id))
    .run();
  tx.delete(resumeSections).where(eq(resumeSections.resumeId, snapshot.resume.id)).run();
  for (const section of snapshot.sections) {
    tx.insert(resumeSections).values({
      id: section.id,
      resumeId: snapshot.resume.id,
      type: section.type,
      title: section.title,
      sortOrder: section.sortOrder,
      visible: section.visible,
      content: section.content,
    }).run();
  }
}

async function writeLiveResumeAsync(tx: typeof db, snapshot: ResumeSnapshot) {
  await tx.update(resumes)
    .set({
      title: snapshot.resume.title,
      template: snapshot.resume.template,
      themeConfig: snapshot.resume.themeConfig,
      language: snapshot.resume.language,
      updatedAt: new Date(),
    })
    .where(eq(resumes.id, snapshot.resume.id));
  await tx.delete(resumeSections).where(eq(resumeSections.resumeId, snapshot.resume.id));
  for (const section of snapshot.sections) {
    await tx.insert(resumeSections).values({
      id: section.id,
      resumeId: snapshot.resume.id,
      type: section.type,
      title: section.title,
      sortOrder: section.sortOrder,
      visible: section.visible,
      content: section.content,
    });
  }
}

export const resumeChangeRepository = {
  async findLatestVersionOwned(userId: string, resumeId: string) {
    const rows = await db.select().from(resumeVersions)
      .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
      .orderBy(desc(resumeVersions.versionNumber))
      .limit(1);
    return rows[0] ?? null;
  },

  async findVersionOwned(userId: string, resumeId: string, versionId: string) {
    const rows = await db.select().from(resumeVersions)
      .where(and(
        eq(resumeVersions.id, versionId),
        eq(resumeVersions.userId, userId),
        eq(resumeVersions.resumeId, resumeId),
      ))
      .limit(1);
    return rows[0] ?? null;
  },

  async listVersionsOwned(userId: string, resumeId: string) {
    return db.select({
      id: resumeVersions.id,
      versionNumber: resumeVersions.versionNumber,
      source: resumeVersions.source,
      createdBy: resumeVersions.createdBy,
      createdAt: resumeVersions.createdAt,
    }).from(resumeVersions)
      .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
      .orderBy(desc(resumeVersions.versionNumber));
  },

  async ensureCurrentVersionOwned(
    userId: string,
    resumeId: string,
    source: ResumeVersionSource = 'manual',
  ) {
    const existing = await this.findLatestVersionOwned(userId, resumeId);
    if (existing) return existing;

    if (config.db.type === 'sqlite') {
      try {
        return db.transaction((tx: typeof db) => {
          const latest = tx.select().from(resumeVersions)
            .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
            .orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
          if (latest) return latest;
          const row = tx.select().from(resumes)
            .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1).get();
          if (!row) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
          const sections = tx.select().from(resumeSections)
            .where(eq(resumeSections.resumeId, resumeId)).orderBy(resumeSections.sortOrder).all();
          const values = versionValues({
            userId,
            resumeId,
            versionNumber: 1,
            snapshot: createResumeSnapshot(buildResume(row, sections)),
            source,
          });
          tx.insert(resumeVersions).values(values).run();
          return tx.select().from(resumeVersions).where(eq(resumeVersions.id, values.id)).limit(1).get()!;
        });
      } catch (error) {
        if (error instanceof ResumeChangeRepositoryError) throw error;
        const raced = await this.findLatestVersionOwned(userId, resumeId);
        if (raced) return raced;
        throw error;
      }
    }

    try {
      return await db.transaction(async (tx: typeof db) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${resumeId}))`);
        const latestRows = await tx.select().from(resumeVersions)
          .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
          .orderBy(desc(resumeVersions.versionNumber)).limit(1);
        if (latestRows[0]) return latestRows[0];
        const rows = await tx.select().from(resumes)
          .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1);
        if (!rows[0]) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
        const sections = await tx.select().from(resumeSections)
          .where(eq(resumeSections.resumeId, resumeId)).orderBy(resumeSections.sortOrder);
        const values = versionValues({
          userId,
          resumeId,
          versionNumber: 1,
          snapshot: createResumeSnapshot(buildResume(rows[0], sections)),
          source,
        });
        await tx.insert(resumeVersions).values(values);
        const created = await tx.select().from(resumeVersions).where(eq(resumeVersions.id, values.id)).limit(1);
        return created[0];
      });
    } catch (error) {
      if (error instanceof ResumeChangeRepositoryError) throw error;
      const raced = await this.findLatestVersionOwned(userId, resumeId);
      if (raced) return raced;
      throw error;
    }
  },

  async saveManualSnapshotOwned(userId: string, resumeId: string, snapshot: ResumeSnapshot) {
    if (snapshot.resume.id !== resumeId) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const row = tx.select().from(resumes)
          .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1).get();
        if (!row) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
        const sections = tx.select().from(resumeSections)
          .where(eq(resumeSections.resumeId, resumeId)).orderBy(resumeSections.sortOrder).all();
        let latest = tx.select().from(resumeVersions)
          .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
          .orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
        if (!latest) {
          const initial = versionValues({
            userId, resumeId, versionNumber: 1,
            snapshot: createResumeSnapshot(buildResume(row, sections)), source: 'manual',
          });
          tx.insert(resumeVersions).values(initial).run();
          latest = tx.select().from(resumeVersions).where(eq(resumeVersions.id, initial.id)).limit(1).get()!;
        }
        if (canonicalJson(parseResumeSnapshot(latest.snapshot)) === canonicalJson(snapshot)) return latest;
        writeLiveResumeSync(tx, snapshot);
        const next = versionValues({
          userId, resumeId, versionNumber: latest.versionNumber + 1, snapshot, source: 'manual',
        });
        tx.insert(resumeVersions).values(next).run();
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(), actorUserId: userId, action: 'resume.version_created',
          targetType: 'resume', targetId: resumeId, outcome: 'success',
          metadata: { versionId: next.id, versionNumber: next.versionNumber, source: 'manual' },
        }).run();
        return tx.select().from(resumeVersions).where(eq(resumeVersions.id, next.id)).limit(1).get()!;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${resumeId}))`);
      const rows = await tx.select().from(resumes)
        .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1);
      if (!rows[0]) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
      const sections = await tx.select().from(resumeSections)
        .where(eq(resumeSections.resumeId, resumeId)).orderBy(resumeSections.sortOrder);
      const latestRows = await tx.select().from(resumeVersions)
        .where(and(eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId)))
        .orderBy(desc(resumeVersions.versionNumber)).limit(1);
      let latest = latestRows[0];
      if (!latest) {
        const initial = versionValues({
          userId, resumeId, versionNumber: 1,
          snapshot: createResumeSnapshot(buildResume(rows[0], sections)), source: 'manual',
        });
        await tx.insert(resumeVersions).values(initial);
        latest = { ...initial, createdAt: new Date() } as typeof resumeVersions.$inferSelect;
      }
      if (canonicalJson(parseResumeSnapshot(latest.snapshot)) === canonicalJson(snapshot)) return latest;
      await writeLiveResumeAsync(tx, snapshot);
      const next = versionValues({
        userId, resumeId, versionNumber: latest.versionNumber + 1, snapshot, source: 'manual',
      });
      await tx.insert(resumeVersions).values(next);
      await tx.insert(auditEvents).values({
        id: crypto.randomUUID(), actorUserId: userId, action: 'resume.version_created',
        targetType: 'resume', targetId: resumeId, outcome: 'success',
        metadata: { versionId: next.id, versionNumber: next.versionNumber, source: 'manual' },
      });
      const created = await tx.select().from(resumeVersions).where(eq(resumeVersions.id, next.id)).limit(1);
      return created[0];
    });
  },

  async createChangeSetOwned(input: CreateChangeSetInput) {
    const id = input.id || crypto.randomUUID();
    const setValues = {
      id,
      userId: input.userId,
      resumeId: input.resumeId,
      baseVersionId: input.baseVersionId,
      status: 'validated' as const,
      llmProfileId: input.llmProfileId || null,
      provider: input.provider || null,
      modelName: input.modelName || null,
      promptVersion: input.promptVersion || 'resume-patch-v1',
      requestId: input.requestId || null,
      summary: input.patch.summary,
      warnings: input.patch.warnings,
      validationResult: { valid: true, operationCount: input.prepared.length },
      rawModelOutput: input.rawModelOutput?.slice(0, 100_000) || null,
    } satisfies typeof resumeChangeSets.$inferInsert;

    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.insert(resumeChangeSets).values(setValues).run();
        input.prepared.forEach((operation, index) => {
          tx.insert(resumeChangeOperations).values(operationValues(id, operation, index)).run();
        });
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(), actorUserId: input.userId, action: 'resume.change_set_created',
          targetType: 'resume_change_set', targetId: id, outcome: 'success',
          metadata: {
            resumeId: input.resumeId,
            baseVersionId: input.baseVersionId,
            operationCount: input.prepared.length,
            provider: input.provider || null,
            modelName: input.modelName || null,
          },
        }).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        await tx.insert(resumeChangeSets).values(setValues);
        for (let index = 0; index < input.prepared.length; index++) {
          await tx.insert(resumeChangeOperations).values(operationValues(id, input.prepared[index], index));
        }
        await tx.insert(auditEvents).values({
          id: crypto.randomUUID(), actorUserId: input.userId, action: 'resume.change_set_created',
          targetType: 'resume_change_set', targetId: id, outcome: 'success',
          metadata: {
            resumeId: input.resumeId,
            baseVersionId: input.baseVersionId,
            operationCount: input.prepared.length,
            provider: input.provider || null,
            modelName: input.modelName || null,
          },
        });
      });
    }
    return this.findChangeSetOwned(input.userId, input.resumeId, id);
  },

  async findChangeSetOwned(userId: string, resumeId: string, changeSetId: string) {
    const rows = await db.select().from(resumeChangeSets).where(and(
      eq(resumeChangeSets.id, changeSetId),
      eq(resumeChangeSets.userId, userId),
      eq(resumeChangeSets.resumeId, resumeId),
    )).limit(1);
    if (!rows[0]) return null;
    const operations = await db.select().from(resumeChangeOperations)
      .where(eq(resumeChangeOperations.changeSetId, changeSetId))
      .orderBy(resumeChangeOperations.sortOrder);
    return serializeChangeSet(rows[0], operations);
  },

  async listChangeSetsOwned(userId: string, resumeId: string) {
    const rows = await db.select().from(resumeChangeSets).where(and(
      eq(resumeChangeSets.userId, userId),
      eq(resumeChangeSets.resumeId, resumeId),
    )).orderBy(desc(resumeChangeSets.createdAt));
    return Promise.all(rows.map(async (row: typeof resumeChangeSets.$inferSelect) => {
      const operations = await db.select().from(resumeChangeOperations)
        .where(eq(resumeChangeOperations.changeSetId, row.id))
        .orderBy(resumeChangeOperations.sortOrder);
      return serializeChangeSet(row, operations);
    }));
  },

  async markChangeSetStatusOwned(userId: string, resumeId: string, changeSetId: string, status: ChangeSetStatus) {
    await db.update(resumeChangeSets).set({ status, updatedAt: new Date() }).where(and(
      eq(resumeChangeSets.id, changeSetId),
      eq(resumeChangeSets.userId, userId),
      eq(resumeChangeSets.resumeId, resumeId),
    ));
  },

  async rejectChangeSetOwned(userId: string, resumeId: string, changeSetId: string, note?: string) {
    const loaded = await this.findChangeSetOwned(userId, resumeId, changeSetId);
    if (!loaded) throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_FOUND');
    if (loaded.status !== 'validated' && loaded.status !== 'proposed') {
      throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_APPLICABLE');
    }
    const metadata = {
      resumeId,
      note: note || null,
      operationCount: loaded.operations.length,
    };
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.update(resumeChangeSets).set({
          status: 'rejected',
          updatedAt: new Date(),
        }).where(and(
          eq(resumeChangeSets.id, changeSetId),
          eq(resumeChangeSets.userId, userId),
          eq(resumeChangeSets.resumeId, resumeId),
        )).run();
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(),
          actorUserId: userId,
          action: 'resume.change_set_rejected',
          targetType: 'resume_change_set',
          targetId: changeSetId,
          outcome: 'success',
          metadata,
        }).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        await tx.update(resumeChangeSets).set({
          status: 'rejected',
          updatedAt: new Date(),
        }).where(and(
          eq(resumeChangeSets.id, changeSetId),
          eq(resumeChangeSets.userId, userId),
          eq(resumeChangeSets.resumeId, resumeId),
        ));
        await tx.insert(auditEvents).values({
          id: crypto.randomUUID(),
          actorUserId: userId,
          action: 'resume.change_set_rejected',
          targetType: 'resume_change_set',
          targetId: changeSetId,
          outcome: 'success',
          metadata,
        });
      });
    }
    return this.findChangeSetOwned(userId, resumeId, changeSetId);
  },

  async applyChangeSetOwned(input: {
    userId: string;
    resumeId: string;
    changeSetId: string;
    operationIds: string[];
    policy?: ResumePatchReferencePolicy;
    afterLiveWriteForTest?: () => void | Promise<void>;
  }) {
    const loaded = await this.findChangeSetOwned(input.userId, input.resumeId, input.changeSetId);
    if (!loaded) throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_FOUND');
    if (loaded.status !== 'validated' && loaded.status !== 'proposed') {
      throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_APPLICABLE');
    }
    const selectedIds = new Set(input.operationIds);
    if (selectedIds.size === 0 || selectedIds.size !== input.operationIds.length
      || input.operationIds.some((id) => !loaded.operations.some((operation) => operation.operationId === id))) {
      throw new ResumeChangeRepositoryError('INVALID_OPERATION_SELECTION');
    }

    const buildPrepared = (latestSnapshot: ResumeSnapshot) => {
      const patch = resumePatchSchema.parse({
        schemaVersion: 1,
        resumeId: input.resumeId,
        baseVersionId: loaded.baseVersionId,
        summary: loaded.summary,
        warnings: loaded.warnings,
        operations: loaded.operations.map((operation) => ({
          operationId: operation.operationId,
          type: operation.type,
          ...(operation.sectionId !== null ? { sectionId: operation.sectionId } : {}),
          ...(operation.itemId !== null ? { itemId: operation.itemId } : {}),
          expectedHash: operation.expectedHash,
          ...(operation.value !== null ? { value: operation.value } : {}),
          reason: operation.reason,
          evidenceIds: operation.evidenceIds,
          jdRequirementIds: operation.jdRequirementIds,
          confidence: operation.confidence,
        })),
      });
      return prepareResumePatch(latestSnapshot, patch, input.policy)
        .filter((prepared) => selectedIds.has(prepared.operation.operationId));
    };

    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const changeSet = tx.select().from(resumeChangeSets).where(and(
          eq(resumeChangeSets.id, input.changeSetId),
          eq(resumeChangeSets.userId, input.userId),
          eq(resumeChangeSets.resumeId, input.resumeId),
        )).limit(1).get();
        if (!changeSet) throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_FOUND');
        if (changeSet.status !== 'validated' && changeSet.status !== 'proposed') {
          throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_APPLICABLE');
        }
        const latest = tx.select().from(resumeVersions).where(and(
          eq(resumeVersions.userId, input.userId), eq(resumeVersions.resumeId, input.resumeId),
        )).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
        if (!latest || latest.id !== changeSet.baseVersionId) {
          throw new ResumeChangeRepositoryError('STALE_BASE_VERSION');
        }
        const row = tx.select().from(resumes).where(and(
          eq(resumes.id, input.resumeId), eq(resumes.userId, input.userId),
        )).limit(1).get();
        if (!row) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
        const sections = tx.select().from(resumeSections).where(eq(resumeSections.resumeId, input.resumeId))
          .orderBy(resumeSections.sortOrder).all();
        const baseSnapshot = parseResumeSnapshot(latest.snapshot);
        if (contentHash(createResumeSnapshot(buildResume(row, sections))) !== contentHash(baseSnapshot)) {
          throw new ResumeChangeRepositoryError('STALE_BASE_VERSION');
        }
        const selected = buildPrepared(baseSnapshot);
        const nextSnapshot = applyPreparedOperations(baseSnapshot, selected);
        writeLiveResumeSync(tx, nextSnapshot);
        if (input.afterLiveWriteForTest) {
          const result = input.afterLiveWriteForTest();
          if (result && typeof (result as Promise<void>).then === 'function') {
            throw new Error('SQLite transaction test hook must be synchronous');
          }
        }
        const version = versionValues({
          userId: input.userId,
          resumeId: input.resumeId,
          versionNumber: latest.versionNumber + 1,
          snapshot: nextSnapshot,
          source: 'ai-change-set',
        });
        tx.insert(resumeVersions).values(version).run();
        for (const operation of loaded.operations) {
          const selected = selectedIds.has(operation.operationId);
          tx.update(resumeChangeOperations).set({
            selected,
            result: selected ? 'applied' : 'not_selected',
            errorCode: null,
          }).where(and(
            eq(resumeChangeOperations.changeSetId, input.changeSetId),
            eq(resumeChangeOperations.operationId, operation.operationId),
          )).run();
        }
        const status = selectedIds.size === loaded.operations.length ? 'applied' : 'partially_applied';
        tx.update(resumeChangeSets).set({
          status,
          appliedVersionId: version.id,
          updatedAt: new Date(),
        }).where(eq(resumeChangeSets.id, input.changeSetId)).run();
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(), actorUserId: input.userId, action: 'resume.change_set_applied',
          targetType: 'resume_change_set', targetId: input.changeSetId, outcome: 'success',
          metadata: { resumeId: input.resumeId, versionId: version.id, operationIds: input.operationIds },
        }).run();
        return { versionId: version.id, status };
      });
    }

    return db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.resumeId}))`);
      const changeSets = await tx.select().from(resumeChangeSets).where(and(
        eq(resumeChangeSets.id, input.changeSetId),
        eq(resumeChangeSets.userId, input.userId),
        eq(resumeChangeSets.resumeId, input.resumeId),
      )).limit(1);
      const changeSet = changeSets[0];
      if (!changeSet) throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_FOUND');
      if (changeSet.status !== 'validated' && changeSet.status !== 'proposed') {
        throw new ResumeChangeRepositoryError('CHANGE_SET_NOT_APPLICABLE');
      }
      const latestRows = await tx.select().from(resumeVersions).where(and(
        eq(resumeVersions.userId, input.userId), eq(resumeVersions.resumeId, input.resumeId),
      )).orderBy(desc(resumeVersions.versionNumber)).limit(1);
      const latest = latestRows[0];
      if (!latest || latest.id !== changeSet.baseVersionId) {
        throw new ResumeChangeRepositoryError('STALE_BASE_VERSION');
      }
      const rows = await tx.select().from(resumes).where(and(
        eq(resumes.id, input.resumeId), eq(resumes.userId, input.userId),
      )).limit(1);
      if (!rows[0]) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
      const sections = await tx.select().from(resumeSections).where(eq(resumeSections.resumeId, input.resumeId))
        .orderBy(resumeSections.sortOrder);
      const baseSnapshot = parseResumeSnapshot(latest.snapshot);
      if (contentHash(createResumeSnapshot(buildResume(rows[0], sections))) !== contentHash(baseSnapshot)) {
        throw new ResumeChangeRepositoryError('STALE_BASE_VERSION');
      }
      const selected = buildPrepared(baseSnapshot);
      const nextSnapshot = applyPreparedOperations(baseSnapshot, selected);
      await writeLiveResumeAsync(tx, nextSnapshot);
      await input.afterLiveWriteForTest?.();
      const version = versionValues({
        userId: input.userId,
        resumeId: input.resumeId,
        versionNumber: latest.versionNumber + 1,
        snapshot: nextSnapshot,
        source: 'ai-change-set',
      });
      await tx.insert(resumeVersions).values(version);
      for (const operation of loaded.operations) {
        const selected = selectedIds.has(operation.operationId);
        await tx.update(resumeChangeOperations).set({
          selected,
          result: selected ? 'applied' : 'not_selected',
          errorCode: null,
        }).where(and(
          eq(resumeChangeOperations.changeSetId, input.changeSetId),
          eq(resumeChangeOperations.operationId, operation.operationId),
        ));
      }
      const status = selectedIds.size === loaded.operations.length ? 'applied' : 'partially_applied';
      await tx.update(resumeChangeSets).set({
        status,
        appliedVersionId: version.id,
        updatedAt: new Date(),
      }).where(eq(resumeChangeSets.id, input.changeSetId));
      await tx.insert(auditEvents).values({
        id: crypto.randomUUID(), actorUserId: input.userId, action: 'resume.change_set_applied',
        targetType: 'resume_change_set', targetId: input.changeSetId, outcome: 'success',
        metadata: { resumeId: input.resumeId, versionId: version.id, operationIds: input.operationIds },
      });
      return { versionId: version.id, status };
    });
  },

  async restoreVersionOwned(userId: string, resumeId: string, versionId: string) {
    if (config.db.type === 'sqlite') {
      return db.transaction((tx: typeof db) => {
        const row = tx.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1).get();
        if (!row) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
        const target = tx.select().from(resumeVersions).where(and(
          eq(resumeVersions.id, versionId), eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId),
        )).limit(1).get();
        if (!target) throw new ResumeChangeRepositoryError('VERSION_NOT_FOUND');
        const latest = tx.select().from(resumeVersions).where(and(
          eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId),
        )).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
        if (!latest) throw new ResumeChangeRepositoryError('VERSION_NOT_FOUND');
        const snapshot = parseResumeSnapshot(target.snapshot);
        writeLiveResumeSync(tx, snapshot);
        const restored = versionValues({
          userId, resumeId, versionNumber: latest.versionNumber + 1, snapshot, source: 'restore',
        });
        tx.insert(resumeVersions).values(restored).run();
        tx.insert(auditEvents).values({
          id: crypto.randomUUID(), actorUserId: userId, action: 'resume.version_restored',
          targetType: 'resume', targetId: resumeId, outcome: 'success',
          metadata: { restoredFromVersionId: versionId, versionId: restored.id },
        }).run();
        return restored.id;
      });
    }

    return db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${resumeId}))`);
      const rows = await tx.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).limit(1);
      if (!rows[0]) throw new ResumeChangeRepositoryError('RESUME_NOT_FOUND');
      const targets = await tx.select().from(resumeVersions).where(and(
        eq(resumeVersions.id, versionId), eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId),
      )).limit(1);
      if (!targets[0]) throw new ResumeChangeRepositoryError('VERSION_NOT_FOUND');
      const latestRows = await tx.select().from(resumeVersions).where(and(
        eq(resumeVersions.userId, userId), eq(resumeVersions.resumeId, resumeId),
      )).orderBy(desc(resumeVersions.versionNumber)).limit(1);
      if (!latestRows[0]) throw new ResumeChangeRepositoryError('VERSION_NOT_FOUND');
      const snapshot = parseResumeSnapshot(targets[0].snapshot);
      await writeLiveResumeAsync(tx, snapshot);
      const restored = versionValues({
        userId, resumeId, versionNumber: latestRows[0].versionNumber + 1, snapshot, source: 'restore',
      });
      await tx.insert(resumeVersions).values(restored);
      await tx.insert(auditEvents).values({
        id: crypto.randomUUID(), actorUserId: userId, action: 'resume.version_restored',
        targetType: 'resume', targetId: resumeId, outcome: 'success',
        metadata: { restoredFromVersionId: versionId, versionId: restored.id },
      });
      return restored.id;
    });
  },
};
