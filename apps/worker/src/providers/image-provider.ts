/**
 * The image provider interface.
 *
 * Try-on sits behind this one interface so the model underneath can change
 * without touching the queue, the credit ledger or the app. Today it is
 * Gemini. If a dedicated try-on service turns out sharper on prints, it slots
 * in here and nothing else moves.
 */

export interface ReferenceImage {
  /** Raw bytes. The provider decides how to encode them. */
  data: Buffer;
  mimeType: string;
  /** What this picture shows, used in the prompt. */
  label: string;
}

export interface GenerateImageInput {
  prompt: string;
  references: ReferenceImage[];
  /** `fast` is the cheaper model, `high` the better one. */
  quality: 'fast' | 'high';
  aspectRatio?: '1:1' | '3:4' | '4:5' | '9:16';
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  model: string;
  /** Milliseconds spent inside the provider. */
  durationMs: number;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = 'ImageProviderError';
  }
}

export interface ImageProvider {
  readonly name: string;
  generate(input: GenerateImageInput): Promise<GeneratedImage>;
}
