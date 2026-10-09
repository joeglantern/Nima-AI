/**
 * For You.
 *
 * The main feed. It works without an account: a visitor sees looks ranked
 * from what they have tapped in this session, and the sign in sheet only
 * appears when they reach for something that needs to be theirs.
 */

import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api, ApiError, type FeedItem } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';
import { LookCard, ProductCard } from '../../src/components/cards';
import { Body, Caption, Heading, Label, Title } from '../../src/components/text';
import { Button } from '../../src/components/button';
import { EmptyState } from '../../src/components/empty-state';
import { useAuthGate } from '../../src/components/auth-gate';

export default function ForYouScreen() {
  const { colors, gutter, isWide } = useTheme();
  const queryClient = useQueryClient();
  const { requireAccount } = useAuthGate();
  const router = useRouter();

  const feed = useInfiniteQuery({
    queryKey: ['feed', 'foryou'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.feed({ surface: 'foryou', cursor: pageParam, limit: 10 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const like = useMutation({
    mutationFn: (lookId: string) => api.likeLook(lookId),
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to save what you love');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  const save = useMutation({
    mutationFn: (lookId: string) => api.saveLook(lookId),
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to keep your looks');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.kind) {
        case 'look':
          return (
            <View style={{ paddingHorizontal: gutter, paddingBottom: 36 }}>
              <LookCard
                look={item.look}
                onLike={() => like.mutate(item.look.id)}
                onSave={() => save.mutate(item.look.id)}
                onComment={() => router.push({ pathname: '/look/[id]', params: { id: item.look.id } })}
              />
            </View>
          );

        case 'shelf':
          return (
            <View style={{ paddingBottom: 36, gap: 14 }}>
              <View style={{ paddingHorizontal: gutter, gap: 2 }}>
                <Heading>{item.title}</Heading>
                {item.subtitle ? <Caption>{item.subtitle}</Caption> : null}
              </View>
              <FlatList
                horizontal
                style={{ width: '100%', flexGrow: 0 }}
                data={item.products}
                keyExtractor={(product) => product.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}
                renderItem={({ item: product }) => (
                  <View style={{ width: 170 }}>
                    <ProductCard product={product} />
                  </View>
                )}
              />
            </View>
          );

        case 'prompt':
          return (
            <View style={{ paddingHorizontal: gutter, paddingBottom: 36 }}>
              <View
                style={{
                  backgroundColor: colors.primarySoft,
                  borderRadius: 24,
                  padding: 20,
                  gap: 10,
                }}
              >
                <Label tone="primary">Nima</Label>
                <Heading>{item.title}</Heading>
                <Body tone="muted">{item.body}</Body>
                <Button
                  label={item.ctaLabel}
                  full={false}
                  style={{ marginTop: 6 }}
                  onPress={() => {
                    if (item.promptKey === 'questionnaire') router.push('/style');
                    else if (item.promptKey === 'add_photo') router.push('/photos');
                    else router.push('/shop');
                  }}
                />
              </View>
            </View>
          );

        default:
          return (
            <View style={{ paddingHorizontal: gutter, paddingBottom: 36 }}>
              <ProductCard product={item.product} />
            </View>
          );
      }
    },
    [colors.primarySoft, gutter, like, router, save],
  );

  if (feed.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // A feed that quietly shows nothing when the network failed is the most
  // confusing state there is, so say what happened and offer a retry.
  if (feed.isError) {
    return (
      <EmptyState
        art="sparkle"
        message={
          feed.error instanceof ApiError
            ? feed.error.message
            : 'Nima cannot reach the internet right now.'
        }
        action={<Button label="Try again" full={false} onPress={() => void feed.refetch()} />}
      />
    );
  }

  return (
    <FlatList
      data={items}
      style={{ width: '100%' }}
      keyExtractor={(item, index) =>
        item.kind === 'look'
          ? `look-${item.look.id}`
          : item.kind === 'product'
            ? `product-${item.product.id}`
            : `${item.kind}-${index}`
      }
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingTop: 12,
        paddingBottom: 48,
        maxWidth: isWide ? 620 : undefined,
        width: '100%',
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => void feed.refetch()}
          tintColor={colors.primary}
        />
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      ListEmptyComponent={
        <EmptyState
          art="sparkle"
          message="Nothing here yet. Have a look around the shop and Nima will start learning what you like."
          action={<Button label="Open the shop" full={false} onPress={() => router.push('/shop')} />}
        />
      }
      ListFooterComponent={
        feed.isFetchingNextPage ? (
          <View style={{ paddingVertical: 28 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length > 0 ? (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}>
            <Caption>That is everything for now</Caption>
          </View>
        ) : null
      }
    />
  );
}
