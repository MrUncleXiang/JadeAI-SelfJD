import { describe, expect, it } from 'vitest';

import { extractResumePatch } from './extract';
import {
  applyPreparedOperations,
  expectedHashForOperation,
  prepareResumePatch,
  ResumePatchValidationError,
} from './operations';
import { resumePatchSchema, type ResumePatchOperation } from './schema';
import { buildResumePatchPrompt } from './service';
import { canonicalJson, contentHash, type ResumeSnapshot } from './snapshot';

function snapshot(): ResumeSnapshot {
  return {
    schemaVersion: 1,
    resume: {
      id: 'resume-1',
      title: 'Baseline',
      template: 'classic',
      themeConfig: {},
      language: 'zh',
    },
    sections: [
      {
        id: 'personal',
        type: 'personal_info',
        title: '个人信息',
        sortOrder: 0,
        visible: true,
        content: { fullName: 'Jade', jobTitle: 'Unity Developer', email: '', phone: '', location: '' },
      },
      {
        id: 'projects',
        type: 'projects',
        title: '项目',
        sortOrder: 1,
        visible: true,
        content: {
          items: [{ id: 'project-1', name: 'Game', description: 'Built a client', technologies: ['Unity'], highlights: [] }],
        },
      },
      {
        id: 'github',
        type: 'github',
        title: 'GitHub',
        sortOrder: 2,
        visible: true,
        content: {
          items: [{ id: 'repo-1', repoUrl: 'https://github.com/example/repo', name: 'repo', stars: 1, language: 'C#', description: 'demo' }],
        },
      },
    ],
  };
}

function withHash<T extends ResumePatchOperation>(base: ResumeSnapshot, operation: T): T {
  return { ...operation, expectedHash: expectedHashForOperation(base, operation) };
}

describe('ResumePatch v1', () => {
  it('places only approved career evidence and blocking claims in the model prompt', () => {
    const prompt = buildResumePatchPrompt(snapshot(), 'version-1', 'Tailor the resume', {
      facts: [{
        id: 'fact-approved',
        factType: 'skill',
        title: 'Distributed systems',
        summary: 'Designed idempotent workflows.',
        structuredData: {
          level: 'advanced',
          capabilities: Array.from({ length: 50 }, (_, index) => ({
            detail: `large-nested-detail-${index}`,
          })),
        },
        evidence: [{
          id: 'evidence-approved',
          commitSha: 'a'.repeat(40),
          path: 'capabilities.json',
          locator: '/capabilities/0',
          contentHash: 'sha256:evidence',
          summary: 'Synthetic evidence',
        }],
        allowedClaims: ['Can design idempotent workflows.'],
      }],
      approvedEvidenceIds: new Set(['evidence-approved']),
      forbiddenClaims: ['Created the OpenTelemetry standard.'],
    });

    expect(prompt).toContain('"id":"fact-approved"');
    expect(prompt).toContain('"evidenceIds":["evidence-approved"]');
    expect(prompt).toContain('Can design idempotent workflows.');
    expect(prompt).toContain('Created the OpenTelemetry standard.');
    expect(prompt).toContain('Only facts inside approved_career_facts are reusable.');
    expect(prompt).toContain('"structuredDataSummary":{"level":"advanced","capabilities":{"itemCount":50}}');
    expect(prompt).not.toContain('large-nested-detail-49');
    expect(prompt).not.toContain('a'.repeat(40));
    expect(prompt).not.toContain('sha256:evidence');
    expect(prompt).toContain('<response_contract>');
  });

  it('limits a targeted proposal to one confirmed JD requirement set', () => {
    const prompt = buildResumePatchPrompt(snapshot(), 'version-1', 'Tailor the resume', {
      facts: [],
      approvedEvidenceIds: new Set(),
      forbiddenClaims: [],
      allowedJdRequirementIds: new Set(['jd-requirement-1']),
    }, {
      id: 'jd-source-1',
      title: 'Unity role',
      company: 'Example Studio',
      jobTitle: 'Unity Client Engineer',
      location: 'Shenzhen',
      requirements: [{
        id: 'jd-requirement-1',
        requirementType: 'hard_skill',
        text: 'Unity production experience',
        normalizedTerm: 'Unity',
        aliases: ['Unity3D'],
        priority: 'required',
        importance: 1,
      }],
    });

    expect(prompt).toContain('"id":"jd-source-1"');
    expect(prompt).toContain('"id":"jd-requirement-1"');
    expect(prompt).toContain('<allowed_jd_requirement_ids>\n["jd-requirement-1"]');
    expect(prompt).toContain('A JD requirement is a target, not proof');
  });

  it('uses stable canonical hashes', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash(undefined)).not.toBe(contentHash(null));
  });

  it('repairs fenced and double-encoded JSON output', () => {
    const base = snapshot();
    const operation = withHash(base, {
      operationId: 'op-1',
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: contentHash(null),
      value: { field: 'jobTitle', value: 'Senior Unity Developer' },
      reason: 'Improve title wording',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.8,
    });
    const patch = {
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'Improve title',
      operations: [operation],
      warnings: [],
    };
    const doubleEncoded = JSON.stringify(JSON.stringify(patch));
    expect(extractResumePatch(`\`\`\`json\n${doubleEncoded}\n\`\`\``)).toEqual(patch);
  });

  it('rejects unknown operations and dangerous extra fields', () => {
    const result = resumePatchSchema.safeParse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'malicious',
      operations: [{
        operationId: 'op-1',
        type: 'execute_sql',
        expectedHash: contentHash(null),
        value: 'DROP TABLE resumes',
        reason: 'no',
        evidenceIds: [],
        jdRequirementIds: [],
        confidence: 1,
        sql: 'DROP TABLE resumes',
      }],
      warnings: [],
      script: 'process.exit()',
    });
    expect(result.success).toBe(false);
  });

  it('computes server-side diffs and applies only selected operations', () => {
    const base = snapshot();
    const name = withHash(base, {
      operationId: 'name',
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: contentHash(null),
      value: { field: 'fullName', value: 'Jade Xiang' },
      reason: 'Use full professional name',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.9,
    });
    const title = withHash(base, {
      operationId: 'title',
      type: 'set_field',
      sectionId: 'personal',
      expectedHash: contentHash(null),
      value: { field: 'jobTitle', value: 'Unity Client Developer' },
      reason: 'Clarify specialization',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.9,
    });
    const patch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'Polish header',
      operations: [name, title],
      warnings: [],
    });
    const prepared = prepareResumePatch(base, patch);
    expect(prepared[0].diff).toMatchObject({ before: 'Jade', after: 'Jade Xiang' });
    const applied = applyPreparedOperations(base, [prepared[1]]);
    expect(applied.sections[0].content).toMatchObject({
      fullName: 'Jade',
      jobTitle: 'Unity Client Developer',
    });
  });

  it('rejects stale precondition hashes', () => {
    const base = snapshot();
    const patch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'stale',
      operations: [{
        operationId: 'op-1',
        type: 'set_field',
        sectionId: 'personal',
        expectedHash: contentHash('different'),
        value: { field: 'fullName', value: 'Changed' },
        reason: 'change',
        evidenceIds: [],
        jdRequirementIds: [],
        confidence: 0.5,
      }],
      warnings: [],
    });
    expect(() => prepareResumePatch(base, patch)).toThrowError(
      expect.objectContaining<Partial<ResumePatchValidationError>>({ code: 'EXPECTED_HASH_MISMATCH' }),
    );
  });

  it('rejects operation sequences that cannot be composed', () => {
    const base = snapshot();
    const removeSection = withHash(base, {
      operationId: 'remove-projects',
      type: 'remove_section',
      sectionId: 'projects',
      expectedHash: contentHash(null),
      value: null,
      reason: 'Remove the projects section',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.8,
    });
    const hideSection = withHash(base, {
      operationId: 'hide-projects',
      type: 'set_visibility',
      sectionId: 'projects',
      expectedHash: contentHash(null),
      value: false,
      reason: 'Hide the projects section',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.8,
    });
    const patch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'Conflicting section operations',
      operations: [removeSection, hideSection],
      warnings: [],
    });

    expect(() => prepareResumePatch(base, patch)).toThrowError(
      expect.objectContaining({ code: 'SECTION_NOT_FOUND', operationId: 'hide-projects' }),
    );
  });

  it('enforces evidence ownership, quantitative claims, forbidden claims, and GitHub read-only fields', () => {
    const base = snapshot();
    const quantitative = withHash(base, {
      operationId: 'quant',
      type: 'update_item',
      sectionId: 'projects',
      itemId: 'project-1',
      expectedHash: contentHash(null),
      value: { description: 'Improved frame time by 50%' },
      reason: 'Add impact',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 0.7,
    });
    const quantitativePatch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'impact',
      operations: [quantitative],
      warnings: [],
    });
    expect(() => prepareResumePatch(base, quantitativePatch)).toThrowError(
      expect.objectContaining({ code: 'EVIDENCE_REQUIRED' }),
    );

    const withEvidence = resumePatchSchema.parse({
      ...quantitativePatch,
      operations: [{ ...quantitative, evidenceIds: ['fact-approved'] }],
    });
    expect(() => prepareResumePatch(base, withEvidence, {
      approvedEvidenceIds: new Set(['fact-approved']),
      forbiddenClaims: ['50%'],
    })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN_CLAIM' }));
    expect(() => prepareResumePatch(base, withEvidence, {
      approvedEvidenceIds: new Set(['someone-elses-fact']),
    })).toThrowError(expect.objectContaining({ code: 'EVIDENCE_NOT_APPROVED' }));
    const withForeignJd = resumePatchSchema.parse({
      ...quantitativePatch,
      operations: [{
        ...quantitative,
        evidenceIds: ['fact-approved'],
        jdRequirementIds: ['another-jd-requirement'],
      }],
    });
    expect(() => prepareResumePatch(base, withForeignJd, {
      approvedEvidenceIds: new Set(['fact-approved']),
      allowedJdRequirementIds: new Set(['selected-jd-requirement']),
    })).toThrowError(expect.objectContaining({ code: 'JD_REQUIREMENT_NOT_ALLOWED' }));

    const githubMutation = withHash(base, {
      operationId: 'github-stars',
      type: 'update_item',
      sectionId: 'github',
      itemId: 'repo-1',
      expectedHash: contentHash(null),
      value: { stars: 999 },
      reason: 'inflate stars',
      evidenceIds: [],
      jdRequirementIds: [],
      confidence: 1,
    });
    const githubPatch = resumePatchSchema.parse({
      schemaVersion: 1,
      resumeId: 'resume-1',
      baseVersionId: 'version-1',
      summary: 'bad github change',
      operations: [githubMutation],
      warnings: [],
    });
    expect(() => prepareResumePatch(base, githubPatch)).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY_FIELD' }),
    );
  });
});
