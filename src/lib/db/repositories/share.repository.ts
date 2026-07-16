import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../index';
import { resumeSections, resumeShares, resumes } from '../schema';

type CreateShareData = {
  resumeId: string;
  token: string;
  label?: string;
  password?: string | null;
};

async function ownsResume(userId: string, resumeId: string) {
  const rows = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function findSharesByResumeId(resumeId: string) {
  return db
    .select()
    .from(resumeShares)
    .where(eq(resumeShares.resumeId, resumeId))
    .orderBy(desc(resumeShares.createdAt));
}

async function createShare(data: CreateShareData) {
  const id = crypto.randomUUID();
  await db.insert(resumeShares).values({
    id,
    resumeId: data.resumeId,
    token: data.token,
    label: data.label || '',
    password: data.password ?? null,
  });
  const rows = await db.select().from(resumeShares).where(eq(resumeShares.id, id)).limit(1);
  return rows[0];
}

export const shareRepository = {
  async findPublicBundleByToken(token: string) {
    const rows = await db
      .select()
      .from(resumeShares)
      .where(eq(resumeShares.token, token))
      .limit(1);
    const share = rows[0];
    if (!share) return null;

    const resumeRows = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, share.resumeId))
      .limit(1);
    const resume = resumeRows[0];
    if (!resume) return null;

    const sections = await db
      .select()
      .from(resumeSections)
      .where(eq(resumeSections.resumeId, resume.id))
      .orderBy(resumeSections.sortOrder);

    return { share, resume: { ...resume, sections } };
  },

  async findOwnedByResumeId(userId: string, resumeId: string) {
    if (!await ownsResume(userId, resumeId)) return null;
    return findSharesByResumeId(resumeId);
  },

  async findOwnedById(userId: string, resumeId: string, id: string) {
    if (!await ownsResume(userId, resumeId)) return null;
    const rows = await db
      .select()
      .from(resumeShares)
      .where(and(eq(resumeShares.id, id), eq(resumeShares.resumeId, resumeId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async createOwned(userId: string, data: CreateShareData) {
    if (!await ownsResume(userId, data.resumeId)) return null;
    return createShare(data);
  },

  async updateOwned(userId: string, resumeId: string, id: string, data: {
    label?: string;
    password?: string | null;
    isActive?: boolean;
  }) {
    const share = await this.findOwnedById(userId, resumeId, id);
    if (!share) return null;

    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (data.label !== undefined) setClause.label = data.label;
    if (data.password !== undefined) setClause.password = data.password;
    if (data.isActive !== undefined) setClause.isActive = data.isActive;

    await db
      .update(resumeShares)
      .set(setClause)
      .where(and(eq(resumeShares.id, id), eq(resumeShares.resumeId, resumeId)));
    return this.findOwnedById(userId, resumeId, id);
  },

  async deleteOwned(userId: string, resumeId: string, id: string) {
    const share = await this.findOwnedById(userId, resumeId, id);
    if (!share) return false;
    await db
      .delete(resumeShares)
      .where(and(eq(resumeShares.id, id), eq(resumeShares.resumeId, resumeId)));
    return true;
  },

  async incrementPublicViewCount(id: string) {
    await db
      .update(resumeShares)
      .set({ viewCount: sql`${resumeShares.viewCount} + 1` })
      .where(eq(resumeShares.id, id));
  },
};
