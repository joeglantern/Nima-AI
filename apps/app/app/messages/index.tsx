/**
 * Messages.
 *
 * Everyone you have talked to, most recent first. Unread conversations are
 * bold with a dot, the way every inbox people already use does it. New
 * conversations start from someone's page or from sending them a look.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from '../../src/components/empty-state';
import { Avatar } from '../../src/components/feed-post';
import { NewMessageSheet } from '../../src/components/new-message-sheet';
import { ScreenHeader } from '../../src/components/screen-header';
import { Body, BodyStrong, Caption } from '../../src/components/text';
import { api, type Conversation } from '../../src/lib/api';
import { useSignedIn } from '../../src/lib/social';
import { timeAgo } from '../../src/lib/time';
import { useTheme } from '../../src/theme/index';

export default function InboxScreen() {
  const { colors, floatingClearance, isWide } = useTheme();
  const signedIn = useSignedIn();
  const [composing, setComposing] = useState(false);

  const inbox = useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => api.conversations(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: signedIn,
  });

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Messages' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader
          title="Messages"
          right={
            signedIn ? (
              <Pressable
                onPress={() => setComposing(true)}
                accessibilityRole="button"
                accessibilityLabel="New message"
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <Svg width={24} height={24} viewBox="0 0 24 24">
                  <Path
                    d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                    stroke={colors.ink}
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              </Pressable>
            ) : null
          }
        />

        {!signedIn ? (
          <EmptyState art="sparkle" message="Sign in to talk outfits with your friends." />
        ) : inbox.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <Row item={item} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 640 : undefined,
              width: '100%',
              alignSelf: 'center',
            }}
            onRefresh={() => void inbox.refetch()}
            refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
            }}
            ListEmptyComponent={
              <EmptyState
                art="sparkle"
                message="No messages yet. Send a look to a friend and the conversation starts here."
              />
            }
          />
        )}
      </View>

      <NewMessageSheet open={composing} onClose={() => setComposing(false)} />
    </>
  );
}

function Row({ item }: { item: Conversation }) {
  const { colors, gutter } = useTheme();
  const router = useRouter();

  const peer = item.peers[0];
  const unread = item.unreadCount > 0;
  const fromMe = item.lastMessage && item.lastMessage.senderId !== peer?.id;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${peer?.displayName ?? 'Conversation'}${unread ? ', unread' : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: gutter,
        paddingVertical: 10,
        backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <Avatar url={peer?.avatar?.url} name={peer?.displayName} size={54} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {unread ? (
          <BodyStrong numberOfLines={1} style={{ fontSize: 15 }}>
            {item.title ?? peer?.displayName ?? 'Someone'}
          </BodyStrong>
        ) : (
          <Body numberOfLines={1} style={{ fontSize: 15 }}>
            {item.title ?? peer?.displayName ?? 'Someone'}
          </Body>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Caption
            numberOfLines={1}
            tone={unread ? 'ink' : 'muted'}
            style={{
              flexShrink: 1,
              fontSize: 13,
              fontFamily: unread ? 'DMSans_600SemiBold' : undefined,
            }}
          >
            {item.lastMessage ? `${fromMe ? 'You: ' : ''}${item.lastMessage.preview}` : 'Say hello'}
          </Caption>
          {item.lastMessage ? (
            <Caption style={{ fontSize: 13 }}>{`· ${timeAgo(item.lastMessage.createdAt)}`}</Caption>
          ) : null}
        </View>
      </View>
      {unread ? (
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent }} />
      ) : null}
    </Pressable>
  );
}
