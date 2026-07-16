import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../index';
import { resumes, resumeSections } from '../schema';

export const resumeRepository = {
  async findAllByUserId(userId: string) {
    return db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));
  },

  async findById(id: string) {
    const resume = await db.select().from(resumes).where(eq(resumes.id, id)).limit(1);
    if (!resume[0]) return null;
    const sections = await db.select().from(resumeSections).where(eq(resumeSections.resumeId, id)).orderBy(resumeSections.sortOrder);
    return { ...resume[0], sections };
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

  async create(data: { userId: string; title?: string; template?: string; language?: string }) {
    const id = crypto.randomUUID();
    await db.insert(resumes).values({
      id,
      userId: data.userId,
      title: data.title || '未命名简历',
      template: data.template || 'classic',
      language: data.language || 'zh',
    });
    return this.findById(id);
  },

  async update(id: string, data: Partial<{ title: string; template: string; themeConfig: unknown; language: string }>) {
    await db.update(resumes).set({ ...data, updatedAt: new Date() }).where(eq(resumes.id, id));
    return this.findById(id);
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

  async delete(id: string) {
    await db.delete(resumes).where(eq(resumes.id, id));
  },

  async deleteOwned(userId: string, id: string) {
    const existing = await this.findOwnedById(userId, id);
    if (!existing) return false;
    await db
      .delete(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
    return true;
  },

  async duplicate(id: string, userId: string, titleOverride?: string) {
    const original = await this.findById(id);
    if (!original) return null;

    const newId = crypto.randomUUID();
    await db.insert(resumes).values({
      id: newId,
      userId,
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

    return this.findById(newId);
  },

  async duplicateOwned(id: string, userId: string, titleOverride?: string) {
    const original = await this.findOwnedById(userId, id);
    if (!original) return null;

    const newId = crypto.randomUUID();
    await db.insert(resumes).values({
      id: newId,
      userId,
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

  // Share operations
  async findByShareToken(token: string) {
    const resume = await db.select().from(resumes).where(eq(resumes.shareToken, token)).limit(1);
    if (!resume[0]) return null;
    const sections = await db.select().from(resumeSections).where(eq(resumeSections.resumeId, resume[0].id)).orderBy(resumeSections.sortOrder);
    return { ...resume[0], sections };
  },

  async incrementViewCount(id: string) {
    await db.update(resumes).set({ viewCount: sql`${resumes.viewCount} + 1` }).where(eq(resumes.id, id));
  },

  async updateShareSettings(id: string, settings: { isPublic?: boolean; shareToken?: string | null; sharePassword?: string | null }) {
    await db.update(resumes).set({ ...settings, updatedAt: new Date() }).where(eq(resumes.id, id));
  },

  // Section operations
  async createSection(data: { id?: string; resumeId: string; type: string; title: string; sortOrder: number; visible?: boolean; content?: unknown }) {
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
  },

  async createSectionOwned(
    userId: string,
    data: { id?: string; resumeId: string; type: string; title: string; sortOrder: number; visible?: boolean; content?: unknown },
  ) {
    const resume = await this.findOwnedById(userId, data.resumeId);
    if (!resume) return null;
    return this.createSection(data);
  },

  async updateSection(id: string, data: Partial<{ title: string; sortOrder: number; visible: boolean; content: unknown }>) {
    await db.update(resumeSections).set({ ...data, updatedAt: new Date() }).where(eq(resumeSections.id, id));
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

  async deleteSection(id: string) {
    await db.delete(resumeSections).where(eq(resumeSections.id, id));
  },

  async deleteSectionOwned(userId: string, resumeId: string, id: string) {
    const resume = await this.findOwnedById(userId, resumeId);
    if (!resume || !resume.sections.some((section: { id: string }) => section.id === id)) return false;
    await db
      .delete(resumeSections)
      .where(and(eq(resumeSections.id, id), eq(resumeSections.resumeId, resumeId)));
    return true;
  },

  async updateSectionOrder(sections: { id: string; sortOrder: number }[]) {
    for (const s of sections) {
      await db.update(resumeSections).set({ sortOrder: s.sortOrder, updatedAt: new Date() }).where(eq(resumeSections.id, s.id));
    }
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
