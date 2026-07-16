import { NextResponse } from 'next/server';

import { AIConfigError } from '@/lib/ai/provider';

import { ResumeChangeServiceError } from './service';

export function resumeChangeErrorResponse(error: unknown) {
  if (error instanceof ResumeChangeServiceError || error instanceof AIConfigError) {
    return NextResponse.json({
      code: error.code,
      error: error.message,
      ...('details' in error && error.details ? { details: error.details } : {}),
    }, { status: error.status });
  }
  console.error('Resume change API error:', error);
  return NextResponse.json({ code: 'INTERNAL_ERROR', error: 'Internal server error' }, { status: 500 });
}
