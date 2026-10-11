/**
 * One lookbook.
 *
 * What is in it, grouped by day when the entries carry one, because a trip
 * is packed a day at a time. Everything is tappable through to the thing
 * itself.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from '../../src/components/empty-state';
import { Body, BodyStrong, Micro, Price, Title } from '../../src/components/text';
import { api, type LookbookEntry } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';

export default function LookbookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, isWide } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const book = useQuery({
    queryKey: ['lookbook', id],
    queryFn: () => api.lookbook(String(id)),
    enabled: Boolean(id),
  });

  const remove = useMutation({
    mutationFn: (entryId: string) => api.removeFromLookbook(String(id), entryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lookbook', id] });
      void queryClient.invalidateQueries({ queryKey: ['lookbooks'] });
    },
  });

  if (book.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!book.data) return <EmptyState art="book" message="That lookbook is not here." />;

  const { lookbook, entries } = book.data;

  // Entries with a day go in order under a heading. Everything else sits
  // together at the end, which is most lookbooks.
  const days = new Map<number, LookbookEntry[]>();
  const loose: LookbookEntry[] = [];

  for (const entry of entries) {
    if (entry.dayIndex === null) {
      loose.push(entry);
      continue;
    }
    const bucket = days.get(entry.dayIndex);
    if (bucket) bucket.push(entry);
    else days.set(entry.dayIndex, [entry]);
  }

  return (
    <>
      <Stack.Screen options={{ title: lookbook.title }} />

      <ScrollView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: 48,
          gap: 22,
          maxWidth: isWide ? 680 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Back"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.sunk,
            }}
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

          <View style={{ flex: 1, gap: 2 }}>
            <Title style={{ fontSize: 26, lineHeight: 32 }}>{lookbook.title}</Title>
            <Micro>
              {entries.length === 0
                ? 'Nothing in it yet'
                : `${entries.length} ${entries.length === 1 ? 'piece' : 'pieces'}`}
            </Micro>
          </View>
        </View>

        {entries.length === 0 ? (
          <EmptyState
            art="book"
            message="Add looks and pieces to this from anywhere in the app, with the Save button."
          />
        ) : null}

        {[...days.entries()]
          .sort(([a], [b]) => a - b)
          .map(([day, bucket]) => (
            <View key={day} style={{ gap: 12 }}>
              <BodyStrong>{`Day ${day + 1}`}</BodyStrong>
              {bucket.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onRemove={() => remove.mutate(entry.id)} />
              ))}
            </View>
          ))}

        {loose.length > 0 ? (
          <View style={{ gap: 12 }}>
            {days.size > 0 ? <BodyStrong>Everything else</BodyStrong> : null}
            {loose.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onRemove={() => remove.mutate(entry.id)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function EntryRow({ entry, onRemove }: { entry: LookbookEntry; onRemove: () => void }) {
  const { colors, radius } = useTheme();
  const router = useRouter();

  const image = entry.look?.image ?? entry.product?.image ?? entry.wardrobeItem?.image ?? null;
  const title =
    entry.look?.title ?? entry.product?.title ?? entry.wardrobeItem?.label ?? 'From your wardrobe';
  const subtitle = entry.product?.store.name ?? entry.occasion ?? entry.note ?? null;

  function open() {
    if (entry.look) router.push({ pathname: '/look/[id]', params: { id: entry.look.id } });
    else if (entry.product)
      router.push({ pathname: '/product/[id]', params: { id: entry.product.id } });
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 12,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      <Pressable
        onPress={open}
        style={{
          width: 56,
          height: 72,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: colors.sunk,
        }}
      >
        {image ? (
          <Image
            source={{ uri: image.url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={title}
          />
        ) : null}
      </Pressable>

      <Pressable onPress={open} style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={1}>{title}</Body>
        {subtitle ? <Micro>{subtitle}</Micro> : null}
        {entry.product ? (
          <Price cents={entry.product.priceFromCents} style={{ fontSize: 14 }} />
        ) : null}
      </Pressable>

      <Pressable onPress={onRemove} accessibilityLabel={`Remove ${title}`} hitSlop={8}>
        <Micro tone="muted">Remove</Micro>
      </Pressable>
    </View>
  );
}
