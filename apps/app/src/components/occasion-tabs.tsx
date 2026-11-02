/**
 * The occasions across the top of For You.
 *
 * Words, not story circles: what you are getting dressed for. Tapping one
 * narrows the feed to it, and "All" opens it back up.
 */

import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, View } from 'react-native';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Body, BodyStrong } from './text';

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({ paddingTop: 8, opacity: pressed ? 0.6 : 1 })}
    >
      {active ? (
        <BodyStrong style={{ fontSize: 14, lineHeight: 20 }}>{label}</BodyStrong>
      ) : (
        <Body tone="muted" style={{ fontSize: 14, lineHeight: 20 }}>
          {label}
        </Body>
      )}
      <View
        style={{
          height: 1.5,
          marginTop: 8,
          backgroundColor: active ? colors.ink : 'transparent',
        }}
      />
    </Pressable>
  );
}

export function OccasionTabs({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const occasions = useQuery({
    queryKey: ['occasions'],
    queryFn: api.occasions,
    staleTime: 10 * 60_000,
  });

  const items = occasions.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 20 }}
    >
      <Tab label="All" active={!selected} onPress={() => onSelect(null)} />
      {items.map((occasion) => (
        <Tab
          key={occasion.key}
          label={occasion.label}
          active={selected === occasion.key}
          onPress={() => onSelect(selected === occasion.key ? null : occasion.key)}
        />
      ))}
    </ScrollView>
  );
}
