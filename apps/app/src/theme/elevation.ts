/**
 * One shadow that looks the same on all three platforms.
 *
 * The old style props are why a screen can look different in a browser and
 * on a phone. `shadowColor` and friends are iOS only. Android has always
 * ignored them and read `elevation` instead, which draws its own grey
 * shadow at its own angle. React Native for Web has deprecated them and
 * paints nothing. So the same component had an iOS shadow, a different
 * Android one, and none on the web.
 *
 * `boxShadow` is understood by all three under the new architecture, which
 * this app runs, so there is one declaration and one result.
 */

export type ElevationLevel = 'raised' | 'floating' | 'sheet';

interface ElevationOptions {
  /** Tint the shadow towards the thing casting it. Default is the ink. */
  colour?: string;
  /** A sheet at the bottom of the screen casts upwards. */
  up?: boolean;
  /** Pressed controls sit closer to the page. */
  pressed?: boolean;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;

  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LEVELS: Record<ElevationLevel, { y: number; blur: number; alpha: number }> = {
  // A control resting on the page: a tab row, a card that can be tapped.
  raised: { y: 3, blur: 10, alpha: 0.06 },
  // Something above the page: the main button, the floating stylist button.
  floating: { y: 6, blur: 16, alpha: 0.18 },
  // A sheet over the whole screen.
  sheet: { y: 12, blur: 30, alpha: 0.22 },
};

export function elevation(
  level: ElevationLevel,
  { colour = '#2D2926', up = false, pressed = false }: ElevationOptions = {},
): { boxShadow: string } {
  const { y, blur, alpha } = LEVELS[level];
  const offset = (pressed ? Math.round(y / 2) : y) * (up ? -1 : 1);

  return {
    boxShadow: `0px ${offset}px ${pressed ? Math.round(blur / 2) : blur}px ${rgba(colour, pressed ? alpha * 0.6 : alpha)}`,
  };
}
