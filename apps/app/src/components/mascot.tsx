/**
 * Nima, the character.
 *
 * Drawn rather than shipped as an image, for three reasons. It is a few
 * hundred bytes against a few hundred kilobytes, it stays sharp at any size
 * from the 28 point avatar in a chat row to the 200 point hero on the
 * opening screen, and it can take the palette of whichever theme is on
 * instead of being a cream blob on a dark background.
 *
 * The shape is the one from the brand book: a soft egg, cream on top, warm
 * sand below, with the join curved rather than cut. The curve is the whole
 * character. A straight line across the middle makes it look like a broken
 * image, which is exactly what the placeholder it replaces looked like.
 */

import { View } from 'react-native';
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../theme/index';

export type MascotMood = 'happy' | 'thinking' | 'delighted';

export interface MascotProps {
  size?: number;
  mood?: MascotMood;
  /** The sparkles are a flourish. They go when the mascot is small. */
  sparkles?: boolean;
}

export function Mascot({ size = 180, mood = 'happy', sparkles = size >= 96 }: MascotProps) {
  const { colors, scheme } = useTheme();
  const dark = scheme === 'dark';

  // The body keeps its own colours in both themes, because it is the
  // character and not a piece of interface. Only the shadow and the sparkles
  // move, so it sits on a dark background without a halo around it.
  const shellTop = '#FFFDF8';
  const shellBottom = '#F4EADA';
  const sandTop = '#D8B68C';
  const sandBottom = '#A67C52';
  const ink = dark ? '#3A1F26' : '#5C2A33';

  return (
    <View accessibilityLabel="Nima" accessible>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <LinearGradient id="shell" x1="0.3" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={shellTop} />
            <Stop offset="1" stopColor={shellBottom} />
          </LinearGradient>

          <LinearGradient id="sand" x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor={sandTop} />
            <Stop offset="1" stopColor={sandBottom} />
          </LinearGradient>

          <RadialGradient id="sheen" cx="0.34" cy="0.26" r="0.46">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="ground" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={colors.ink} stopOpacity={dark ? '0.5' : '0.18'} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity="0" />
          </RadialGradient>

          {/* Everything below is drawn inside the body and nowhere else. */}
          <ClipPath id="body">
            <Path d="M100 20c27 0 48 30 48 70 0 34-21 58-48 58s-48-24-48-58c0-40 21-70 48-70Z" />
          </ClipPath>
        </Defs>

        {/* It is standing on something, which is what stops it floating. */}
        <Ellipse cx="100" cy="150" rx="46" ry="10" fill="url(#ground)" />

        <G clipPath="url(#body)">
          <Path
            d="M100 20c27 0 48 30 48 70 0 34-21 58-48 58s-48-24-48-58c0-40 21-70 48-70Z"
            fill="url(#shell)"
          />

          {/*
            The sand half, with the join curved. Drawn past the edges on
            purpose: the clip decides where it stops, so the curve never has
            to meet the body outline exactly.
          */}
          <Path d="M-10 98c30-20 64-20 94-7s60 15 116-7v80H-10Z" fill="url(#sand)" />

          <Ellipse cx="76" cy="54" rx="31" ry="25" fill="url(#sheen)" />
        </G>

        {/* Cheeks sit under the eyes, so the eyes read first. */}
        <Ellipse cx="70" cy="92" rx="10" ry="6.5" fill="#E4A79C" opacity="0.55" />
        <Ellipse cx="130" cy="92" rx="10" ry="6.5" fill="#E4A79C" opacity="0.55" />

        <Eyes mood={mood} ink={ink} />
        <Mouth mood={mood} ink={ink} />

        {sparkles ? <Sparkles colour={dark ? '#C9A07A' : '#A67C52'} /> : null}
      </Svg>
    </View>
  );
}

function Eyes({ mood, ink }: { mood: MascotMood; ink: string }) {
  const stroke = { stroke: ink, strokeWidth: 5, strokeLinecap: 'round' as const, fill: 'none' };

  // Thinking looks away and up. Everything else is a pair of happy arcs,
  // which is the expression in the brand book.
  if (mood === 'thinking') {
    return (
      <G>
        <Path d="M70 78c3-4 9-4 12 0" {...stroke} />
        <Path d="M118 78c3-4 9-4 12 0" {...stroke} />
      </G>
    );
  }

  const lift = mood === 'delighted' ? 7 : 5;

  return (
    <G>
      <Path d={`M69 82c4.5-${lift} 12.5-${lift} 17 0`} {...stroke} />
      <Path d={`M114 82c4.5-${lift} 12.5-${lift} 17 0`} {...stroke} />
    </G>
  );
}

function Mouth({ mood, ink }: { mood: MascotMood; ink: string }) {
  if (mood === 'thinking') {
    return <Path d="M92 101h16" stroke={ink} strokeWidth={5} strokeLinecap="round" fill="none" />;
  }

  if (mood === 'delighted') {
    // Open, with the tongue just showing, which is the one in Design/1.png.
    return (
      <G>
        <Path d="M86 96a14 14 0 0 0 28 0Z" fill={ink} />
        <Path d="M95 106a6 4.5 0 0 0 10 0Z" fill="#E4857F" />
      </G>
    );
  }

  return (
    <Path d="M89 98c4 7 18 7 22 0" stroke={ink} strokeWidth={5} strokeLinecap="round" fill="none" />
  );
}

/**
 * Four pointed stars, not circles.
 *
 * Three of them, at different sizes, placed off the shoulders rather than
 * ringed around the head. A ring reads as loading.
 */
function Sparkles({ colour }: { colour: string }) {
  const star = (x: number, y: number, r: number, opacity: number) => (
    <Path
      d={`M${x} ${y - r}c${r * 0.14} ${r * 0.62} ${r * 0.24} ${r * 0.72} ${r} ${r}c-${r * 0.76} ${r * 0.28} -${r * 0.86} ${r * 0.38} -${r} ${r}c-${r * 0.14} -${r * 0.62} -${r * 0.24} -${r * 0.72} -${r} -${r}c${r * 0.76} -${r * 0.28} ${r * 0.86} -${r * 0.38} ${r} -${r}Z`}
      fill={colour}
      opacity={opacity}
    />
  );

  return (
    <G>
      {star(40, 52, 11, 0.9)}
      {star(160, 74, 8, 0.75)}
      {star(150, 36, 5, 0.55)}
    </G>
  );
}
