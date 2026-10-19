/**
 * The top of a pushed screen: back, a title, and room on the right.
 */

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/index';
import { Title } from './text';

export function BackButton({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.line : colors.sunk,
      })}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="m14 6-6 6 6 6"
          stroke={colors.ink}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Pressable>
  );
}

export function ScreenHeader({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  /** Replaces the title, for a header with a face and a name in it. */
  children?: ReactNode;
}) {
  const { gutter, colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: gutter,
        paddingTop: insets.top + 10,
        paddingBottom: 10,
        backgroundColor: colors.ground,
      }}
    >
      <BackButton />
      <View style={{ flex: 1, minWidth: 0 }}>
        {children ?? (
          <Title style={{ fontSize: 24, lineHeight: 28 }} numberOfLines={1}>
            {title}
          </Title>
        )}
      </View>
      {right}
    </View>
  );
}
