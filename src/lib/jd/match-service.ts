import { careerService } from '@/lib/career/service';
import { dbReady } from '@/lib/db';
import { jdRepository } from '@/lib/db/repositories/jd.repository';

import {
  buildJdMatchReport,
  type JdMatchReport,
} from './match';

export class JdMatchError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'JdMatchError';
  }
}

export const jdMatchService = {
  async analyzeOwned(userId: string, jdSourceId: string): Promise<JdMatchReport> {
    await dbReady;
    const source = await jdRepository.findSourceOwned(userId, jdSourceId);
    if (!source) {
      throw new JdMatchError('JD_SOURCE_NOT_FOUND', 404, 'Job description source not found.');
    }
    if (source.status !== 'confirmed' || source.requirements.length < 1) {
      throw new JdMatchError(
        'JD_SOURCE_NOT_CONFIRMED',
        409,
        'Confirm the reviewed job description before running fact matching.',
      );
    }

    const policy = await careerService.loadResumePolicy(userId);
    if (policy.facts.length < 1) {
      throw new JdMatchError(
        'NO_APPROVED_FACTS',
        409,
        'Approve at least one career fact before running fact matching.',
      );
    }

    return buildJdMatchReport({
      jdSourceId: source.id,
      requirements: source.requirements.map((requirement) => ({
        id: requirement.id,
        requirementType: requirement.requirementType,
        text: requirement.text,
        normalizedTerm: requirement.normalizedTerm,
        aliases: requirement.aliases,
        priority: requirement.priority,
        importance: requirement.importance,
      })),
      policy,
    });
  },
};
