import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { analysisRepository } from '@/lib/db/repositories/analysis.repository';
import { jdAnalyses } from '@/lib/db/schema';

type JdAnalysisRow = typeof jdAnalyses.$inferSelect;

export async function GET(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resumeId = request.nextUrl.searchParams.get('resumeId');
    const id = request.nextUrl.searchParams.get('id');

    if (!resumeId) {
      return NextResponse.json({ error: 'resumeId is required' }, { status: 400 });
    }

    // Single record detail
    if (id) {
      const analysis = await analysisRepository.findOwnedJdAnalysisById(user.id, id, resumeId);
      if (!analysis) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(analysis);
    }

    // List all
    const analyses = await analysisRepository.findOwnedJdAnalysesByResumeId(user.id, resumeId);
    if (!analyses) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const list = analyses.map((a: JdAnalysisRow) => ({
      id: a.id,
      overallScore: a.overallScore,
      atsScore: a.atsScore,
      jobDescription: a.jobDescription.slice(0, 100),
      createdAt: a.createdAt,
    }));

    return NextResponse.json(list);
  } catch (error) {
    console.error('GET /api/ai/jd-analysis/history error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const deleted = await analysisRepository.deleteOwnedJdAnalysis(user.id, id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/ai/jd-analysis/history error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
