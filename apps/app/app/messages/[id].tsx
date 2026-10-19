/**
 * One conversation.
 *
 * Bubbles, newest at the bottom, a box to type in that rises with the
 * keyboard. A shared look arrives as its picture and opens when tapped, so
 * "what about this one" is one tap from trying it on.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '../../src/components/feed-post';
import { ScreenHeader } from '../../src/components/screen-header';
import { Body, BodyStrong, Caption, Micro } from '../../src/components/text';
import { api, type Message } from '../../src/lib/api';
import { useServerFrame } from '../../src/lib/realtime';
import { timeAgo } from '../../src/lib/time';
import { useTheme } from '../../src/theme/index';

/** A gap this long between two messages earns a time label. */
const GAP = 20 * 60_000;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const { colors, gutter, radius, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const info = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.conversation(conversationId),
  });

  const thread = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => api.messages(conversationId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const markRead = useCallback(
    () =>
      api
        .markConversationRead(conversationId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['unread'] }))
        .catch(() => undefined),
    [conversationId, queryClient],
  );

  // Seen on arrival. New messages below mark themselves as they land.
  useEffect(() => {
    void markRead();
  }, [markRead]);

  useServerFrame('message.new', (frame) => {
    if (frame.conversationId !== conversationId) return;
    void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    void markRead();
  });

  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(conversationId, body),
    onMutate: (body) => {
      setDraft('');
      // Shown at once, replaced by the real one when the server answers.
      const pending: Message = {
        id: `pending-${Date.now()}`,
        kind: 'TEXT',
        body,
        senderId: 'me',
        mine: true,
        card: null,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<typeof thread.data>(['messages', conversationId], (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page, index) =>
                index === 0 ? { ...page, items: [pending, ...page.items] } : page,
              ),
            }
          : old,
      );
      return { body };
    },
    onError: (_error, _body, context) => {
      if (context?.body) setDraft(context.body);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const peer = info.data?.peers[0];
  const items = thread.data?.pages.flatMap((page) => page.items) ?? [];
  const text = draft.trim();

  return (
    <>
      <Stack.Screen options={{ title: peer?.displayName ?? 'Message' }} />
      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader>
          {peer ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/u/[handle]', params: { handle: peer.handle } })
              }
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Avatar url={peer.avatar?.url} name={peer.displayName} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <BodyStrong numberOfLines={1} style={{ fontSize: 16 }}>
                  {peer.displayName}
                </BodyStrong>
                <Micro numberOfLines={1}>{`@${peer.handle}`}</Micro>
              </View>
            </Pressable>
          ) : null}
        </ScreenHeader>
        <View style={{ height: 1, backgroundColor: colors.line }} />

        {thread.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingVertical: 12,
              gap: 4,
              maxWidth: isWide ? 720 : undefined,
              width: '100%',
              alignSelf: 'center',
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
            }}
            renderItem={({ item, index }) => {
              // Inverted: the one above on screen is the next in the array.
              const older = items[index + 1];
              const showTime =
                !older ||
                new Date(item.createdAt).getTime() - new Date(older.createdAt).getTime() > GAP;
              return (
                <View>
                  {showTime ? (
                    <Micro align="center" style={{ marginVertical: 10 }}>
                      {timeAgo(item.createdAt, 'long')}
                    </Micro>
                  ) : null}
                  <Bubble message={item} />
                </View>
              );
            }}
            ListEmptyComponent={
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 40,
                  // The empty view is drawn upside down in an inverted list.
                  transform: [{ scaleY: -1 }],
                }}
              >
                {peer ? <Avatar url={peer.avatar?.url} name={peer.displayName} size={72} /> : null}
                <BodyStrong style={{ marginTop: 6 }}>{peer?.displayName}</BodyStrong>
                <Caption align="center">
                  Say hello, or send them a look you think they would wear.
                </Caption>
              </View>
            }
          />
        )}

        {info.data?.blocked ? (
          <Caption
            align="center"
            style={{ paddingVertical: 16, paddingBottom: insets.bottom + 16 }}
          >
            You can no longer message this person.
          </Caption>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              paddingHorizontal: gutter,
              paddingTop: 8,
              paddingBottom: insets.bottom + 10,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              backgroundColor: colors.ground,
            }}
          >
            <View
              style={{
                flex: 1,
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 16,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={1}
                maxLength={2000}
                style={{
                  fontFamily: 'DMSans_400Regular',
                  fontSize: 15,
                  color: colors.ink,
                  paddingVertical: 10,
                  maxHeight: 120,
                  textAlignVertical: 'center',
                }}
                accessibilityLabel="Message"
              />
            </View>
            <Pressable
              onPress={() => text && send.mutate(text)}
              disabled={!text}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: text ? colors.accent : colors.sunk,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24">
                <Path
                  d="M12 19V5m0 0-6 6m6-6 6 6"
                  stroke={text ? colors.onAccent : colors.muted}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const { colors } = useTheme();
  const router = useRouter();
  const mine = message.mine;
  const pending = message.id.startsWith('pending-');

  if (message.card) {
    const card = message.card;
    const open = () => {
      if (message.kind === 'LOOK')
        router.push({ pathname: '/look/[id]', params: { id: card.refId } });
      else if (message.kind === 'PRODUCT') {
        router.push({ pathname: '/product/[id]', params: { id: card.refId } });
      }
    };

    return (
      <Pressable
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={card.title ?? 'Shared look'}
        style={({ pressed }) => ({
          alignSelf: mine ? 'flex-end' : 'flex-start',
          width: 220,
          borderRadius: 18,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          opacity: pressed ? 0.85 : 1,
          marginVertical: 2,
        })}
      >
        {card.image ? (
          <Image
            source={{ uri: card.image.url }}
            style={{ width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.sunk }}
            contentFit="cover"
            contentPosition="top"
          />
        ) : null}
        <View style={{ padding: 10, gap: 1 }}>
          <BodyStrong numberOfLines={1} style={{ fontSize: 14 }}>
            {card.title ?? (message.kind === 'LOOK' ? 'A look' : 'A piece')}
          </BodyStrong>
          {card.subtitle ? (
            <Caption numberOfLines={1} style={{ fontSize: 12 }}>
              {card.subtitle}
            </Caption>
          ) : null}
        </View>
      </Pressable>
    );
  }

  if (!message.body) {
    return (
      <Caption
        style={{
          alignSelf: mine ? 'flex-end' : 'flex-start',
          fontStyle: 'italic',
          marginVertical: 2,
        }}
      >
        Message removed
      </Caption>
    );
  }

  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        backgroundColor: mine ? colors.accent : colors.surface,
        borderWidth: mine ? 0 : 1,
        borderColor: colors.line,
        opacity: pending ? 0.6 : 1,
        marginVertical: 1,
      }}
    >
      <Body style={{ fontSize: 15, lineHeight: 21, color: mine ? colors.onAccent : colors.ink }}>
        {message.body}
      </Body>
    </View>
  );
}
