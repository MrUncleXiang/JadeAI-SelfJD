import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { analysisRepository } from '@/lib/db/repositories/analysis.repository';
import { grammarChecks } from '@/lib/db/schema';

type GrammarCheckRow = typeof grammarChecks.$inferSelect;

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
      const check = await analysisRepository.findOwnedGrammarCheckById(user.id, id, resumeId);
      if (!check) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(check);
    }

    // List all
    const checks = await analysisRepository.findOwnedGrammarChecksByResumeId(user.id, resumeId);
    if (!checks) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const list = checks.map((c: GrammarCheckRow) => ({
      id: c.id,
      score: c.score,
      issueCount: c.issueCount,
      createdAt: c.createdAt,
    }));

    return NextResponse.json(list);
  } catch (error) {
    console.error('GET /api/ai/grammar-check/history error:', error);
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

    const deleted = await analysisRepository.deleteOwnedGrammarCheck(user.id, id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/ai/grammar-check/history error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
