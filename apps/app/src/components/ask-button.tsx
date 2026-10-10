/**
 * The way into Ask Nima.
 *
 * A floating button, bottom right, above the feed. It is the one thing on
 * screen that is always available, because the stylist is the product.
 *
 * It hides itself on the Ask screen, so it never covers its own conversation.
 */

import { usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { elevation } from '../theme/elevation';
import { useTheme } from '../theme/index';
import { BodyStrong } from './text';

export function AskNimaButton() {
  const { colors, radius, isCompact } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  if (pathname.startsWith('/ask')) return null;

  return (
    <View
      style={{
        position: 'absolute',
        right: 16,
        bottom: insets.bottom + 20,
        // Nothing underneath it should be tappable through the gap.
        zIndex: 10,
      }}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => router.push('/ask')}
        accessibilityRole="button"
        accessibilityLabel="Ask Nima"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: isCompact ? 18 : 20,
          paddingVertical: 14,
          borderRadius: radius.pill,
          backgroundColor: colors.primary,
          opacity: pressed ? 0.9 : 1,
          ...elevation('floating', { colour: colors.primary, pressed }),
        })}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path
            d="M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3L12 4Z"
            fill={colors.onPrimary}
          />
          <Path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill={colors.onPrimary} />
        </Svg>
        <BodyStrong style={{ color: colors.onPrimary }}>Ask Nima</BodyStrong>
      </Pressable>
    </View>
  );
}
