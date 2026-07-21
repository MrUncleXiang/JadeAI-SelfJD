import { describe, expect, it } from 'vitest';

import type { CareerKnowledgePolicy } from '@/lib/career/types';

import {
  buildJdMatchReport,
  extractMatchTokens,
  formatMatchReportForPrompt,
  selectFactsUsingMatchReport,
} from './match';

const policy: CareerKnowledgePolicy = {
  facts: [
    {
      id: 'fact-unity',
      factType: 'project',
      title: 'Unity 客户端交互系统',
      summary: '负责 Unity 三维交互与功能模块开发',
      structuredData: { stack: ['Unity', 'C#', 'UGUI'] },
      evidence: [{
        id: 'ev-1',
        commitSha: 'a'.repeat(40),
        path: 'projects/unity.md',
        locator: 'L1',
        contentHash: 'sha256:1',
        summary: 'Unity project',
      }],
      allowedClaims: ['Production Unity development', 'UGUI drag interaction'],
    },
    {
      id: 'fact-profile',
      factType: 'profile',
      title: '基础画像',
      summary: '客户端工程师',
      structuredData: {},
      evidence: [{
        id: 'ev-2',
        commitSha: 'b'.repeat(40),
        path: 'profile.md',
        locator: 'L1',
        contentHash: 'sha256:2',
        summary: 'profile',
      }],
      allowedClaims: ['客户端工程师', '跨团队协作'],
    },
  ],
  approvedEvidenceIds: new Set(['ev-1', 'ev-2']),
  forbiddenClaims: ['Created the OpenTelemetry standard', '主导全球 Unity 引擎内核研发'],
};

describe('JD fact matching [JD-003]', () => {
  it('extracts useful tokens and drops stopwords', () => {
    const tokens = extractMatchTokens('具备 3 年以上 Unity 客户端开发经验 and the ability');
    expect(tokens).toEqual(expect.arrayContaining(['unity', '客户端', '开发']));
    expect(tokens).not.toContain('and');
    expect(tokens).not.toContain('the');
    expect(extractMatchTokens('the and of')).toEqual([]);
  });

  it('classifies strong, partial, gap and conflict rows with rationale', () => {
    const report = buildJdMatchReport({
      jdSourceId: 'jd-1',
      generatedAt: '2026-07-21T00:00:00.000Z',
      policy,
      requirements: [
        {
          id: 'req-strong',
          requirementType: 'hard_skill',
          text: 'Production Unity development experience',
          normalizedTerm: 'Unity',
          aliases: ['Unity3D'],
          priority: 'required',
        },
        {
          id: 'req-partial',
          requirementType: 'soft_skill',
          text: '具备良好的跨团队沟通与协作能力，能推动需求落地',
          // Intentionally leave normalizedTerm empty so only soft token overlap remains.
          aliases: ['沟通'],
          priority: 'preferred',
        },
        {
          id: 'req-gap',
          requirementType: 'hard_skill',
          text: 'Kubernetes 集群运维经验',
          normalizedTerm: 'Kubernetes',
          aliases: ['K8s'],
          priority: 'required',
        },
        {
          id: 'req-conflict',
          requirementType: 'hard_skill',
          text: '主导全球 Unity 引擎内核研发',
          normalizedTerm: 'Unity 引擎内核',
          priority: 'required',
        },
      ],
    });

    expect(report.summary.total).toBe(4);
    const byId = Object.fromEntries(report.rows.map((row) => [row.requirementId, row]));

    expect(byId['req-strong'].level).toBe('strong');
    expect(byId['req-strong'].supportingFacts[0]?.factId).toBe('fact-unity');
    expect(byId['req-strong'].rationale).toContain('充分');

    expect(byId['req-partial'].level).toBe('partial');
    expect(byId['req-partial'].supportingFacts.length).toBeGreaterThan(0);

    expect(byId['req-gap'].level).toBe('gap');
    expect(byId['req-gap'].supportingFacts).toEqual([]);
    expect(report.gaps.map((gap) => gap.requirementId)).toContain('req-gap');
    expect(report.summary.requiredGaps).toBeGreaterThanOrEqual(1);

    expect(byId['req-conflict'].level).toBe('conflict');
    expect(byId['req-conflict'].conflictClaims.some((claim) => claim.includes('Unity'))).toBe(true);
    expect(report.conflicts.length).toBeGreaterThan(0);
    expect(report.recommendedFactIds).toContain('fact-unity');

    const prompt = formatMatchReportForPrompt(report, 'zh');
    expect(prompt).toContain('强匹配');
    expect(prompt).toContain('[gap]');
    expect(prompt).toContain('[conflict]');
  });

  it('prefers matched facts when compacting a large policy', () => {
    const large: CareerKnowledgePolicy = {
      ...policy,
      facts: [
        ...policy.facts,
        ...Array.from({ length: 25 }, (_, index) => ({
          id: `extra-${index}`,
          factType: 'skill' as const,
          title: `Extra skill ${index}`,
          summary: 'unrelated',
          structuredData: {},
          evidence: [{
            id: `ev-extra-${index}`,
            commitSha: 'c'.repeat(40),
            path: `skills/${index}.md`,
            locator: 'L1',
            contentHash: `sha256:extra-${index}`,
            summary: 'extra',
          }],
          allowedClaims: [`skill-${index}`],
        })),
      ],
    };
    const report = buildJdMatchReport({
      jdSourceId: 'jd-1',
      policy: large,
      requirements: [{
        id: 'req-1',
        requirementType: 'hard_skill',
        text: 'Unity experience',
        normalizedTerm: 'Unity',
        priority: 'required',
      }],
    });
    const selected = selectFactsUsingMatchReport(large, report, 5);
    expect(selected.facts[0]?.id).toBe('fact-unity');
    expect(selected.facts).toHaveLength(5);
    expect(selected.approvedEvidenceIds.has('ev-1')).toBe(true);
  });
});
