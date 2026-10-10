/**
 * Gemini image generation.
 *
 * The previous app used the same approach and it worked well on Kenyan
 * fashion, so the recipe is kept. Two things are different here:
 *
 *   1. No second model writes the prompt. GPT-4o used to be called first,
 *      which cost money and added seconds. The prompt is built from the item
 *      data we already hold (see prompts.ts).
 *   2. The cheaper, faster model is the default. The better one is used for
 *      full outfits, where garment interaction actually matters.
 *
 * Model ids change. They are configuration, not constants, and the retired
 * ids from the old codebase are a reminder of why.
 */

import { GoogleGenAI } from '@google/genai';
import type { Env } from '@nima/config';
import {
  type GeneratedImage,
  type GenerateImageInput,
  type ImageProvider,
  ImageProviderError,
} from './image-provider.js';

interface InteractionsResponse {
  output_image?: { data: string; mime_type?: string };
  id?: string;
}

export function createGeminiProvider(env: Env): ImageProvider {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set, so no images can be generated');
  }

  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  return {
    name: 'gemini',

    async generate(input: GenerateImageInput): Promise<GeneratedImage> {
      const model = input.quality === 'high' ? env.GEMINI_IMAGE_MODEL : env.GEMINI_IMAGE_MODEL_FAST;
      const started = Date.now();

      // Reference images are numbered in the prompt, so order matters: the
      // person is always first.
      const parts = [
        { type: 'text', text: input.prompt },
        ...input.references.map((reference) => ({
          type: 'image',
          mime_type: reference.mimeType,
          data: reference.data.toString('base64'),
        })),
      ];

      try {
        const interaction = (await client.interactions.create({
          model,
          input: parts,
          response_format: {
            type: 'image',
            aspect_ratio: input.aspectRatio ?? '3:4',
            image_size: '1K',
          },
        } as never)) as InteractionsResponse;

        const image = interaction.output_image;
        if (!image?.data) {
          // An empty result is usually a safety filter or a confusing prompt.
          // Both are worth retrying once with the simpler prompt the caller
          // falls back to.
          throw new ImageProviderError('The model returned no image', true);
        }

        return {
          data: Buffer.from(image.data, 'base64'),
          mimeType: image.mime_type ?? 'image/png',
          model,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        if (error instanceof ImageProviderError) throw error;

        const message = error instanceof Error ? error.message : String(error);
        const status = (error as { status?: number }).status;

        // 429 and 5xx are worth another attempt. A bad request is not.
        const retryable = status === 429 || status === undefined || (status >= 500 && status < 600);

        throw new ImageProviderError(
          retryable ? 'The image service is busy' : `The image service refused: ${message}`,
          retryable,
          { cause: error },
        );
      }
    },
  };
}
