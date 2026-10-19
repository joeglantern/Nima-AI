/**
 * The heart and the paper plane: activity and messages, each with a count.
 *
 * They sit at the top of For You, where people look for them, and only for
 * someone with an account. A guest has nobody to hear from yet.
 */

import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSignedIn, useUnread } from '../lib/social';
import { useTheme } from '../theme/index';
import { Micro } from './text';

export function HeartIcon({ color, size = 25 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function PlaneIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21 4 3 11l7 2.5L21 4Zm0 0-7.5 16-3.5-6.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function CountBadge({ count, dot = false }: { count: number; dot?: boolean }) {
  const { colors } = useTheme();
  if (count <= 0) return null;

  if (dot) {
    return (
      <View
        style={{
          position: 'absolute',
          top: 3,
          right: 3,
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: colors.accent,
          borderWidth: 1.5,
          borderColor: colors.ground,
        }}
      />
    );
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: -2,
        right: -4,
        minWidth: 18,
        height: 18,
        paddingHorizontal: 4,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accent,
        borderWidth: 1.5,
        borderColor: colors.ground,
      }}
    >
      <Micro style={{ color: colors.onAccent, fontSize: 10, lineHeight: 13 }}>
        {count > 9 ? '9+' : String(count)}
      </Micro>
    </View>
  );
}

export function InboxButtons() {
  const { colors } = useTheme();
  const router = useRouter();
  const signedIn = useSignedIn();
  const unread = useUnread();

  if (!signedIn) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable
        onPress={() => router.push('/activity')}
        accessibilityRole="button"
        accessibilityLabel={unread.activity ? `Activity, ${unread.activity} new` : 'Activity'}
        hitSlop={6}
        style={{ padding: 6 }}
      >
        <HeartIcon color={colors.ink} />
        <CountBadge count={unread.activity} dot />
      </Pressable>
      <Pressable
        onPress={() => router.push('/messages')}
        accessibilityRole="button"
        accessibilityLabel={unread.messages ? `Messages, ${unread.messages} unread` : 'Messages'}
        hitSlop={6}
        style={{ padding: 6 }}
      >
        <PlaneIcon color={colors.ink} />
        <CountBadge count={unread.messages} />
      </Pressable>
    </View>
  );
}
