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
    'Keep their face, body and identity exactly the same.',
    'Professional fashion photograph, clean background.',
  ].join(' ');
}

/** What a ghost shot is made of: the words for the garment and what kind it is. */
export interface GhostSubject {
  description: string;
  category: string;
}

/** The wall every ghost shot hangs on. The app paints its rail the same colour. */
export const GHOST_WALL_HEX = '#F4F3F1';

/** How a piece hangs. Shoes, bags and jewellery do not hang at all. */
function hangPhrase(category: string): string {
  switch (category) {
    case 'BOTTOM':
      return 'It hangs by its waistband from a slim clothes hanger of pale natural beech wood fitted with two small brass clips, the legs or skirt falling straight with the natural volume of a body inside.';
    case 'TOP':
    case 'DRESS':
    case 'OUTERWEAR':
      return 'Shoulders filled out, chest with natural volume, sleeves falling naturally, the neckline open so the inside back of the collar is visible. It hangs by its shoulders from a slim clothes hanger of pale natural beech wood with a thin brushed brass hook.';
    default:
      return 'It is placed alone and centred, shown from its best angle, with no hanger and no stand.';
  }
}

function hangs(category: string): boolean {
  return ['TOP', 'DRESS', 'OUTERWEAR', 'BOTTOM'].includes(category);
}

/**
 * Seller feature: a phone photo becomes a catalogue shot, the garment shaped
 * as if worn by an invisible person and hung on Nima's own wooden hanger.
 * The same words produced the sample shop's shots, so a real seller's piece
 * sits on the rail next to them without looking like a different shop.
 */
export function buildGhostMannequinPrompt(subject: GhostSubject): string {
  return [
    `Studio catalogue photograph of the exact same garment as in the reference photograph: ${subject.description}.`,
    'Same colour, same fabric texture, same cut, same buttons, collar, pockets, seams, stitching and any print, stripe or logo. Nothing about the garment changes. Only how it is presented changes.',
    `Ghost mannequin: the garment is shown as if worn by an invisible person. ${hangPhrase(subject.category)} No person, no mannequin, no hands, no body parts.`,
    hangs(subject.category)
      ? 'The hook is at the very top centre of the frame, its tip touching the top edge. The whole hanger is visible.'
      : '',
    'Portrait frame, 3:4. The subject fills about 85 percent of the frame height, centred.',
    `Background: a perfectly flat, even, warm off white, exactly ${GHOST_WALL_HEX}, from edge to edge. No floor line, no gradient, no vignette, no props, no text, no shadow on the background other than a very faint soft contact shadow directly behind the garment.`,
    'Soft, even studio light from the front. True to life colour. Photographic, with visible fabric detail. Not a render, not an illustration.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The shorter second attempt, for when the model returns nothing. */
export function buildSimpleGhostPrompt(subject: GhostSubject): string {
  return [
    `Catalogue photo of ${subject.description} from the reference image, unchanged, as if worn by an invisible person`,
    hangs(subject.category)
      ? 'on a wooden hanger with the hook at the top centre.'
      : 'with nothing else in frame.',
    `Flat ${GHOST_WALL_HEX} background, soft studio light, portrait 3:4.`,
  ].join(' ');
}
