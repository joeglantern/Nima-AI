/**
 * The palette, exactly as Nima's brand book defines it.
 *
 * Tailwind classes cover most of the interface, but some things take a colour
 * as a value rather than a class: the status bar, a gradient, an SVG fill, a
 * navigation theme. Those read from here, so there is still one source.
 */

export const light = {
  ground: '#FAF8F5',
  surface: '#FFFFFF',
  sunk: '#F2EEE8',
  ink: '#2D2926',
  muted: '#6E655E',
  line: '#E7E1D9',
  primary: '#5C2A33',
  primarySoft: '#F3E7E9',
  onPrimary: '#FAF8F5',
  secondary: '#A67C52',
  secondarySoft: '#F5EDE3',
  positive: '#2F7A4F',
  caution: '#A5621B',
  critical: '#A63C32',
  scrim: 'rgba(45, 41, 38, 0.45)',
} as const;

export const dark = {
  ground: '#1A1614',
  surface: '#241D1A',
  sunk: '#201A17',
  ink: '#F5F0E8',
  muted: '#A99C92',
  line: '#352C27',
  primary: '#A66B73',
  primarySoft: '#3A2529',
  onPrimary: '#1A1614',
  secondary: '#C9A07A',
  secondarySoft: '#33271E',
  positive: '#7CC79A',
  caution: '#E3AA6A',
  critical: '#EE8C80',
  scrim: 'rgba(0, 0, 0, 0.6)',
} as const;

/** The shape both palettes share. Values are plain colour strings. */
export type Palette = Record<keyof typeof light, string>;

/**
 * Type.
 *
 * Le Jour Serif is the wordmark and ships as an image asset, so it is not
 * loaded as a font. Cormorant Garamond carries headlines, DM Sans the
 * interface, JetBrains Mono the small uppercase labels.
 */
export const type = {
  display: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 48, lineHeight: 52 },
  title: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 36 },
  heading: { fontFamily: 'DMSans_600SemiBold', fontSize: 22, lineHeight: 28 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18 },
  label: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
} as const;

export const radius = {
  card: 24,
  image: 20,
  sheet: 28,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
} as const;

/**
 * Breakpoints.
 *
 * The layout follows the width of the window, not the kind of device, so a
 * narrow browser window gets the phone layout and a tablet gets the wide one.
 */
export const breakpoint = {
  tablet: 768,
  desktop: 1280,
} as const;
