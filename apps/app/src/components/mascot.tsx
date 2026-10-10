/**
 * Nima, the character.
 *
 * Five poses, drawn for the brand and cut from the contact sheet by
 * `scripts/extract-assets.mjs`. They replaced a version of this file that
 * drew the character in SVG, which was the right call while there was no
 * artwork and the wrong one the moment there was: the rendered character
 * has shading and weight that vector shapes were only approximating.
 *
 * Callers ask for a mood rather than a file, so a screen says what is
 * happening and the artwork can be reworked without touching any of them.
 */

import { Image } from 'expo-image';
import { View } from 'react-native';

export type MascotMood = 'happy' | 'thinking' | 'delighted' | 'resting' | 'peek';

const ART = {
  happy: require('../../assets/mascot.png'),
  thinking: require('../../assets/mascot-thinking.png'),
  delighted: require('../../assets/mascot-delighted.png'),
  resting: require('../../assets/mascot-resting.png'),
  peek: require('../../assets/mascot-peek.png'),
} as const;

const SAID = {
  happy: 'Nima',
  thinking: 'Nima, thinking',
  delighted: 'Nima, pleased',
  resting: 'Nima, waiting',
  peek: 'Nima, peeking',
} as const;

export interface MascotProps {
  size?: number;
  mood?: MascotMood;
}

export function Mascot({ size = 180, mood = 'happy' }: MascotProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={ART[mood]}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        // The character is the first thing on the opening screen, so it
        // should not fade in after everything else has settled.
        transition={0}
        accessibilityLabel={SAID[mood]}
      />
    </View>
  );
}
