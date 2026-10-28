/**
 * Your circle: the people you follow.
 *
 * Faces and names, newest first. There is no count at the top on purpose.
 * Nima never shows how many people someone follows or is followed by, so a
 * profile is never a score.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { EmptyState } from '../src/components/empty-state';
import { Avatar } from '../src/components/feed-post';
import { ScreenHeader } from '../src/components/screen-header';
import { BodyStrong, Caption } from '../src/components/text';
import { api, type Peer } from '../src/lib/api';
import { useTheme } from '../src/theme/index';

export default function CircleScreen() {
  const { colors, floatingClearance, isWide } = useTheme();

  const circle = useInfiniteQuery({
    queryKey: ['circle-all'],
    queryFn: ({ pageParam }) => api.circle(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = circle.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Your circle' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title="Your circle" />
        {circle.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <Row person={item} />}
            contentContainerStyle={{
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 640 : undefined,
              width: '100%',
              alignSelf: 'center',
            }}
            ListHeaderComponent={
              items.length ? (
                <Caption style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
                  The people whose looks you follow. Only you see this list.
                </Caption>
              ) : null
            }
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (circle.hasNextPage && !circle.isFetchingNextPage) void circle.fetchNextPage();
            }}
            ListEmptyComponent={
              <EmptyState
                art="person"
                message="You are not following anyone yet. When you follow someone, their looks come to For You."
              />
            }
          />
        )}
      </View>
    </>
  );
}

function Row({ person }: { person: Peer }) {
  const { colors, gutter, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(true);

  const follow = useMutation({
    mutationFn: (next: boolean) => api.follow(person.handle, next),
    onMutate: (next) => setFollowing(next),
    onError: (_error, next) => setFollowing(!next),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['circle'] });
      void queryClient.invalidateQueries({ queryKey: ['person', person.handle] });
    },
  });

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: gutter,
        paddingVertical: 10,
      }}
    >
      <Pressable
        onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: person.handle } })}
        accessibilityRole="link"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}
      >
        <Avatar url={person.avatar?.url} name={person.displayName} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <BodyStrong numberOfLines={1}>{person.displayName}</BodyStrong>
          <Caption numberOfLines={1}>{`@${person.handle}`}</Caption>
        </View>
      </Pressable>
      <Pressable
        onPress={() => follow.mutate(!following)}
        accessibilityRole="button"
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
          {following ? 'Following' : 'Follow'}
        </BodyStrong>
      </Pressable>
    </View>
  );
}
