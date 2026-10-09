/**
 * Prompts.
 *
 * Adapted from the previous codebase, which had them working on real Kenyan
 * outfits, with the GPT-4o prompt writing step removed: the item data we
 * already store says everything that step used to infer.
 *
 * The non negotiable part is identity. The person's face, body and skin must
 * survive the edit. Everything else is styling.
 */

import type { TryOnJobData } from '@nima/jobs';

const IDENTITY_RULES = [
  "Keep the person's face, hair, skin tone, body shape and size exactly as they are in Reference Image 1.",
  'Do not slim, lighten, retouch or change the person in any way.',
  'Keep their pose and the camera angle.',
].join(' ');

const PHOTO_RULES = [
  'Natural, even lighting.',
  'A clean, uncluttered background.',
  'The clothing should hang and fold the way real fabric does.',
  'Sharp, true to life colours.',
  'Full frame fashion photograph.',
].join(' ');

function slotPhrase(slot: string): string {
  switch (slot) {
    case 'TOP':
      return 'as the top';
    case 'BOTTOM':
      return 'as the trousers or skirt';
    case 'FULL_BODY':
      return 'as the dress or full outfit piece';
    case 'OUTERWEAR':
      return 'as the jacket or coat, worn open over the top';
    case 'SHOES':
      return 'on their feet';
    case 'BAG':
      return 'carried naturally';
    case 'JEWELLERY':
      return 'worn as jewellery';
    case 'EYEWEAR':
      return 'worn on their face';
    case 'HEADWEAR':
      return 'worn on their head';
    default:
      return 'worn naturally';
  }
}

/** The full prompt, with every garment named against its reference number. */
export function buildTryOnPrompt(data: TryOnJobData): string {
  const lines: string[] = [];

  lines.push(
    data.garments.length > 1
      ? 'Virtual try-on. Dress the person from Reference Image 1 in all of the clothing shown in the other reference images.'
      : 'Virtual try-on. Show the person from Reference Image 1 wearing the item in Reference Image 2.',
  );

  lines.push('Reference Image 1: the person.');

  data.garments.forEach((garment, index) => {
    lines.push(
      `Reference Image ${index + 2}: ${garment.description}, to be worn ${slotPhrase(garment.slot)}.`,
    );
  });

  if (data.instruction) {
    // A chained edit: the base image is the previous result.
    lines.push(`Change to make: ${data.instruction}. Leave everything else as it is.`);
  }

  lines.push(IDENTITY_RULES);
  lines.push(PHOTO_RULES);
  lines.push(
    'Match the garments in the reference images exactly: same colour, same pattern, same cut, same logos and text.',
  );

  return lines.join('\n');
}

/**
 * Second attempt. When a model returns nothing the usual cause is an
 * overloaded prompt, so the retry keeps the references and says less.
 */
export function buildSimplePrompt(data: TryOnJobData): string {
  const items = data.garments.map((garment) => garment.description).join(', ');

  return [
    `Show the person from Reference Image 1 wearing: ${items || 'the clothing in the other images'}.`,
    "Keep their face, body and identity exactly the same.",
    'Professional fashion photograph, clean background.',
  ].join(' ');
}

/** Seller feature: a flat lay becomes a clean catalogue shot. */
export function buildGhostMannequinPrompt(description: string): string {
  return [
    `Turn this photograph of ${description} into a clean catalogue image.`,
    'Show the garment as if worn by an invisible person: natural shape, open neckline, visible inner back.',
    'Pure white background. Even studio lighting. Soft contact shadow.',
    'Do not change the colour, pattern or cut of the garment.',
  ].join(' ');
}
