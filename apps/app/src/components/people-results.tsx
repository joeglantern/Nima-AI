/**
 * People who match a search.
 *
 * Shown above the products while something is typed in the shop's search,
 * as one row of faces. Typing "@" first narrows the search to people, which
 * is what anyone used to other apps will try.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api } from '../lib/api';
import { useTheme } from '../theme/index';
import { Caption, Eyebrow, Micro, Title } from './text';

/** Waits until typing pauses, so every keystroke is not a request. */
function useSettled(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function PeopleResults({ query }: { query: string }) {
  const { colors, gutter } = useTheme();
  const router = useRouter();
  const q = useSettled(query.trim());
  const wanted = q.replace(/^@/, '');

  const people = useQuery({
    queryKey: ['people', wanted],
    queryFn: () => api.searchProfiles(wanted),
    enabled: wanted.length >= 2,
    staleTime: 30_000,
  });

  const items = people.data?.items ?? [];
  if (wanted.length < 2) return null;
  if (items.length === 0) {
    return q.startsWith('@') && !people.isLoading ? (
      <Caption style={{ paddingHorizontal: gutter }}>{`Nobody called ${q} yet.`}</Caption>
    ) : null;
  }

  return (
    <View style={{ gap: 10 }}>
      <Eyebrow style={{ paddingHorizontal: gutter }}>People</Eyebrow>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: gutter, gap: 14 }}
      >
        {items.map((person) => (
          <Pressable
            key={person.handle}
            onPress={() =>
              router.push({ pathname: '/u/[handle]', params: { handle: person.handle } })
            }
            accessibilityRole="button"
            accessibilityLabel={`${person.displayName}, @${person.handle}`}
            style={({ pressed }) => ({
              width: 76,
              alignItems: 'center',
              gap: 6,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                overflow: 'hidden',
                backgroundColor: colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: colors.accent,
              }}
            >
              {person.avatar ? (
                <Image
                  source={{ uri: person.avatar.url }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <Title style={{ fontSize: 26, lineHeight: 32, color: colors.primary }}>
                  {person.displayName.trim().charAt(0).toUpperCase()}
                </Title>
              )}
            </View>
            <Micro tone="ink" numberOfLines={1} align="center">
              {person.displayName}
            </Micro>
            <Micro numberOfLines={1} align="center" style={{ marginTop: -4 }}>
              {`@${person.handle}`}
            </Micro>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
