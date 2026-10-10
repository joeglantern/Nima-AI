/**
 * The style question, asked with pictures.
 *
 * "Heritage" and "Minimal" are words people read differently, and a
 * questionnaire that asks you to agree with a word gets vaguer answers
 * than one that shows you a rail and asks which you would reach for. The
 * eight tiles are the eight aesthetics the profile stores, drawn as one
 * set so they read as a choice rather than a gallery.
 */

import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/index';
import { BodyStrong } from './text';

export interface Vibe {
  label: string;
  art: number;
}

export const VIBES: Vibe[] = [
  { label: 'Smart casual', art: require('../../assets/vibes/vibe-smart-casual.png') },
  { label: 'Streetwear', art: require('../../assets/vibes/vibe-streetwear.png') },
  { label: 'Heritage', art: require('../../assets/vibes/vibe-heritage.png') },
  { label: 'Minimal', art: require('../../assets/vibes/vibe-minimal.png') },
  { label: 'Elegant', art: require('../../assets/vibes/vibe-elegant.png') },
  { label: 'Sporty', art: require('../../assets/vibes/vibe-sporty.png') },
  { label: 'Bold colour', art: require('../../assets/vibes/vibe-bold.png') },
  { label: 'Vintage', art: require('../../assets/vibes/vibe-vintage.png') },
];

export function VibeTiles({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (label: string) => void;
}) {
  const { colors, radius, isCompact } = useTheme();
  const columns = isCompact ? 2 : 4;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {VIBES.map((vibe) => {
        const chosen = selected.includes(vibe.label);

        return (
          <Pressable
            key={vibe.label}
            onPress={() => onToggle(vibe.label)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: chosen }}
            accessibilityLabel={vibe.label}
            style={({ pressed }) => ({
              width: `${100 / columns}%`,
              flexGrow: 1,
              flexBasis: `${100 / columns - 4}%`,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                aspectRatio: 3 / 4,
                borderRadius: radius.image,
                overflow: 'hidden',
                backgroundColor: colors.sunk,
                // The ring is the whole answer to "which did I pick", so it
                // is thick enough to read at a glance on a small tile.
                borderWidth: chosen ? 3 : 1,
                borderColor: chosen ? colors.accent : colors.line,
              }}
            >
              <Image
                source={vibe.art}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={120}
              />

              {chosen ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accent,
                  }}
                >
                  <Svg width={15} height={15} viewBox="0 0 24 24">
                    <Path
                      d="m5 13 4.5 4.5L19 7"
                      stroke={colors.onAccent}
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </Svg>
                </View>
              ) : null}
            </View>

            <BodyStrong
              style={{
                fontSize: 14,
                marginTop: 7,
                color: chosen ? colors.primary : colors.ink,
              }}
              numberOfLines={1}
            >
              {vibe.label}
            </BodyStrong>
          </Pressable>
        );
      })}
    </View>
  );
}
