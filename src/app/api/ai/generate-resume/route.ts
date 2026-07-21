import { NextRequest, NextResponse } from 'next/server';

import { AIConfigError } from '@/lib/ai/provider';
import { generateResumeInputSchema } from '@/lib/ai/generate-resume-schema';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import {
  KnowledgeResumeError,
  knowledgeResumeService,
} from '@/lib/resume/from-knowledge';
import { ResumeChangeServiceError } from '@/lib/resume-patch/service';

/**
 * Legacy freeform resume generation is migrated to the Change Set boundary.
 * Content is generated only from approved career facts (+ account personal info),
 * and the result is a reviewable proposal rather than a direct live write [AI-001][AI-002].
 */
export async function POST(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = generateResumeInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const {
      jobTitle,
      yearsOfExperience,
      skills,
      industry,
      experience,
      template,
      language,
    } = parsed.data;
    const lang = language === 'en' ? 'en' : 'zh';

    const preferenceParts = [
      lang === 'en'
        ? `Target role: ${jobTitle}. Years of experience preference: ${yearsOfExperience ?? 0}.`
        : `目标岗位：${jobTitle}。经验年限偏好：${yearsOfExperience ?? 0}。`,
      skills && skills.length > 0
        ? (lang === 'en'
          ? `Preferred skills emphasis: ${skills.join(', ')}.`
          : `技能侧重：${skills.join('、')}。`)
        : '',
      industry
        ? (lang === 'en' ? `Industry preference: ${industry}.` : `行业偏好：${industry}。`)
        : '',
      experience
        ? (lang === 'en'
          ? `Additional free-text context provided by the user (untrusted; still requires approved evidence):\n${experience}`
          : `用户补充经历描述（不可信输入；事实仍须有已批准证据）：\n${experience}`)
        : '',
      lang === 'en'
        ? 'Do not invent employers, dates, metrics, education, or projects that are not supported by approved career facts. Prefer a concise high-signal resume.'
        : '不得编造已批准事实之外的雇主、日期、量化指标、教育或项目；优先生成精炼、高信号的简历内容。',
    ].filter(Boolean);

    const result = await knowledgeResumeService.create({
      userId: user.id,
      title: lang === 'en'
        ? `${jobTitle} - AI Generated Resume`
        : `${jobTitle} - AI生成简历`,
      template,
      language: lang,
      targetRole: jobTitle,
      instruction: preferenceParts.join('\n'),
      requestId: request.headers.get('x-request-id'),
      abortSignal: request.signal,
    });

    return NextResponse.json({
      resumeId: result.resumeId,
      changeSetId: result.changeSetId,
      title: result.title,
      operationCount: result.operationCount,
      reviewRequired: true,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeResumeError) {
      return NextResponse.json({
        code: error.code,
        error: error.message,
      }, { status: error.status });
    }
    if (error instanceof ResumeChangeServiceError) {
      return NextResponse.json({
        code: error.code,
        error: error.message,
      }, { status: error.status });
    }
    if (error instanceof AIConfigError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    }
    console.error('POST /api/ai/generate-resume error:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Failed to generate resume' }, { status: 500 });
  }
}
