import { NextRequest, NextResponse } from 'next/server';
import { AIConfigError } from '@/lib/ai/provider';
import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { resolveLlmConfig } from '@/lib/llm/resolver';

export const maxDuration = 60;
const MAX_IMAGE_INPUT_CHARS = 15 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8_000;
const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '3:4', '2:3', '4:3']);

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(getUserIdFromRequest(request));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { image, prompt, requirements, aspectRatio } = await request.json();

    if (!image || typeof image !== 'string' || image.length > MAX_IMAGE_INPUT_CHARS) {
      return NextResponse.json(
        { error: 'Image is required and must not exceed the upload limit' },
        { status: 400 }
      );
    }
    if (
      typeof prompt !== 'string'
      || prompt.length === 0
      || prompt.length > MAX_PROMPT_CHARS
      || (requirements !== undefined && (
        typeof requirements !== 'string' || requirements.length > MAX_PROMPT_CHARS
      ))
      || (aspectRatio !== undefined && (
        typeof aspectRatio !== 'string' || !ALLOWED_ASPECT_RATIOS.has(aspectRatio)
      ))
    ) {
      return NextResponse.json({ error: 'Invalid prompt' }, { status: 400 });
    }

    const aiConfig = await resolveLlmConfig(user.id, 'vision');
    if (aiConfig.provider !== 'gemini') {
      return NextResponse.json({
        code: 'LLM_PROFILE_PROVIDER_UNSUPPORTED',
        error: 'LinkedIn photo generation requires a Gemini image-generation profile bound to vision.',
      }, { status: 422 });
    }

    // Build final prompt with aspect ratio and requirements
    let finalPrompt = prompt;
    if (aspectRatio && aspectRatio !== '1:1') {
      finalPrompt += `\n\nOutput image aspect ratio: ${aspectRatio} (width:height).`;
    }
    if (requirements) {
      finalPrompt += `\n\nAdditional requirements: ${requirements}`;
    }

    // Extract base64 data and mime type from data URL
    const dataUrlMatch = image.match(/^data:(image\/[\w+]+);base64,([\s\S]+)$/);
    const mimeType = dataUrlMatch ? dataUrlMatch[1] : 'image/jpeg';
    const base64Data = dataUrlMatch ? dataUrlMatch[2] : image;

    // Gemini REST API accepts both camelCase and snake_case in requests,
    // but we use camelCase to match the canonical proto-JSON format.
    const modelName = aiConfig.model.replace(/^models\//, '');
    const endpoint = `${aiConfig.baseURL.replace(/\/$/, '')}/models/${encodeURIComponent(modelName)}:generateContent`;
    const res = await (aiConfig.fetch || fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': aiConfig.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: finalPrompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    });

    if (!res.ok) {
      await res.body?.cancel();
      console.error('Gemini image provider error:', res.status);

      if (res.status === 400 || res.status === 403) {
        return NextResponse.json(
          { error: 'invalid_key' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'generate_failed' },
        { status: res.status }
      );
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;

    if (!parts || parts.length === 0) {
      // Check for safety filtering (handle both camelCase and snake_case)
      const candidate = data?.candidates?.[0];
      const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
      if (finishReason === 'SAFETY') {
        return NextResponse.json(
          { error: 'safety_filtered' },
          { status: 400 }
        );
      }
      console.error('Gemini image provider returned no content:', finishReason || 'UNKNOWN');
      return NextResponse.json(
        { error: 'generate_failed', detail: 'No content in response' },
        { status: 500 }
      );
    }

    // Extract image and text from parts
    // Handle both camelCase (inlineData/mimeType) and snake_case (inline_data/mime_type)
    let resultImage: string | null = null;
    let resultText: string | null = null;

    for (const part of parts) {
      const inlineData = part.inlineData ?? part.inline_data;
      if (inlineData) {
        const mime = inlineData.mimeType ?? inlineData.mime_type ?? 'image/png';
        resultImage = `data:${mime};base64,${inlineData.data}`;
      }
      if (part.text) {
        resultText = part.text;
      }
    }

    if (!resultImage) {
      console.error('Gemini image provider returned no image part');
      return NextResponse.json(
        { error: 'generate_failed', detail: 'No image in response' },
        { status: 500 }
      );
    }

    return NextResponse.json({ image: resultImage, text: resultText });
  } catch (err) {
    if (err instanceof AIConfigError) {
      return NextResponse.json(
        { code: err.code, error: err.message },
        { status: err.status },
      );
    }
    console.error('LinkedIn photo generation error:', err instanceof Error ? err.name : 'UnknownError');
    return NextResponse.json(
      { error: 'generate_failed' },
      { status: 500 }
    );
  }
}
