/**
 * Your shop, from behind the counter.
 *
 * The numbers that matter at a glance, then two lists: what is on the rail
 * and what needs packing. Orders waiting on you come first and say what to
 * do next in a button, so nobody has to know what "PAID" implies.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { Button } from '../../src/components/button';
import { EmptyState } from '../../src/components/empty-state';
import { Avatar } from '../../src/components/feed-post';
import { ScreenHeader } from '../../src/components/screen-header';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Micro, Price, Title } from '../../src/components/text';
import {
  api,
  type SellerDashboard,
  type SellerOrder,
  type SellerProductRow,
  type SellerStore,
} from '../../src/lib/api';
import { useServerFrame } from '../../src/lib/realtime';
import { timeAgo } from '../../src/lib/time';
import { useTheme } from '../../src/theme/index';

type Tab = 'pieces' | 'orders';

export default function SellerHome() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { colors, gutter, floatingClearance, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(params.tab === 'orders' ? 'orders' : 'pieces');

  const store = useQuery({ queryKey: ['seller-store'], queryFn: api.sellerStore });
  const dashboard = useQuery({
    queryKey: ['seller-dashboard'],
    queryFn: () => api.sellerDashboard('30d'),
    enabled: Boolean(store.data?.store),
  });
  const products = useQuery({
    queryKey: ['seller-products'],
    queryFn: () => api.sellerProducts(),
    enabled: Boolean(store.data?.store),
  });
  const orders = useInfiniteQuery({
    queryKey: ['seller-orders'],
    queryFn: ({ pageParam }) => api.sellerOrders({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(store.data?.store),
  });

  // A new order lands as a notification. Refresh the counter when one does.
  useServerFrame('notification.new', (frame) => {
    if (frame.kind !== 'ORDER_PLACED') return;
    void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['seller-store'] });
  });

  if (store.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Your shop" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  const shop = store.data?.store;
  if (!shop) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Your shop" />
        <EmptyState
          art="hanger"
          message="You have not opened a shop yet."
          action={
            <Button
              label="Open a shop"
              full={false}
              onPress={() => router.replace('/sell/setup')}
            />
          }
        />
      </View>
    );
  }

  const orderItems = orders.data?.pages.flatMap((page) => page.items) ?? [];
  const waiting = orderItems.filter((o) => o.actions.length > 0);
  const done = orderItems.filter((o) => o.actions.length === 0);
  const pieceItems = products.data?.items ?? [];

  const header = (
    <View style={{ gap: 18, paddingBottom: 12 }}>
      <ShopHeader shop={shop} />
      <Stats shop={shop} />
      {dashboard.data ? <Funnel dashboard={dashboard.data} /> : null}
      <Tabs
        tab={tab}
        onChange={setTab}
        openOrders={shop.stats.openOrders}
        pieces={shop.stats.activeProducts + shop.stats.draftProducts}
      />
      {tab === 'pieces' ? (
        <Button
          label="Add a piece"
          onPress={() => router.push({ pathname: '/sell/product/[id]', params: { id: 'new' } })}
        />
      ) : waiting.length ? (
        <BodyStrong>{`Waiting on you (${waiting.length})`}</BodyStrong>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: shop.name }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title="Your shop" />
        {tab === 'pieces' ? (
          <FlatList
            data={pieceItems}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={header}
            renderItem={({ item }) => <PieceRow item={item} />}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 760 : undefined,
              width: '100%',
              alignSelf: 'center',
            }}
            refreshing={products.isRefetching}
            onRefresh={() => {
              void products.refetch();
              void store.refetch();
              void dashboard.refetch();
            }}
            ListEmptyComponent={
              products.isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
              ) : (
                <EmptyState
                  art="hanger"
                  message="Nothing on the rail yet. Add your first piece and it shows up in Shop."
                />
              )
            }
          />
        ) : (
          <FlatList
            data={[...waiting, ...done]}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={header}
            renderItem={({ item, index }) => (
              <View>
                {index === waiting.length && done.length ? (
                  <BodyStrong style={{ marginTop: waiting.length ? 14 : 0, marginBottom: 10 }}>
                    Earlier
                  </BodyStrong>
                ) : null}
                <OrderRow order={item} />
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingBottom: floatingClearance,
              maxWidth: isWide ? 760 : undefined,
              width: '100%',
              alignSelf: 'center',
            }}
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
            onEndReached={() => {
              if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
            }}
            ListEmptyComponent={
              orders.isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
              ) : (
                <EmptyState
                  art="parcel"
                  message="No orders yet. When someone buys, it lands here and on your phone."
                />
              )
            }
          />
        )}
      </View>
    </>
  );
}

function ShopHeader({ shop }: { shop: SellerStore }) {
  const { colors, radius } = useTheme();
  const router = useRouter();

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar url={shop.logo?.url} name={shop.name} size={60} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Title numberOfLines={2} style={{ fontSize: 26, lineHeight: 30 }}>
            {shop.name}
          </Title>
          <Caption numberOfLines={1}>
            {[shop.county, shop.verified ? 'Verified' : null].filter(Boolean).join(' · ') ||
              'Your shop on Nima'}
          </Caption>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          {
            label: 'See it as a customer',
            onPress: () => router.push({ pathname: '/s/[slug]', params: { slug: shop.slug } }),
          },
          { label: 'Edit details', onPress: () => router.push('/sell/setup') },
        ].map((b) => (
          <Pressable
            key={b.label}
            onPress={b.onPress}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.sunk : 'transparent',
            })}
          >
            <BodyStrong style={{ fontSize: 14 }}>{b.label}</BodyStrong>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Stats({ shop }: { shop: SellerStore }) {
  const { colors, radius } = useTheme();

  const tiles = [
    {
      label: 'Sold, last 30 days',
      value: <Price cents={shop.stats.sales30dCents} style={{ fontSize: 24, lineHeight: 30 }} />,
    },
    { label: 'To pack', value: shop.stats.openOrders, highlight: shop.stats.openOrders > 0 },
    { label: 'In the shop', value: shop.stats.activeProducts },
    { label: 'Followers', value: shop.stats.followers },
  ];

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {tiles.map((tile) => (
          <View
            key={tile.label}
            style={{
              flexBasis: '47%',
              flexGrow: 1,
              padding: 14,
              gap: 4,
              borderRadius: radius.card,
              backgroundColor: tile.highlight ? colors.accentSoft : colors.surface,
            }}
          >
            {typeof tile.value === 'number' ? (
              <BodyStrong style={{ fontSize: 24, lineHeight: 30 }}>
                {tile.value.toLocaleString('en-KE')}
              </BodyStrong>
            ) : (
              tile.value
            )}
            <Micro>{tile.label}</Micro>
          </View>
        ))}
      </View>
      {shop.stats.pendingCents > 0 || shop.stats.availableCents > 0 ? (
        <Caption>
          {`On its way to you: KSh ${Math.round(shop.stats.pendingCents / 100).toLocaleString('en-KE')}. Money is released after the buyer collects and the return window closes.`}
        </Caption>
      ) : null}
    </View>
  );
}

/** View, try-on, basket, bought: the shape of the shop's month. */
function Funnel({ dashboard }: { dashboard: SellerDashboard }) {
  const { colors, radius } = useTheme();
  const top = Math.max(1, ...dashboard.funnel.map((s) => s.count));
  if (dashboard.funnel.every((s) => s.count === 0)) return null;

  return (
    <View
      style={{ gap: 10, padding: 16, borderRadius: radius.card, backgroundColor: colors.surface }}
    >
      <BodyStrong>The last 30 days</BodyStrong>
      {dashboard.funnel.map((step) => (
        <View key={step.step} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Caption tone="ink">{step.step}</Caption>
            <Caption tone="ink">{step.count.toLocaleString('en-KE')}</Caption>
          </View>
          <View
            style={{ height: 8, borderRadius: 4, backgroundColor: colors.sunk, overflow: 'hidden' }}
          >
            <View
              style={{
                width: `${Math.max(step.count ? 3 : 0, (step.count / top) * 100)}%`,
                height: '100%',
                borderRadius: 4,
                backgroundColor: colors.accent,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function Tabs({
  tab,
  onChange,
  openOrders,
  pieces,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  openOrders: number;
  pieces: number;
}) {
  const { colors, radius } = useTheme();
  const items: Array<{ key: Tab; label: string }> = [
    { key: 'pieces', label: `Pieces (${pieces})` },
    { key: 'orders', label: openOrders ? `Orders (${openOrders} new)` : 'Orders' },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        padding: 4,
        borderRadius: radius.pill,
        backgroundColor: colors.surface,
      }}
      accessibilityRole="tablist"
    >
      {items.map((item) => {
        const on = tab === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 10,
              borderRadius: radius.pill,
              backgroundColor: on ? colors.accent : 'transparent',
            }}
          >
            <BodyStrong style={{ fontSize: 14, color: on ? colors.onAccent : colors.ink }}>
              {item.label}
            </BodyStrong>
          </Pressable>
        );
      })}
    </View>
  );
}

const STATUS_WORDS: Record<string, string> = {
  ACTIVE: 'In the shop',
  DRAFT: 'Draft',
  OUT_OF_STOCK: 'Sold out',
  ARCHIVED: 'Archived',
};

function PieceRow({ item }: { item: SellerProductRow }) {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () => api.setProductStatus(item.id, item.status === 'DRAFT' ? 'ACTIVE' : 'DRAFT'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-products'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-store'] });
    },
  });

  const live = item.status === 'ACTIVE';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/sell/product/[id]', params: { id: item.id } })}
      accessibilityLabel={`${item.title}, ${STATUS_WORDS[item.status]}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 10,
        borderRadius: radius.card,
        backgroundColor: pressed ? colors.sunk : colors.surface,
      })}
    >
      <View
        style={{
          width: 60,
          height: 74,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: colors.sunk,
        }}
      >
        {item.image ? (
          <Image
            source={{ uri: item.image.url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <BodyStrong numberOfLines={1} style={{ fontSize: 15 }}>
          {item.title}
        </BodyStrong>
        <Price cents={item.priceFromCents} style={{ fontSize: 14, color: colors.primary }} />
        <Caption numberOfLines={1} style={{ fontSize: 12 }}>
          {`${item.stock} left · ${item.views30d} ${item.views30d === 1 ? 'view' : 'views'} this month`}
        </Caption>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: live ? colors.accentSoft : colors.sunk,
          }}
        >
          <Micro tone={live ? 'ink' : 'muted'}>{STATUS_WORDS[item.status] ?? item.status}</Micro>
        </View>
        {item.status === 'ACTIVE' || item.status === 'DRAFT' ? (
          <Pressable
            onPress={() => toggle.mutate()}
            accessibilityRole="button"
            hitSlop={8}
            disabled={toggle.isPending}
          >
            <Caption tone="primary">{toggle.isPending ? '...' : live ? 'Hide' : 'Publish'}</Caption>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const ORDER_WORDS: Record<string, string> = {
  PAID: 'New, paid',
  PREPARING: 'Packing',
  READY_FOR_PICKUP: 'Handed to courier',
  IN_TRANSIT: 'On its way',
  DELIVERED: 'Collected',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

function OrderRow({ order }: { order: SellerOrder }) {
  const { colors, radius } = useTheme();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (action: 'accept' | 'mark_ready' | 'cancel') =>
      api.sellerOrderAction(
        order.id,
        action,
        action === 'cancel' ? 'The shop could not fill this order' : undefined,
      ),
    onSuccess: () => {
      setCancelling(false);
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-store'] });
    },
    onError: (error) =>
      setProblem(error instanceof Error ? error.message : 'That did not go through'),
  });

  const waiting = order.actions.length > 0;
  const next = order.actions.find((a) => a !== 'cancel');
  const pieces = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <View
      style={{
        padding: 14,
        gap: 12,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        borderWidth: waiting ? 1 : 0,
        borderColor: colors.accent,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BodyStrong numberOfLines={1}>{order.buyer.displayName}</BodyStrong>
          <Caption numberOfLines={1} style={{ fontSize: 12 }}>
            {`${order.reference} · ${timeAgo(order.placedAt, 'long')}`}
          </Caption>
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: waiting ? colors.accentSoft : colors.sunk,
          }}
        >
          <Micro tone={waiting ? 'ink' : 'muted'}>
            {ORDER_WORDS[order.status] ?? order.status}
          </Micro>
        </View>
      </View>

      {order.items.map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 44,
              height: 54,
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: colors.sunk,
            }}
          >
            {item.image ? (
              <Image
                source={{ uri: item.image.url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Body numberOfLines={1} style={{ fontSize: 14 }}>
              {item.title}
            </Body>
            <Caption style={{ fontSize: 12 }}>
              {[
                item.size ? `Size ${item.size}` : null,
                item.quantity > 1 ? `x${item.quantity}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'One piece'}
            </Caption>
          </View>
          <Price cents={item.totalCents} style={{ fontSize: 14 }} />
        </View>
      ))}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Caption>{`${pieces} ${pieces === 1 ? 'piece' : 'pieces'}${order.shipment?.pickupPointName ? ` · to ${order.shipment.pickupPointName}` : ''}`}</Caption>
        <Price cents={order.subtotalCents} style={{ fontSize: 15 }} />
      </View>

      {problem ? <Caption tone="critical">{problem}</Caption> : null}

      {next ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={
                next === 'accept' ? 'Accept and start packing' : 'Packed, ready for the courier'
              }
              loading={act.isPending && act.variables !== 'cancel'}
              onPress={() => act.mutate(next)}
            />
          </View>
        </View>
      ) : null}
      {order.actions.includes('cancel') ? (
        <Pressable
          onPress={() => setCancelling(true)}
          accessibilityRole="button"
          style={{ alignSelf: 'center' }}
        >
          <Caption tone="muted">I cannot fill this order</Caption>
        </Pressable>
      ) : null}

      <Sheet open={cancelling} onClose={() => setCancelling(false)} title="Cancel this order?">
        <Body tone="muted">
          {`${order.buyer.displayName} gets their money back in full and the stock goes back on your rail. Cancelling often can affect how your shop shows up.`}
        </Body>
        <Button
          label="Cancel the order"
          loading={act.isPending}
          onPress={() => act.mutate('cancel')}
        />
        <Button label="Keep it" variant="quiet" onPress={() => setCancelling(false)} />
      </Sheet>
    </View>
  );
}
