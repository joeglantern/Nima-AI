/**
 * Activity.
 *
 * Who loved your looks, who said something about them, who started
 * following you. Grouped the way people think about time, newest first, and
 * everything marked as seen once you have opened it.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, View } from 'react-native';
import { EmptyState } from '../src/components/empty-state';
import { Avatar } from '../src/components/feed-post';
import { ScreenHeader } from '../src/components/screen-header';
import { Body, BodyStrong, Caption } from '../src/components/text';
import { api, type Notification } from '../src/lib/api';
import { sellOrders } from '../src/lib/routes';
import { useSignedIn } from '../src/lib/social';
import { timeAgo } from '../src/lib/time';
import { useTheme } from '../src/theme/index';

const DAY = 24 * 3600_000;

function bucket(iso: string): string {
  const age = Date.now() - new Date(iso).getTime();
  if (age < DAY) return 'Today';
  if (age < 7 * DAY) return 'This week';
  if (age < 30 * DAY) return 'This month';
  return 'Earlier';
}

export default function ActivityScreen() {
  const { colors, gutter, floatingClearance, isWide } = useTheme();
  const signedIn = useSignedIn();
  const queryClient = useQueryClient();

  const activity = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => api.notifications(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: signedIn,
  });

  const markRead = useMutation({
    mutationFn: api.markActivityRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['unread'] }),
  });

  // Seen once opened. The dots stay on this visit, so you can still tell
  // what was new, and are gone next time.
  const unread = activity.data?.pages[0]?.unread ?? 0;
  const { mutate } = markRead;
  useEffect(() => {
    if (unread > 0) mutate();
  }, [unread, mutate]);

  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const sections: Array<{ title: string; data: Notification[] }> = [];
  for (const item of items) {
    const title = bucket(item.createdAt);
    const last = sections.at(-1);
    if (last?.title === title) last.data.push(item);
    else sections.push({ title, data: [item] });
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Activity' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title="Activity" />

        {!signedIn ? (
          <EmptyState art="heart" message="Sign in to see who loves your looks." />
        ) : activity.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 640 : undefined,
              width: '100%',
              alignSelf: 'center',
            }}
            onRefresh={() => void activity.refetch()}
            refreshing={activity.isRefetching && !activity.isFetchingNextPage}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (activity.hasNextPage && !activity.isFetchingNextPage) {
                void activity.fetchNextPage();
              }
            }}
            renderSectionHeader={({ section }) => (
              <BodyStrong
                style={{
                  paddingHorizontal: gutter,
                  paddingTop: 18,
                  paddingBottom: 6,
                  fontSize: 16,
                }}
              >
                {section.title}
              </BodyStrong>
            )}
            renderItem={({ item }) => <Row item={item} />}
            ListEmptyComponent={
              <EmptyState
                art="heart"
                message="Nothing yet. When someone loves, comments on or follows your looks, it shows up here."
              />
            }
            ListFooterComponent={
              activity.isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}

function Row({ item }: { item: Notification }) {
  const { colors, gutter, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(item.followingBack ?? false);

  const follow = useMutation({
    mutationFn: (next: boolean) => api.follow(String(item.actor?.handle), next),
    onMutate: (next) => setFollowing(next),
    onError: (_error, next) => setFollowing(!next),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['person', item.actor?.handle] }),
  });

  const open = () => {
    if (!item.target) return;
    const [kind, id] = item.target.split('/');
    if (kind === 'look' && id) router.push({ pathname: '/look/[id]', params: { id } });
    else if (kind === 'u' && id) router.push({ pathname: '/u/[handle]', params: { handle: id } });
    else if (kind === 'order' && id) router.push({ pathname: '/order/[id]', params: { id } });
    else if (kind === 'sell') router.push(sellOrders());
  };

  // "Amani loved your look." The name is bold and the rest is not, which is
  // how the sentence is read.
  const name = item.actor?.displayName;
  const rest = name && item.body.startsWith(name) ? item.body.slice(name.length) : null;

  return (
    // No button role on the row itself: it holds the follow button, and a
    // button inside a button is invalid on the web.
    <Pressable
      onPress={open}
      accessibilityLabel={item.body}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: gutter,
        paddingVertical: 10,
        backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <Pressable
        onPress={() =>
          item.actor
            ? router.push({ pathname: '/u/[handle]', params: { handle: item.actor.handle } })
            : open()
        }
        accessibilityLabel={name ?? 'Nima'}
      >
        <Avatar url={item.actor?.avatar?.url} name={name} nima={!item.actor} size={44} />
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={{ fontSize: 14, lineHeight: 20 }} numberOfLines={3}>
          {rest !== null ? (
            <>
              <BodyStrong style={{ fontSize: 14, lineHeight: 20 }}>{name}</BodyStrong>
              {rest}
            </>
          ) : (
            item.body
          )}
          <Caption style={{ fontSize: 13 }}>{`  ${timeAgo(item.createdAt)}`}</Caption>
        </Body>
      </View>

      {item.type === 'NEW_FOLLOWER' && item.actor ? (
        <Pressable
          onPress={() => follow.mutate(!following)}
          accessibilityRole="button"
          accessibilityLabel={following ? 'Following' : 'Follow back'}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            height: 34,
            borderRadius: radius.chip,
            justifyContent: 'center',
            backgroundColor: following ? colors.sunk : colors.accent,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <BodyStrong style={{ fontSize: 13, color: following ? colors.ink : colors.onAccent }}>
            {following ? 'Following' : 'Follow back'}
          </BodyStrong>
        </Pressable>
      ) : item.image ? (
        <Image
          source={{ uri: item.image.url }}
          style={{ width: 46, height: 56, borderRadius: 6, backgroundColor: colors.sunk }}
          contentFit="cover"
          contentPosition="top"
        />
      ) : null}

      {!item.read ? (
        <View
          style={{
            position: 'absolute',
            left: 6,
            top: '50%',
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.accent,
          }}
        />
      ) : null}
    </Pressable>
  );
}
