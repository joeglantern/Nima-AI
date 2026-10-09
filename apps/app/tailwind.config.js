/**
 * Design tokens, straight from Nima's brand book.
 *
 * Nothing in a component may use a raw hex value. If a colour is needed that
 * is not here, it belongs here first.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Light mode. The dark values live in src/theme/tokens.ts and are
        // applied through the theme provider, because React Native cannot
        // switch CSS variables the way a browser can.
        ground: '#FAF8F5',
        surface: '#FFFFFF',
        sunk: '#F2EEE8',
        ink: '#2D2926',
        muted: '#6E655E',
        line: '#E7E1D9',
        primary: {
          DEFAULT: '#5C2A33',
          soft: '#F3E7E9',
          ink: '#FAF8F5',
        },
        secondary: {
          DEFAULT: '#A67C52',
          soft: '#F5EDE3',
        },
        positive: '#2F7A4F',
        caution: '#A5621B',
        critical: '#A63C32',
      },
      fontFamily: {
        // Le Jour Serif is the logo only and ships as an asset.
        display: ['CormorantGaramond_600SemiBold'],
        'display-regular': ['CormorantGaramond_500Medium'],
        sans: ['DMSans_400Regular'],
        medium: ['DMSans_500Medium'],
        semibold: ['DMSans_600SemiBold'],
        bold: ['DMSans_700Bold'],
        mono: ['JetBrainsMono_400Regular'],
        'mono-medium': ['JetBrainsMono_500Medium'],
      },
      fontSize: {
        label: ['12px', { lineHeight: '16px', letterSpacing: '1.6px' }],
        caption: ['13px', { lineHeight: '18px' }],
        body: ['16px', { lineHeight: '24px' }],
        heading: ['22px', { lineHeight: '28px' }],
        title: ['30px', { lineHeight: '36px' }],
        display: ['48px', { lineHeight: '52px' }],
      },
      borderRadius: {
        card: '24px',
        image: '20px',
        sheet: '28px',
        pill: '999px',
      },
      spacing: {
        gutter: '16px',
        'gutter-wide': '24px',
      },
    },
  },
  plugins: [],
};
