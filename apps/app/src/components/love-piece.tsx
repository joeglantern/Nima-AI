/**
 * Love a piece, wherever a piece is shown on its own.
 *
 * The same heart as the feed's piece card, answering at once and settling
 * with the server afterwards. A guest gets the sign in sheet instead of a
 * failed request.
 */

import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ApiError, api } from '../lib/api';
import { useSignedIn } from '../lib/social';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Micro } from './text';

export function LovePiece({
  productId,
  loved: lovedByMe,
  title,
}: {
  productId: string;
  loved: boolean;
  title: string;
}) {
  const { colors, radius } = useTheme();
  const { requireAccount } = useAuthGate();
  const signedIn = useSignedIn();
  const [loved, setLoved] = useState(lovedByMe);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => setLoved(lovedByMe), [lovedByMe]);

  const love = useMutation({
    mutationFn: () => api.lovePiece(productId),
    onSuccess: (result) => setLoved(result.saved),
    onError: (error) => {
      setLoved(lovedByMe);
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to keep the pieces you love');
      }
    },
  });

  return (
    <Pressable
      onPress={() => {
        if (!signedIn) {
          requireAccount('Create an account to keep the pieces you love');
          return;
        }
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        if (!loved) {
          scale.setValue(0.72);
          Animated.spring(scale, { toValue: 1, friction: 3.5, tension: 180, useNativeDriver: true }).start();
        }
        setLoved(!loved);
        love.mutate();
      }}
      accessibilityRole="button"
      accessibilityLabel={loved ? `Stop loving ${title}` : `Love ${title}`}
      accessibilityState={{ selected: loved }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: loved ? colors.accent : colors.line,
        backgroundColor: loved ? colors.accentSoft : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"
            stroke={loved ? colors.accent : colors.ink}
            strokeWidth={1.6}
            strokeLinejoin="round"
            fill={loved ? colors.accent : 'none'}
          />
        </Svg>
      </Animated.View>
      <Micro tone="ink" style={{ fontSize: 13, lineHeight: 16 }}>
        {loved ? 'Loved' : 'Love it'}
      </Micro>
    </Pressable>
  );
}
