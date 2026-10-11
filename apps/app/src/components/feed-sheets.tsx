/**
 * The two sheets a post opens without leaving the feed.
 *
 * PiecesSheet is "Shop the pieces": what is in the look, what it costs, and
 * trying the whole thing on. CommentsSheet is the conversation under a
 * look, with a box to add to it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { ApiError, api } from '../lib/api';
import { timeAgo } from '../lib/time';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Button } from './button';
import { Avatar } from './feed-post';
import { Sheet } from './sheet';
import { Body, BodyStrong, Caption, Price } from './text';

const SLOT_NAMES: Record<string, string> = {
  TOP: 'Top',
  BOTTOM: 'Bottom',
  FULL_BODY: 'Dress',
  OUTERWEAR: 'Layer',
  SHOES: 'Shoes',
  BAG: 'Bag',
  JEWELLERY: 'Jewellery',
  EYEWEAR: 'Eyewear',
  HEADWEAR: 'Headwear',
};

export function PiecesSheet({
  lookId,
  onClose,
  onTryOn,
}: {
  lookId: string | null;
  onClose: () => void;
  onTryOn: (lookId: string) => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();

  const look = useQuery({
    queryKey: ['look', lookId],
    queryFn: () => api.look(String(lookId)),
    enabled: Boolean(lookId),
  });

  const item = look.data;

  return (
    <Sheet open={Boolean(lookId)} onClose={onClose}>
      {look.isLoading || !item ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {item.image ? (
              <Image
                source={{ uri: item.image.url }}
                style={{ width: 52, height: 65, borderRadius: 10, backgroundColor: colors.sunk }}
                contentFit="cover"
              />
            ) : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Body
                numberOfLines={2}
                style={{
                  fontFamily: 'CormorantGaramond_600SemiBold',
                  fontSize: 25,
                  lineHeight: 29,
                }}
              >
                {item.title ?? 'This look'}
              </Body>
              <Caption>
                {`${item.items.length} ${item.items.length === 1 ? 'piece' : 'pieces'}, in the spirit of the photo`}
              </Caption>
            </View>
          </View>

          <View>
            {item.items.map((piece) => {
              const product = piece.product;
              const image = product?.image ?? piece.wardrobeItem?.image;

              return (
                <Pressable
                  key={piece.id}
                  disabled={!product}
                  onPress={() => {
                    if (!product) return;
                    onClose();
                    router.push({ pathname: '/product/[id]', params: { id: product.id } });
                  }}
                  accessibilityRole={product ? 'link' : undefined}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.line,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 58,
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
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
                    <Caption style={{ fontSize: 12 }}>
                      {SLOT_NAMES[piece.slot] ?? piece.slot}
                    </Caption>
                    <Body numberOfLines={1} style={{ fontSize: 15, lineHeight: 20 }}>
                      {product?.title ?? piece.wardrobeItem?.label ?? 'From their wardrobe'}
                    </Body>
                    {product ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Price
                          cents={product.priceFromCents}
                          style={{ fontSize: 14, color: colors.primary }}
                        />
                        <Caption numberOfLines={1} style={{ flexShrink: 1 }}>
                          {product.store.name}
                        </Caption>
                      </View>
                    ) : (
                      <Caption>Something they already own</Caption>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {item.shopTotalCents ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              }}
            >
              <Caption>Everything together</Caption>
              <Price cents={item.shopTotalCents} style={{ fontSize: 18 }} />
            </View>
          ) : null}

          <View style={{ gap: 10, marginTop: 4 }}>
            {item.canRecreate ? (
              <Button
                label="Try it on me"
                onPress={() => {
                  onClose();
                  onTryOn(item.id);
                }}
              />
            ) : null}
            <Button
              label="Open the look"
              variant="quiet"
              onPress={() => {
                onClose();
                router.push({ pathname: '/look/[id]', params: { id: item.id } });
              }}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

export function CommentsSheet({ lookId, onClose }: { lookId: string | null; onClose: () => void }) {
  const { colors, radius } = useTheme();
  const queryClient = useQueryClient();
  const { requireAccount } = useAuthGate();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const comments = useQuery({
    queryKey: ['comments', lookId],
    queryFn: () => api.comments(String(lookId)),
    enabled: Boolean(lookId),
  });

  const post = useMutation({
    mutationFn: (body: string) => api.addComment(String(lookId), body),
    onSuccess: () => {
      setDraft('');
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['comments', lookId] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to join the conversation');
        return;
      }
      setProblem(error instanceof Error ? error.message : 'That did not post');
    },
  });

  const items = comments.data?.items ?? [];
  const text = draft.trim();

  return (
    <Sheet
      open={Boolean(lookId)}
      onClose={() => {
        setProblem(null);
        onClose();
      }}
      title="Comments"
    >
      {comments.isLoading ? (
        <View style={{ paddingVertical: 28, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ paddingVertical: 20, alignItems: 'center', gap: 4 }}>
          <BodyStrong>No comments yet</BodyStrong>
          <Caption align="center">
            Say what you would wear it to, or ask where something is from.
          </Caption>
        </View>
      ) : (
        items.map((comment) => (
          <View
            key={comment.id}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
          >
            <Avatar url={comment.author.avatar?.url} name={comment.author.displayName} size={32} />
            <View style={{ flex: 1, gap: 1 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
                <BodyStrong style={{ fontSize: 13, lineHeight: 18 }}>
                  {comment.author.handle}
                </BodyStrong>
                <Caption style={{ fontSize: 12 }}>{timeAgo(comment.createdAt)}</Caption>
              </View>
              <Body style={{ fontSize: 14, lineHeight: 20 }}>{comment.body}</Body>
            </View>
          </View>
        ))
      )}

      {problem ? <Caption tone="critical">{problem}</Caption> : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          paddingLeft: 16,
          paddingRight: 6,
          minHeight: 48,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment"
          placeholderTextColor={colors.muted}
          maxLength={500}
          multiline
          style={{
            flex: 1,
            fontFamily: 'DMSans_400Regular',
            fontSize: 15,
            color: colors.ink,
            paddingVertical: 12,
            maxHeight: 110,
            textAlignVertical: 'center',
          }}
          accessibilityLabel="Add a comment"
        />
        <Pressable
          onPress={() => text && post.mutate(text)}
          disabled={!text || post.isPending}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          style={{ paddingHorizontal: 12, paddingVertical: 10, opacity: text ? 1 : 0.4 }}
        >
          {post.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <BodyStrong style={{ color: colors.primary, fontSize: 15 }}>Post</BodyStrong>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
}
