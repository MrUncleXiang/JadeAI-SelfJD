import { describe, expect, it } from 'vitest';

import type { CareerKnowledgePolicy } from '@/lib/career/types';
import {
  applyPreparedOperations,
  expectedHashForOperation,
  prepareResumePatch,
} from '@/lib/resume-patch/operations';
import type { ResumePatchJdContext } from '@/lib/resume-patch/service';
import type { ResumeSnapshot } from '@/lib/resume-patch/snapshot';

import {
  assertTargetedDraftReferences,
  buildTargetedResumeDraftPrompt,
  targetedDraftToResumePatch,
  type TargetedResumeDraft,
} from './targeted-draft';

const evidenceId = 'evidence-approved';
const jdRequirementId = 'jd-requirement-approved';

const policy: CareerKnowledgePolicy = {
  facts: [{
    id: 'fact-unity',
    factType: 'project',
    title: 'Unity Client Project',
    summary: 'Built a Unity client.',
    structuredData: { repository: { commitSha: 'a'.repeat(40) } },
    evidence: [{
      id: evidenceId,
      commitSha: 'b'.repeat(40),
      path: 'resume/project.md',
      locator: 'project-1',
      contentHash: `sha256:${'c'.repeat(64)}`,
      summary: 'Approved Unity project evidence.',
    }],
    allowedClaims: ['Built a Unity client from approved project evidence.'],
  }],
  approvedEvidenceIds: new Set([evidenceId]),
  forbiddenClaims: ['unsupported claim'],
};

const jdContext: ResumePatchJdContext = {
  id: 'jd-source',
  title: 'Unity Client Engineer',
  company: 'Example Studio',
  jobTitle: 'Unity Client Engineer',
  location: 'Shenzhen',
  requirements: [{
    id: jdRequirementId,
    requirementType: 'hard_skill',
    text: 'Production Unity experience',
    normalizedTerm: 'Unity',
    aliases: ['Unity3D'],
    priority: 'required',
    importance: 1,
  }],
};

function snapshot(input: { existing?: boolean } = {}): ResumeSnapshot {
  return {
    schemaVersion: 1,
    resume: {
      id: 'resume-target',
      title: 'Targeted Resume',
      template: 'classic',
      themeConfig: {},
      language: 'en',
    },
    sections: [{
      id: 'summary-section',
      type: 'summary',
      title: 'Summary',
      sortOrder: 0,
      visible: true,
      content: { text: input.existing ? 'Old summary' : '' },
    }, {
      id: 'skills-section',
      type: 'skills',
      title: 'Skills',
      sortOrder: 1,
      visible: true,
      content: {
        categories: input.existing
          ? [{ id: 'existing-skill', name: 'client development', skills: ['C#'] }]
          : [],
      },
    }, {
      id: 'projects-section',
      type: 'projects',
      title: 'Projects',
      sortOrder: 2,
      visible: true,
      content: {
        items: input.existing
          ? [{
              id: 'existing-project',
              name: 'UNITY CLIENT PROJECT',
              url: 'https://example.test/project',
              startDate: '2024-01',
              endDate: '2024-12',
              description: 'Old description',
              technologies: ['C#'],
              highlights: [],
            }]
          : [],
      },
    }],
  };
}

function draft(): TargetedResumeDraft {
  return {
    summary: {
      text: 'Evidence-backed Unity client engineer.',
      evidenceIds: [evidenceId],
      jdRequirementIds: [jdRequirementId],
    },
    skillCategories: [{
      name: 'Client Development',
      skills: ['Unity', 'C#'],
      evidenceIds: [evidenceId],
      jdRequirementIds: [jdRequirementId],
    }],
    projects: [{
      name: 'Unity Client Project',
      description: 'Built a Unity client from approved project evidence.',
      technologies: ['Unity', 'C#'],
      highlights: ['Implemented evidence-backed client functionality.'],
      evidenceIds: [evidenceId],
      jdRequirementIds: [jdRequirementId],
    }],
    warnings: ['Unsupported JD requirements were omitted.'],
  };
}

describe('targeted resume draft', () => {
  it('converts a compact draft into a validated patch with server-generated hashes and IDs', () => {
    const base = snapshot();
    let id = 0;
    const patch = targetedDraftToResumePatch({
      draft: draft(),
      snapshot: base,
      baseVersionId: 'version-1',
      idFactory: () => `server-id-${++id}`,
    });

    expect(patch.operations.map((operation) => operation.type))
      .toEqual(['set_field', 'add_item', 'add_item']);
    expect(patch.operations[1]).toMatchObject({
      value: { id: 'server-id-3', name: 'Client Development' },
    });
    for (const operation of patch.operations) {
      expect(operation.expectedHash).toBe(expectedHashForOperation(base, operation));
      expect(operation.expectedHash).not.toBe(`sha256:${'0'.repeat(64)}`);
    }

    const prepared = prepareResumePatch(base, patch, {
      approvedEvidenceIds: new Set([evidenceId]),
      allowedJdRequirementIds: new Set([jdRequirementId]),
      forbiddenClaims: policy.forbiddenClaims,
    });
    const applied = applyPreparedOperations(base, prepared);
    expect(applied.sections[0].content).toEqual({ text: draft().summary.text });
    expect(applied.sections[1].content).toMatchObject({
      categories: [expect.objectContaining({ name: 'Client Development', skills: ['Unity', 'C#'] })],
    });
    expect(applied.sections[2].content).toMatchObject({
      items: [expect.objectContaining({ name: 'Unity Client Project' })],
    });
  });

  it('updates matching base items without dropping base-only dates and URLs', () => {
    const base = snapshot({ existing: true });
    let id = 0;
    const patch = targetedDraftToResumePatch({
      draft: draft(),
      snapshot: base,
      baseVersionId: 'version-2',
      idFactory: () => `operation-${++id}`,
    });
    expect(patch.operations.map((operation) => operation.type))
      .toEqual(['set_field', 'update_item', 'update_item']);

    const applied = applyPreparedOperations(base, prepareResumePatch(base, patch, {
      approvedEvidenceIds: new Set([evidenceId]),
      allowedJdRequirementIds: new Set([jdRequirementId]),
    }));
    expect(applied.sections[2].content).toMatchObject({
      items: [expect.objectContaining({
        id: 'existing-project',
        url: 'https://example.test/project',
        startDate: '2024-01',
        endDate: '2024-12',
        description: draft().projects[0].description,
      })],
    });
  });

  it('rejects references that were not supplied to the model', () => {
    const invalid = draft();
    invalid.projects[0].evidenceIds = ['foreign-evidence'];
    expect(() => assertTargetedDraftReferences(
      invalid,
      policy,
      new Set([jdRequirementId]),
    )).toThrow(expect.objectContaining({ code: 'INVALID_MODEL_OUTPUT' }));

    invalid.projects[0].evidenceIds = [evidenceId];
    invalid.projects[0].jdRequirementIds = ['foreign-requirement'];
    expect(() => assertTargetedDraftReferences(
      invalid,
      policy,
      new Set([jdRequirementId]),
    )).toThrow(expect.objectContaining({ code: 'INVALID_MODEL_OUTPUT' }));
  });

  it('builds a compact prompt without repository commit or content hashes', () => {
    const prompt = buildTargetedResumeDraftPrompt({
      language: 'zh',
      instruction: '更突出客户端性能优化。',
      policy,
      jdContext,
      snapshot: snapshot(),
    });
    expect(prompt).toContain('更突出客户端性能优化。');
    expect(prompt).toContain(evidenceId);
    expect(prompt).toContain(jdRequirementId);
    expect(prompt).toContain('Built a Unity client from approved project evidence.');
    expect(prompt).not.toContain('commitSha');
    expect(prompt).not.toContain('contentHash');
    expect(prompt.length).toBeLessThan(10_000);
  });
});
