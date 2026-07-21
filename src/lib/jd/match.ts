/**
 * Deterministic JD requirement ↔ approved career fact matching [JD-003].
 *
 * This layer does not call an LLM. It produces an explicit matrix with
 * strong / partial / gap / conflict levels, supporting fact evidence, and
 * gap/conflict summaries that can feed targeted resume generation.
 */

import type { CareerFactPolicyItem, CareerKnowledgePolicy } from '@/lib/career/types';
import type {
  JdRequirementPriority,
  JdRequirementType,
} from '@/lib/jd/types';

export const JD_MATCH_LEVELS = ['strong', 'partial', 'gap', 'conflict'] as const;
export type JdMatchLevel = typeof JD_MATCH_LEVELS[number];

export interface JdMatchRequirement {
  id: string;
  requirementType: JdRequirementType | string;
  text: string;
  normalizedTerm?: string | null;
  aliases?: string[] | null;
  priority?: JdRequirementPriority | string | null;
  importance?: number | null;
}

export interface JdMatchSupportingFact {
  factId: string;
  title: string;
  factType: string;
  score: number;
  reasons: string[];
}

export interface JdMatchRow {
  requirementId: string;
  requirementType: string;
  priority: string;
  text: string;
  normalizedTerm: string;
  level: JdMatchLevel;
  score: number;
  supportingFacts: JdMatchSupportingFact[];
  conflictClaims: string[];
  rationale: string;
}

export interface JdMatchReport {
  jdSourceId: string;
  generatedAt: string;
  summary: {
    total: number;
    strong: number;
    partial: number;
    gap: number;
    conflict: number;
    requiredGaps: number;
  };
  rows: JdMatchRow[];
  gaps: Array<{
    requirementId: string;
    text: string;
    priority: string;
    requirementType: string;
  }>;
  conflicts: Array<{
    requirementId: string;
    text: string;
    forbiddenClaim: string;
  }>;
  recommendedFactIds: string[];
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'by',
  'is', 'are', 'be', 'as', 'at', 'from', 'that', 'this', 'it', 'you', 'your',
  'we', 'our', 'will', 'can', 'ability', 'experience', 'years', 'year',
  'plus', 'using', 'use', 'used', 'work', 'working', 'job', 'role', 'team',
  'strong', 'good', 'solid', 'preferred', 'required', 'must', 'have', 'has',
  '的', '和', '与', '及', '或', '在', '对', '为', '等', '并', '能', '可', '具备',
  '相关', '经验', '能力', '优先', '要求', '负责', '熟悉', '了解', '以上', '年',
]);

function normalize(value: string | null | undefined): string {
  return (value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function extractMatchTokens(text: string): string[] {
  const normalized = normalize(text);
  if (!normalized) return [];
  const raw = normalized.match(/[\p{L}\p{N}+#.]{2,40}/gu) || [];
  const tokens: string[] = [];
  for (const piece of raw) {
    const token = piece.replace(/^[.+#]+|[.+#]+$/g, '');
    if (!token || STOPWORDS.has(token)) continue;
    tokens.push(token);
    // Expand long CJK runs into overlapping bigrams/trigrams for better recall.
    const cjk = token.match(/[一-鿿]+/g) || [];
    for (const run of cjk) {
      if (run.length < 2) continue;
      if (run.length <= 4) tokens.push(run);
      for (let size = 2; size <= 3; size++) {
        for (let index = 0; index + size <= run.length; index++) {
          tokens.push(run.slice(index, index + size));
        }
      }
    }
  }
  return unique(
    tokens.filter((token) => token.length >= 2 && !STOPWORDS.has(token)),
  );
}

function factHaystack(fact: CareerFactPolicyItem): {
  title: string;
  claims: string[];
  full: string;
  tokens: Set<string>;
} {
  const title = normalize(fact.title);
  const claims = fact.allowedClaims.map((claim) => normalize(claim)).filter(Boolean);
  const structured = normalize(JSON.stringify(fact.structuredData || {}));
  const summary = normalize(fact.summary);
  const full = [title, summary, ...claims, structured].join('\n');
  const tokens = new Set(extractMatchTokens(full));
  return { title, claims, full, tokens };
}

function termHits(term: string, haystack: ReturnType<typeof factHaystack>): string[] {
  const value = normalize(term);
  if (!value || value.length < 2) return [];
  const reasons: string[] = [];
  if (haystack.title === value || haystack.title.includes(value)) {
    reasons.push('title_term');
  }
  if (haystack.claims.some((claim) => claim === value || claim.includes(value))) {
    reasons.push('claim_term');
  }
  if (haystack.full.includes(value)) {
    reasons.push('body_term');
  }
  return reasons;
}

function scoreFactAgainstRequirement(
  requirement: JdMatchRequirement,
  fact: CareerFactPolicyItem,
): { score: number; reasons: string[] } {
  const haystack = factHaystack(fact);
  const reasons: string[] = [];
  let score = 0;

  const normalizedTerm = normalize(requirement.normalizedTerm || '');
  if (normalizedTerm) {
    const hits = termHits(normalizedTerm, haystack);
    if (hits.includes('title_term') || hits.includes('claim_term')) {
      score += 40;
      reasons.push('normalized_term_exact');
    } else if (hits.includes('body_term')) {
      score += 24;
      reasons.push('normalized_term_body');
    }
  }

  for (const alias of requirement.aliases || []) {
    const hits = termHits(alias, haystack);
    if (hits.length > 0) {
      score += hits.includes('title_term') || hits.includes('claim_term') ? 28 : 16;
      reasons.push('alias_hit');
      break;
    }
  }

  const reqTokens = extractMatchTokens([
    requirement.text,
    requirement.normalizedTerm || '',
    ...(requirement.aliases || []),
  ].join(' '));
  const overlapping = reqTokens.filter((token) => haystack.tokens.has(token));
  if (overlapping.length > 0) {
    score += Math.min(36, overlapping.length * 8);
    reasons.push(`token_overlap:${overlapping.slice(0, 6).join('|')}`);
  }

  // Soft type affinity: projects/skills/employment are more useful for hard skills.
  if (requirement.requirementType === 'hard_skill' && (fact.factType === 'skill' || fact.factType === 'project')) {
    score += 4;
  }
  if (requirement.requirementType === 'responsibility' && (fact.factType === 'project' || fact.factType === 'employment')) {
    score += 4;
  }
  if (requirement.requirementType === 'education' && fact.factType === 'education') {
    score += 8;
  }
  if (requirement.requirementType === 'experience' && (fact.factType === 'employment' || fact.factType === 'project')) {
    score += 4;
  }

  return { score, reasons: unique(reasons) };
}

function findForbiddenConflicts(
  requirement: JdMatchRequirement,
  forbiddenClaims: readonly string[],
): string[] {
  const reqTokens = new Set(extractMatchTokens([
    requirement.text,
    requirement.normalizedTerm || '',
    ...(requirement.aliases || []),
  ].join(' ')));
  if (reqTokens.size < 1) return [];

  const distinctive = (token: string) => {
    const cjk = (token.match(/[一-鿿]/g) || []).length;
    if (cjk >= 4) return true;
    if (cjk === 0 && token.length >= 6) return true;
    return false;
  };

  const conflicts: string[] = [];
  for (const claim of forbiddenClaims) {
    const claimNorm = normalize(claim);
    if (!claimNorm) continue;
    const claimTokens = extractMatchTokens(claim);
    const overlap = claimTokens.filter((token) => reqTokens.has(token));
    const strongOverlap = overlap.filter(distinctive);
    // Avoid false positives from generic soft-skill tokens.
    if (strongOverlap.length >= 1 || overlap.filter((token) => token.length >= 4).length >= 2) {
      conflicts.push(claim);
    }
  }
  return unique(conflicts);
}

function classifyLevel(
  score: number,
  conflictClaims: string[],
  supportingFacts: JdMatchSupportingFact[],
): JdMatchLevel {
  if (conflictClaims.length > 0 && supportingFacts.length < 1) return 'conflict';
  if (conflictClaims.length > 0 && score < 24) return 'conflict';
  const hasExact = supportingFacts.some((fact) => (
    fact.reasons.includes('normalized_term_exact')
    || fact.reasons.includes('alias_hit')
  ));
  const hasSolidOverlap = supportingFacts.some((fact) => (
    fact.reasons.some((reason) => reason.startsWith('token_overlap:'))
    && fact.score >= 40
  ));
  // Strong requires either exact terminology/alias support or a high total score.
  if (score >= 40 || (hasExact && score >= 30) || hasSolidOverlap) {
    return 'strong';
  }
  if (score >= 12) return 'partial';
  if (conflictClaims.length > 0) return 'conflict';
  return 'gap';
}

function rationaleFor(
  level: JdMatchLevel,
  supportingFacts: JdMatchSupportingFact[],
  conflictClaims: string[],
): string {
  if (level === 'conflict') {
    return conflictClaims.length > 0
      ? `与禁止声明冲突：${conflictClaims.slice(0, 2).join('；')}`
      : '存在夸大或冲突风险';
  }
  if (level === 'gap') {
    return '已批准事实中未找到充分支持，定向简历应省略或仅作为弱相关背景，不得暗示已满足。';
  }
  if (level === 'strong') {
    const titles = supportingFacts.slice(0, 2).map((fact) => fact.title).join('、');
    return `有充分事实支持（${titles || '已批准事实'}），可在简历中明确呈现。`;
  }
  const titles = supportingFacts.slice(0, 2).map((fact) => fact.title).join('、');
  return `仅有部分事实支持（${titles || '弱相关事实'}），应谨慎表述，避免夸大。`;
}

export function buildJdMatchReport(input: {
  jdSourceId: string;
  requirements: readonly JdMatchRequirement[];
  policy: CareerKnowledgePolicy;
  generatedAt?: string;
}): JdMatchReport {
  const rows: JdMatchRow[] = input.requirements.map((requirement) => {
    const scored = input.policy.facts
      .map((fact) => {
        const { score, reasons } = scoreFactAgainstRequirement(requirement, fact);
        return {
          factId: fact.id,
          title: fact.title,
          factType: fact.factType,
          score,
          reasons,
        } satisfies JdMatchSupportingFact;
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => (
        right.score - left.score
        || left.title.localeCompare(right.title)
        || left.factId.localeCompare(right.factId)
      ));

    const supportingFacts = scored.filter((item) => item.score >= 8).slice(0, 5);
    const bestScore = supportingFacts[0]?.score || 0;
    const conflictClaims = findForbiddenConflicts(requirement, input.policy.forbiddenClaims);
    const level = classifyLevel(bestScore, conflictClaims, supportingFacts);

    return {
      requirementId: requirement.id,
      requirementType: requirement.requirementType,
      priority: requirement.priority || 'normal',
      text: requirement.text,
      normalizedTerm: requirement.normalizedTerm || '',
      level,
      score: bestScore,
      supportingFacts: level === 'gap' ? [] : supportingFacts,
      conflictClaims,
      rationale: rationaleFor(level, supportingFacts, conflictClaims),
    };
  });

  // Stable order: required conflicts/gaps first, then by level severity.
  const levelRank: Record<JdMatchLevel, number> = {
    conflict: 0,
    gap: 1,
    partial: 2,
    strong: 3,
  };
  const priorityRank: Record<string, number> = {
    required: 0,
    preferred: 1,
    normal: 2,
  };
  rows.sort((left, right) => (
    (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9)
    || levelRank[left.level] - levelRank[right.level]
    || right.score - left.score
    || left.text.localeCompare(right.text)
  ));

  const gaps = rows
    .filter((row) => row.level === 'gap')
    .map((row) => ({
      requirementId: row.requirementId,
      text: row.text,
      priority: row.priority,
      requirementType: row.requirementType,
    }));
  const conflicts = rows
    .filter((row) => row.level === 'conflict')
    .flatMap((row) => row.conflictClaims.map((forbiddenClaim) => ({
      requirementId: row.requirementId,
      text: row.text,
      forbiddenClaim,
    })));

  const recommendedFactIds = unique(
    rows
      .filter((row) => row.level === 'strong' || row.level === 'partial')
      .flatMap((row) => row.supportingFacts.map((fact) => fact.factId)),
  );

  const summary = {
    total: rows.length,
    strong: rows.filter((row) => row.level === 'strong').length,
    partial: rows.filter((row) => row.level === 'partial').length,
    gap: rows.filter((row) => row.level === 'gap').length,
    conflict: rows.filter((row) => row.level === 'conflict').length,
    requiredGaps: gaps.filter((gap) => gap.priority === 'required').length,
  };

  return {
    jdSourceId: input.jdSourceId,
    generatedAt: input.generatedAt || new Date().toISOString(),
    summary,
    rows,
    gaps,
    conflicts,
    recommendedFactIds,
  };
}

/** Prefer matched facts when selecting a compact policy for targeted drafts. */
export function selectFactsUsingMatchReport(
  policy: CareerKnowledgePolicy,
  report: JdMatchReport,
  maxFacts = 20,
): CareerKnowledgePolicy {
  if (policy.facts.length <= maxFacts) return policy;
  const rank = new Map(report.recommendedFactIds.map((id, index) => [id, index]));
  const ranked = [...policy.facts].sort((left, right) => {
    const leftRank = rank.has(left.id) ? rank.get(left.id)! : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(right.id) ? rank.get(right.id)! : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
  const selected = ranked.slice(0, maxFacts);
  return {
    facts: selected,
    approvedEvidenceIds: new Set(selected.flatMap((fact) => fact.evidence.map((item) => item.id))),
    forbiddenClaims: policy.forbiddenClaims,
  };
}

export function formatMatchReportForPrompt(report: JdMatchReport, language: 'zh' | 'en' = 'zh'): string {
  const lines: string[] = [];
  if (language === 'en') {
    lines.push(
      `JD match matrix: strong=${report.summary.strong}, partial=${report.summary.partial}, gap=${report.summary.gap}, conflict=${report.summary.conflict}, requiredGaps=${report.summary.requiredGaps}.`,
      'Use strong/partial rows only for positive claims. Never claim gap/conflict requirements are met.',
    );
  } else {
    lines.push(
      `JD 匹配矩阵：强匹配=${report.summary.strong}，部分匹配=${report.summary.partial}，缺口=${report.summary.gap}，冲突=${report.summary.conflict}，必须缺口=${report.summary.requiredGaps}。`,
      '只能把 strong/partial 要求写成已满足；gap/conflict 要求不得写成用户已具备，只能省略或写为可学习方向且不暗示已完成。',
    );
  }

  for (const row of report.rows.slice(0, 40)) {
    const supports = row.supportingFacts
      .slice(0, 3)
      .map((fact) => fact.factId)
      .join(',');
    lines.push(
      `- [${row.level}] (${row.priority}) ${row.text}`
      + (supports ? ` <- facts:${supports}` : '')
      + (row.conflictClaims.length ? ` !!forbidden:${row.conflictClaims[0]}` : ''),
    );
  }
  return lines.join('\n');
}
