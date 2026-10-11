/**
 * The circles across the top of For You.
 *
 * Where a story tray would be, Nima puts the places you get dressed for:
 * weddings, the office, the weekend. Each circle wears the best loved look
 * for that occasion, and tapping one narrows the feed to it. Tapping it
 * again, or "All", opens it back up. The first circle is your own style,
 * which is where the questionnaire lives.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Micro } from './text';

const SIZE = 64;

function Ring({
  label,
  active,
  dim,
  onPress,
  children,
  dashed = false,
}: {
  label: string;
  active: boolean;
  dim: boolean;
  onPress: () => void;
  children: React.ReactNode;
  dashed?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        width: SIZE + 6,
        alignItems: 'center',
        gap: 5,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          borderWidth: active ? 2.5 : dashed ? 1.5 : 2,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: dim ? colors.line : colors.accent,
          padding: 2.5,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
      <Micro
        numberOfLines={1}
        tone="ink"
        style={{ fontFamily: active ? 'DMSans_600SemiBold' : 'DMSans_400Regular', fontSize: 11.5 }}
      >
        {label}
      </Micro>
    </Pressable>
  );
}

export function OccasionRings({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();

  const occasions = useQuery({
    queryKey: ['occasions'],
    queryFn: api.occasions,
    staleTime: 10 * 60_000,
  });

  const items = occasions.data?.items ?? [];
  if (items.length === 0) return null;

  const inner = SIZE - 9;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, gap: 10 }}
    >
      <Ring
        label="Your style"
        active={false}
        dim={false}
        dashed
        onPress={() => router.push('/style')}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path
            d="M12 5v14M5 12h14"
            stroke={colors.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Ring>

      {selected ? (
        <Ring label="All" active={false} dim={false} onPress={() => onSelect(null)}>
          <View
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              backgroundColor: colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Micro tone="primary" style={{ fontFamily: 'DMSans_600SemiBold' }}>
              For You
            </Micro>
          </View>
        </Ring>
      ) : null}

      {items.map((occasion) => {
        const active = selected === occasion.key;

        return (
          <Ring
            key={occasion.key}
            label={occasion.label}
            active={active}
            // With one chosen, the others step back.
            dim={Boolean(selected) && !active}
            onPress={() => onSelect(active ? null : occasion.key)}
          >
            {occasion.image ? (
              <Image
                source={{ uri: occasion.image.url }}
                contentFit="cover"
                contentPosition="top"
                style={{
                  width: inner,
                  height: inner,
                  borderRadius: inner / 2,
                  backgroundColor: colors.sunk,
                }}
              />
            ) : (
              <View
                style={{
                  width: inner,
                  height: inner,
                  borderRadius: inner / 2,
                  backgroundColor: colors.sunk,
                }}
              />
            )}
          </Ring>
        );
      })}
    </ScrollView>
  );
}
