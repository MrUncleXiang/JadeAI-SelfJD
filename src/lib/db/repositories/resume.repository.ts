import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../index';
import { resumes, resumeSections } from '../schema';

type CreateSectionData = {
  id?: string;
  resumeId: string;
  type: string;
  title: string;
  sortOrder: number;
  visible?: boolean;
  content?: unknown;
};

type ResumeKind = 'baseline' | 'targeted' | 'general-copy';

type ResumeLineage = {
  kind?: ResumeKind;
  parentResumeId?: string | null;
  targetJdSourceId?: string | null;
};

async function createResumeSection(data: CreateSectionData) {
  const id = data.id || crypto.randomUUID();
  await db.insert(resumeSections).values({
    id,
    resumeId: data.resumeId,
    type: data.type,
    title: data.title,
    sortOrder: data.sortOrder,
    visible: data.visible ?? true,
    content: data.content || {},
  });
  const rows = await db.select().from(resumeSections).where(eq(resumeSections.id, id)).limit(1);
  return rows[0];
}

export const resumeRepository = {
  async findAllByUserId(userId: string) {
    return db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));
  },

  async findOwnedById(userId: string, id: string) {
    const resume = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .limit(1);
    if (!resume[0]) return null;
    const sections = await db
      .select()
      .from(resumeSections)
      .where(eq(resumeSections.resumeId, id))
      .orderBy(resumeSections.sortOrder);
    return { ...resume[0], sections };
  },

  async createOwned(userId: string, data: {
    title?: string;
    template?: string;
    themeConfig?: unknown;
    language?: string;
    kind?: ResumeKind;
    parentResumeId?: string | null;
    targetJdSourceId?: string | null;
  }) {
    const id = crypto.randomUUID();
    await db.insert(resumes).values({
      id,
      userId,
      kind: data.kind || 'baseline',
      parentResumeId: data.parentResumeId || null,
      targetJdSourceId: data.targetJdSourceId || null,
      title: data.title || '未命名简历',
      template: data.template || 'classic',
      ...(data.themeConfig !== undefined ? { themeConfig: data.themeConfig } : {}),
      language: data.language || 'zh',
    });
    return this.findOwnedById(userId, id);
  },

  async updateOwned(
    userId: string,
    id: string,
    data: Partial<{ title: string; template: string; themeConfig: unknown; language: string }>,
  ) {
    await db
      .update(resumes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    return this.findOwnedById(userId, id);
  },

  async deleteOwned(userId: string, id: string) {
    const existing = await this.findOwnedById(userId, id);
    if (!existing) return false;
    await db
      .update(resumes)
      .set({ parentResumeId: null, updatedAt: new Date() })
      .where(and(eq(resumes.userId, userId), eq(resumes.parentResumeId, id)));
    await db
      .delete(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    return true;
  },

  async duplicateOwned(
    userId: string,
    id: string,
    titleOverride?: string,
    lineage: ResumeLineage = {},
  ) {
    const original = await this.findOwnedById(userId, id);
    if (!original) return null;

    const newId = crypto.randomUUID();
    await db.insert(resumes).values({
      id: newId,
      userId,
      kind: lineage.kind || 'general-copy',
      parentResumeId: lineage.parentResumeId === undefined ? original.id : lineage.parentResumeId,
      targetJdSourceId: lineage.targetJdSourceId || null,
      title: titleOverride ?? `${original.title} (副本)`,
      template: original.template,
      themeConfig: original.themeConfig,
      language: original.language,
    });

    for (const section of original.sections) {
      await db.insert(resumeSections).values({
        id: crypto.randomUUID(),
        resumeId: newId,
        type: section.type,
        title: section.title,
        sortOrder: section.sortOrder,
        visible: section.visible,
        content: section.content,
      });
    }

    return this.findOwnedById(userId, newId);
  },

  async cloneSystemOwnedResume(
    sourceUserId: string,
    id: string,
    targetUserId: string,
    titleOverride?: string,
  ) {
    const original = await this.findOwnedById(sourceUserId, id);
    if (!original) return null;

    const newId = crypto.randomUUID();
    await db.insert(resumes).values({
      id: newId,
      userId: targetUserId,
      title: titleOverride ?? original.title,
      template: original.template,
      themeConfig: original.themeConfig,
      language: original.language,
    });

    for (const section of original.sections) {
      await createResumeSection({
        resumeId: newId,
        type: section.type,
        title: section.title,
        sortOrder: section.sortOrder,
        visible: section.visible,
        content: section.content,
      });
    }

    return this.findOwnedById(targetUserId, newId);
  },

  // Share operations
  async findPublicByLegacyShareToken(token: string) {
    const resume = await db.select().from(resumes).where(eq(resumes.shareToken, token)).limit(1);
    if (!resume[0]) return null;
    const sections = await db.select().from(resumeSections).where(eq(resumeSections.resumeId, resume[0].id)).orderBy(resumeSections.sortOrder);
    return { ...resume[0], sections };
  },

  async incrementPublicViewCount(id: string) {
    await db.update(resumes).set({ viewCount: sql`${resumes.viewCount} + 1` }).where(eq(resumes.id, id));
  },

  async updateOwnedShareSettings(
    userId: string,
    id: string,
    settings: { isPublic?: boolean; shareToken?: string | null; sharePassword?: string | null },
  ) {
    const resume = await this.findOwnedById(userId, id);
    if (!resume) return false;
    await db
      .update(resumes)
      .set({ ...settings, updatedAt: new Date() })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    return true;
  },

  // Section operations
  async createSectionOwned(
    userId: string,
    data: CreateSectionData,
  ) {
    const resume = await this.findOwnedById(userId, data.resumeId);
    if (!resume) return null;
    return createResumeSection(data);
  },

  async updateSectionOwned(
    userId: string,
    resumeId: string,
    id: string,
    data: Partial<{ title: string; sortOrder: number; visible: boolean; content: unknown }>,
  ) {
    const resume = await this.findOwnedById(userId, resumeId);
    if (!resume || !resume.sections.some((section: { id: string }) => section.id === id)) return false;
    await db
      .update(resumeSections)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(resumeSections.id, id), eq(resumeSections.resumeId, resumeId)));
    return true;
  },

  async deleteSectionOwned(userId: string, resumeId: string, id: string) {
    const resume = await this.findOwnedById(userId, resumeId);
    if (!resume || !resume.sections.some((section: { id: string }) => section.id === id)) return false;
    await db
      .delete(resumeSections)
      .where(and(eq(resumeSections.id, id), eq(resumeSections.resumeId, resumeId)));
    return true;
  },

  async updateSectionOrderOwned(
    userId: string,
    resumeId: string,
    sections: { id: string; sortOrder: number }[],
  ) {
    const resume = await this.findOwnedById(userId, resumeId);
    if (!resume) return false;
    const ownedIds = new Set(resume.sections.map((section: { id: string }) => section.id));
    if (sections.some((section) => !ownedIds.has(section.id))) return false;
    for (const section of sections) {
      await db
        .update(resumeSections)
        .set({ sortOrder: section.sortOrder, updatedAt: new Date() })
        .where(and(eq(resumeSections.id, section.id), eq(resumeSections.resumeId, resumeId)));
    }
    return true;
  },
};
