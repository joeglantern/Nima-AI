/**
 * A shop front.
 *
 * Who they are, where they are, and everything they have on the rail.
 * Following a shop puts its new pieces in your feed. The owner sees the
 * same page their customers do, with a way back to the counter.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { ProductCard } from '../../src/components/cards';
import { EmptyState } from '../../src/components/empty-state';
import { Avatar } from '../../src/components/feed-post';
import { ScreenHeader } from '../../src/components/screen-header';
import { Body, Caption, Title } from '../../src/components/text';
import { ApiError, api } from '../../src/lib/api';
import { SELL_HOME } from '../../src/lib/routes';
import { useSignedIn } from '../../src/lib/social';
import { useTheme } from '../../src/theme/index';

export default function ShopFront() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors, gutter, gridColumns, floatingClearance, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const { requireAccount } = useAuthGate();

  const front = useQuery({
    queryKey: ['store-front', slug],
    queryFn: () => api.storeFront(String(slug)),
    enabled: Boolean(slug),
    retry: false,
  });
  const mine = useQuery({
    queryKey: ['seller-store'],
    queryFn: api.sellerStore,
    enabled: signedIn,
  });
  const store = front.data?.store;
  const isMine = Boolean(store && mine.data?.store?.id === store.id);

  const pieces = useInfiniteQuery({
    queryKey: ['store-products', store?.id],
    queryFn: ({ pageParam }) =>
      api.products({
        storeId: store?.id,
        cursor: pageParam ?? undefined,
        limit: 24,
        sort: 'newest',
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(store?.id),
  });

  const [following, setFollowing] = useState(false);
  useEffect(() => setFollowing(Boolean(store?.isFollowing)), [store?.isFollowing]);

  const follow = useMutation({
    mutationFn: (next: boolean) => api.followStore(String(slug), next),
    onMutate: (next) => setFollowing(next),
    onError: (_error, next) => setFollowing(!next),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['store-front', slug] }),
  });

  const columns = Math.min(gridColumns, 4);
  const items = pieces.data?.pages.flatMap((page) => page.items) ?? [];

  if (front.isError) {
    const gone = front.error instanceof ApiError && front.error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Shop" />
        <EmptyState
          art="hanger"
          message={gone ? 'There is no shop at that address.' : 'That shop could not be loaded.'}
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: store?.name ?? 'Shop' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title={store?.name ?? ''} />
        <FlatList
          data={items}
          key={columns}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: floatingClearance,
            gap: 16,
            maxWidth: isWide ? 1080 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (pieces.hasNextPage && !pieces.isFetchingNextPage) void pieces.fetchNextPage();
          }}
          renderItem={({ item }) => (
            <View style={{ flex: 1 / columns }}>
              <ProductCard product={item} />
            </View>
          )}
          ListHeaderComponent={
            store ? (
              <View style={{ alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 12 }}>
                <Avatar url={store.logo?.url} name={store.name} size={92} />
                <Title align="center" style={{ marginTop: 8 }}>
                  {store.name}
                </Title>
                <Caption align="center">
                  {[
                    store.verified ? 'Verified seller' : null,
                    store.county,
                    `${store.productCount} ${store.productCount === 1 ? 'piece' : 'pieces'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Caption>
                {store.about ? (
                  <Body align="center" style={{ marginTop: 6, maxWidth: 480 }}>
                    {store.about}
                  </Body>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 12,
                    width: '100%',
                    maxWidth: 420,
                  }}
                >
                  {isMine ? (
                    <View style={{ flex: 1 }}>
                      <Button label="Manage your shop" onPress={() => router.push(SELL_HOME)} />
                    </View>
                  ) : (
                    <View style={{ flex: 1 }}>
                      <Button
                        label={following ? 'Following' : 'Follow'}
                        variant={following ? 'quiet' : 'primary'}
                        onPress={() =>
                          signedIn
                            ? follow.mutate(!following)
                            : requireAccount(`Create an account to follow ${store.name}`)
                        }
                      />
                    </View>
                  )}
                </View>

                {store.returnPolicy ? (
                  <Caption align="center" style={{ marginTop: 10, maxWidth: 480 }}>
                    {`Returns: ${store.returnPolicy}`}
                  </Caption>
                ) : null}
              </View>
            ) : (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            )
          }
          ListEmptyComponent={
            store && !pieces.isLoading ? (
              <EmptyState
                art="hanger"
                message={
                  isMine
                    ? 'Add your first piece and it shows here.'
                    : 'Nothing on the rail right now.'
                }
              />
            ) : null
          }
          ListFooterComponent={
            pieces.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
            ) : null
          }
        />
      </View>
    </>
  );
}
