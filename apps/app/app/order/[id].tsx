/**
 * One order.
 *
 * The receipt and the tracking in one place, because after buying something
 * there is only one question: where is it. Everything shown here is the
 * snapshot taken when the order was placed, so a seller editing a listing
 * cannot rewrite what somebody bought.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from '../../src/components/empty-state';
import { Body, BodyStrong, Caption, Micro, Price, Title } from '../../src/components/text';
import { api } from '../../src/lib/api';
import { useServerFrame } from '../../src/lib/realtime';
import { useTheme } from '../../src/theme/index';

const STEPS: Array<{ key: string; label: string }> = [
  { key: 'PAID', label: 'Paid' },
  { key: 'PREPARING', label: 'Being packed' },
  { key: 'READY_FOR_PICKUP', label: 'Ready to collect' },
  { key: 'DELIVERED', label: 'Collected' },
];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(String(id)),
    enabled: Boolean(id),
  });

  // A shop marking something ready should land here without a refresh.
  useServerFrame('order.updated', (frame) => {
    if (frame.orderId === id) void order.refetch();
  });

  useServerFrame('shipment.updated', (frame) => {
    if (frame.orderId === id) void order.refetch();
  });

  if (order.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const item = order.data;
  if (!item) return <EmptyState art="cart" message="That order is not here." />;

  const reached = STEPS.findIndex((step) => step.key === item.status);
  const cancelled = item.status === 'CANCELLED' || item.status === 'REFUNDED';

  return (
    <>
      <Stack.Screen options={{ title: item.reference }} />

      <ScrollView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: 40,
          gap: 24,
          maxWidth: isWide ? 620 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
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

          <View style={{ flex: 1 }}>
            <Title style={{ fontSize: 24, lineHeight: 28 }}>{item.store.name}</Title>
            <Micro>{`${item.reference} · ${new Date(item.placedAt).toLocaleDateString('en-KE')}`}</Micro>
          </View>
        </View>

        {cancelled ? (
          <View style={{ padding: 16, borderRadius: radius.card, backgroundColor: colors.sunk }}>
            <BodyStrong>{item.status === 'REFUNDED' ? 'Refunded' : 'Cancelled'}</BodyStrong>
            <Caption>Nothing is owed on this order.</Caption>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {STEPS.map((step, index) => {
              const done = reached >= index;

              return (
                <View
                  key={step.key}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: done ? colors.accent : colors.line,
                    }}
                  />
                  <Body tone={done ? 'ink' : 'muted'}>{step.label}</Body>
                </View>
              );
            })}

            {item.shipment?.pickupPointName ? (
              <Caption>{`Collect from ${item.shipment.pickupPointName}`}</Caption>
            ) : null}
            {item.shipment?.trackingCode ? (
              <Caption>{`Tracking ${item.shipment.trackingCode}`}</Caption>
            ) : null}
          </View>
        )}

        <View style={{ gap: 12 }}>
          <BodyStrong>What you bought</BodyStrong>

          {item.items.map((line) => (
            <Pressable
              key={line.id}
              onPress={() =>
                router.push({ pathname: '/product/[id]', params: { id: line.productId } })
              }
              style={{
                flexDirection: 'row',
                gap: 14,
                padding: 12,
                borderRadius: radius.card,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 72,
                  borderRadius: 12,
                  overflow: 'hidden',
                  backgroundColor: colors.sunk,
                }}
              >
                {line.image ? (
                  <Image
                    source={{ uri: line.image.url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    accessibilityLabel={line.title}
                  />
                ) : null}
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Body numberOfLines={2}>{line.title}</Body>
                {line.size || line.colour ? (
                  <Micro>{[line.size, line.colour].filter(Boolean).join(' · ')}</Micro>
                ) : null}
                <Micro>{`${line.quantity} × KSh ${Math.round(line.unitPriceCents / 100).toLocaleString('en-KE')}`}</Micro>
                <Price cents={line.totalCents} style={{ fontSize: 15 }} />
              </View>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Row label="Items" cents={item.subtotalCents} />
          <Row label="Delivery" cents={item.deliveryCents} />
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
          <Row label="Paid" cents={item.totalCents} strong />
        </View>
      </ScrollView>
    </>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {strong ? <BodyStrong>{label}</BodyStrong> : <Body tone="muted">{label}</Body>}
      <Price cents={cents} style={{ fontSize: strong ? 18 : 15 }} />
    </View>
  );
}
