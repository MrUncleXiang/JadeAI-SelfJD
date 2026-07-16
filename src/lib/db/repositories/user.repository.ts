import { eq } from 'drizzle-orm';
import { db } from '../index';
import { users, resumes } from '../schema';
import { resumeRepository } from './resume.repository';
import { createSampleResume } from '../sample-resume';
import { normalizeEmail } from '@/lib/auth/identifiers';

export const userRepository = {
  async findById(id: string) {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] || null;
  },

  async findByEmail(email: string) {
    const normalized = normalizeEmail(email)?.normalized;
    const result = await db
      .select()
      .from(users)
      .where(normalized ? eq(users.emailNormalized, normalized) : eq(users.email, email))
      .limit(1);
    return result[0] || null;
  },

  async findByFingerprint(fingerprint: string) {
    const result = await db.select().from(users).where(eq(users.fingerprint, fingerprint)).limit(1);
    return result[0] || null;
  },

  async upsertByFingerprint(fingerprint: string) {
    const existing = await this.findByFingerprint(fingerprint);
    if (existing) return existing;

    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      fingerprint,
      authType: 'fingerprint',
      name: 'Anonymous User',
    });

    // Clone demo user's resumes, or create a sample if seed hasn't run
    const demoUser = await this.findByFingerprint('demo-fingerprint');
    if (demoUser) {
      const demoResumes = await db.select().from(resumes).where(eq(resumes.userId, demoUser.id));
      for (const r of demoResumes) {
        await resumeRepository.duplicate(r.id, id, r.title);
      }
    } else {
      await createSampleResume(id);
    }

    return this.findById(id);
  },

  async create(data: { id?: string; email?: string; name?: string; avatarUrl?: string; authType: 'oauth' | 'fingerprint'; fingerprint?: string }) {
    const id = data.id || crypto.randomUUID();
    const normalizedEmail = data.email ? normalizeEmail(data.email) : null;
    await db.insert(users).values({
      ...data,
      id,
      ...(normalizedEmail
        ? { email: normalizedEmail.value, emailNormalized: normalizedEmail.normalized }
        : {}),
    });
    return this.findById(id);
  },

  async update(id: string, data: Partial<{ name: string; avatarUrl: string }>) {
    await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
    return this.findById(id);
  },

  async getSettings(id: string) {
    const result = await db.select({ settings: users.settings }).from(users).where(eq(users.id, id)).limit(1);
    return (result[0]?.settings || {}) as Record<string, unknown>;
  },

  async updateSettings(id: string, settings: Record<string, unknown>) {
    const current = await this.getSettings(id);
    const merged = { ...current, ...settings };
    await db.update(users).set({ settings: merged, updatedAt: new Date() }).where(eq(users.id, id));
    return merged;
  },
};
