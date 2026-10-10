/**
 * What Nima is told about itself, and what it is told about you.
 *
 * The persona comes from the brand book: intelligent, refined, approachable.
 * A trusted personal shopper, not a hype machine.
 *
 * The prompt is kept short on purpose. On a CPU, every token in the system
 * prompt is time before the first word appears, and a long prompt does not
 * make a small model more stylish. Facts belong in tool results, not here.
 */

import type { StyleProfile, WardrobeItem } from '@nima/db';

export const NIMA_PERSONA = [
  'You are Nima, a personal shopper in Nairobi.',
  'You help people decide what to wear and what to buy.',
  '',
  'How you speak:',
  '- Confident, warm, direct. Two or three sentences, never more.',
  '- Plain words. No hype, no exclamation marks, no emoji.',
  '- Kenyan context: prices in KSh, local occasions, local weather.',
  '- Say what works and why in one short clause, as a stylist would.',
  '',
  'Rules you never break:',
  '- Only mention items that came back from a tool. Never invent a product,',
  '  a price or a shop.',
  '- If nothing fits what they asked for, say so and offer the nearest thing.',
  '- Never promise a fit. Nima shows how something looks, not how it fits.',
  '- Never comment on body shape or weight.',
].join('\n');

export interface StylistContext {
  displayName: string | null;
  style: StyleProfile | null;
  wardrobe: WardrobeItem[];
  credits: number;
  hasPhoto: boolean;
}

/** A compact description of this person, added as a second system message. */
export function describeShopper(context: StylistContext): string {
  const lines: string[] = [];

  if (context.displayName) lines.push(`Name: ${context.displayName}`);

  const style = context.style;
  if (style) {
    if (style.aesthetics.length) lines.push(`Likes: ${style.aesthetics.join(', ')}`);
    if (style.favouriteColours.length) lines.push(`Colours: ${style.favouriteColours.join(', ')}`);
    if (style.avoidColours.length) lines.push(`Avoids: ${style.avoidColours.join(', ')}`);
    if (style.occasions.length) lines.push(`Dresses for: ${style.occasions.join(', ')}`);

    if (style.budgetMaxCents) {
      const low = style.budgetMinCents ? Math.round(style.budgetMinCents / 100) : 0;
      const high = Math.round(style.budgetMaxCents / 100);
      lines.push(`Usual spend per piece: KSh ${low} to ${high}`);
    }

    const sizes = [
      style.topSize ? `top ${style.topSize}` : null,
      style.bottomSize ? `bottom ${style.bottomSize}` : null,
      style.shoeSizeEu ? `shoe ${String(style.shoeSizeEu)}` : null,
    ].filter(Boolean);

    if (sizes.length) lines.push(`Sizes: ${sizes.join(', ')}`);
    if (style.summary) lines.push(`Notes: ${style.summary}`);
  }

  if (context.wardrobe.length > 0) {
    const owned = context.wardrobe
      .slice(0, 20)
      .map((item) => item.label ?? `${item.colours[0] ?? ''} ${item.category}`.trim())
      .join(', ');
    lines.push(`Already owns: ${owned}`);
  }

  if (!context.hasPhoto) {
    lines.push('Has not added a photo yet, so cannot try anything on.');
  }

  if (lines.length === 0) {
    return 'You know nothing about this person yet. Ask one short question before suggesting.';
  }

  return `About this person:\n${lines.join('\n')}`;
}

/** Opening suggestions, shown as chips before the first message. */
export const SUGGESTED_PROMPTS = [
  { label: 'What should I wear today?', message: 'What should I wear today?' },
  { label: 'Something for a wedding', message: 'Help me put together a look for a wedding' },
  { label: 'Under KSh 3,000', message: 'Show me something good under KSh 3,000' },
  { label: 'Style what I own', message: 'What can I wear with the clothes in my wardrobe?' },
  { label: 'Make this smarter', message: 'How do I make my usual outfit look smarter?' },
] as const;
