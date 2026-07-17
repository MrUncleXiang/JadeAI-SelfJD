import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_TYPE = 'sqlite';
  process.env.SQLITE_PATH = ':memory:';
});

import type { ActorContext } from '@/lib/auth/service';
import { jdService } from '@/lib/jd/service';

import { db, dbReady } from '../index';
import { jdRequirements, jdSources, users } from '../schema';
import { jdRepository } from './jd.repository';

const suffix = crypto.randomUUID();
const userId = `jd-user-${suffix}`;
const otherUserId = `jd-other-${suffix}`;

function actor(id: string): ActorContext {
  return {
    userId: id,
    role: 'user',
    sessionId: `session-${id}`,
    requestId: `request-${id}`,
    user: {
      id,
      username: id,
      email: null,
      name: id,
      avatarUrl: null,
      role: 'user',
      status: 'active',
      authType: 'password',
    },
  };
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: userId, username: userId, authType: 'password' },
    { id: otherUserId, username: otherUserId, authType: 'password' },
  ]);
});

describe('JD source repository and service', () => {
  it('deduplicates normalized text per tenant while keeping tenant boundaries', async () => {
    const first = await jdService.createTextSource(actor(userId), {
      title: 'Unity role',
      text: 'Senior Unity Engineer\r\n\r\nRequired: C#',
    });
    const duplicate = await jdService.createTextSource(actor(userId), {
      title: 'Ignored duplicate title',
      text: 'Senior Unity Engineer\n\nRequired: C#\n',
    });
    const otherTenant = await jdService.createTextSource(actor(otherUserId), {
      text: 'Senior Unity Engineer\n\nRequired: C#',
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.source.id).toBe(first.source.id);
    expect(otherTenant.created).toBe(true);
    expect(otherTenant.source.id).not.toBe(first.source.id);
    await expect(jdRepository.listSourcesOwned(userId)).resolves.toHaveLength(1);
    await expect(jdRepository.findSourceOwned(otherUserId, first.source.id)).resolves.toBeNull();
  });

  it('stores reviewable requirements, allows corrections, and confirms only reviewed data', async () => {
    const created = await jdService.createTextSource(actor(userId), {
      text: 'Senior Unity Engineer\nResponsibilities\nBuild editor tools\nRequirements\nC# and Unity\n3+ years experience',
    });
    const extracted = await jdService.applyCandidateForAcceptance(actor(userId), created.source.id, {
      title: 'Senior Unity Engineer',
      company: 'Example Studio',
      jobTitle: 'Senior Unity Engineer',
      location: 'Remote',
      requirements: [
        {
          requirementType: 'responsibility',
          text: 'Build editor tools',
          normalizedTerm: 'unity editor tooling',
          priority: 'required',
          importance: 0.9,
          sourceText: 'Build editor tools',
        },
        {
          requirementType: 'hard_skill',
          text: 'C# and Unity',
          normalizedTerm: 'unity c#',
          aliases: ['C Sharp'],
          priority: 'required',
          importance: 1,
          sourceText: 'C# and Unity',
        },
      ],
    });
    expect(extracted).toMatchObject({ status: 'needs_review', company: 'Example Studio' });
    expect(extracted.requirements).toHaveLength(2);
    expect(extracted.requirements[0].sourceLocator).toMatchObject({ line: 3 });

    const reviewed = await jdService.updateReview(actor(userId), created.source.id, {
      location: 'Hybrid',
      requirements: extracted.requirements.map((requirement) => ({
        requirementType: requirement.requirementType,
        text: requirement.text,
        normalizedTerm: requirement.normalizedTerm,
        aliases: requirement.aliases,
        priority: requirement.priority,
        importance: requirement.importance,
        sourceLocator: requirement.sourceLocator,
      })),
    });
    expect(reviewed.location).toBe('Hybrid');
    expect(reviewed.parserId).toBe('user-reviewed');

    const confirmed = await jdService.confirmSource(actor(userId), created.source.id);
    expect(confirmed).toMatchObject({ status: 'confirmed' });
    expect(confirmed.confirmedAt).toBeTruthy();
    await expect(jdService.getSource(actor(otherUserId), created.source.id))
      .rejects.toMatchObject({ code: 'JD_SOURCE_NOT_FOUND', status: 404 });
  });

  it('rejects confirmation before requirements have been reviewed', async () => {
    const created = await jdService.createTextSource(actor(userId), {
      text: `Unreviewed role ${suffix}`,
    });
    await expect(jdService.confirmSource(actor(userId), created.source.id))
      .rejects.toMatchObject({ code: 'JD_SOURCE_STATE_INVALID', status: 409 });
    expect((await db.select().from(jdSources)).length).toBeGreaterThanOrEqual(3);
    expect((await db.select().from(jdRequirements)).length).toBeGreaterThanOrEqual(2);
  });
});
