/**
 * The booth receipt.
 *
 * Proof of purchase, held up to a vendor across a table. So the answer comes
 * first and large, and the reference is big enough to match against the
 * vendor's own screen. "Paid" only ever shows for an order the webhook marked
 * paid. The time since paying keeps moving, so an old screenshot looks old.
 */

import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../../../src/components/button';
import { EmptyState } from '../../../src/components/empty-state';
import { Body, BodyStrong, Caption, Price, Title } from '../../../src/components/text';
import { api } from '../../../src/lib/api';
import { useServerFrame } from '../../../src/lib/realtime';
import { timeAgo } from '../../../src/lib/time';
import { useTheme } from '../../../src/theme/index';

function paidTime(iso: string): string {
  const when = new Date(iso);
  const day = when.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = when.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

export default function BoothReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(String(id)),
    enabled: Boolean(id),
  });

  // The vendor marking it handed over should show here without a refresh.
  useServerFrame('order.updated', (frame) => {
    if (frame.orderId === id) void order.refetch();
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (order.isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.ground,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const item = order.data;
  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <EmptyState art="cart" message="That receipt is not here." />
      </View>
    );
  }

  const handedOver = item.status === 'DELIVERED' || item.status === 'COMPLETED';
  const isPaid = Boolean(item.paidAt) && (item.status === 'PAID' || handedOver);
  const reversed = item.status === 'CANCELLED' || item.status === 'REFUNDED';

  const heading = isPaid
    ? 'Paid'
    : item.status === 'REFUNDED'
      ? 'Refunded'
      : reversed
        ? 'Cancelled'
        : 'Not paid yet';

  return (
    <>
      <Stack.Screen options={{ title: `Receipt ${item.reference}` }} />
      <ScrollView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        contentContainerStyle={{
          padding: gutter,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 32,
          gap: 24,
          maxWidth: isWide ? 560 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ alignItems: 'center', gap: 10 }}>
          {isPaid ? (
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
              }}
            >
              <Svg width={38} height={38} viewBox="0 0 24 24">
                <Path
                  d="m5 12.5 4.5 4.5L19 7.5"
                  stroke={colors.onPrimary}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </View>
          ) : null}
          <Title align="center" style={{ fontSize: 44, lineHeight: 50 }}>
            {heading}
          </Title>
          <Price cents={item.totalCents} style={{ fontSize: 30, lineHeight: 36 }} />
          <BodyStrong align="center">{item.store.name}</BodyStrong>
        </View>

        <View
          style={{
            padding: 18,
            gap: 4,
            alignItems: 'center',
            borderRadius: radius.card,
            backgroundColor: colors.sunk,
          }}
        >
          <Caption>Reference</Caption>
          <BodyStrong
            selectable
            style={{ fontSize: 28, lineHeight: 34, letterSpacing: 1.5, color: colors.primary }}
          >
            {item.reference}
          </BodyStrong>
          {item.paidAt ? (
            <>
              <Body align="center">{paidTime(item.paidAt)}</Body>
              <Caption align="center">{timeAgo(item.paidAt, 'long')}</Caption>
            </>
          ) : null}
        </View>

        <View style={{ gap: 12 }}>
          {item.items.map((line) => (
            <View
              key={line.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Body numberOfLines={2}>
                  {line.quantity > 1 ? `${line.quantity} x ${line.title}` : line.title}
                </Body>
                {line.size || line.colour ? (
                  <Caption>{[line.size, line.colour].filter(Boolean).join(', ')}</Caption>
                ) : null}
              </View>
              <Price cents={line.totalCents} style={{ fontSize: 16 }} />
            </View>
          ))}
        </View>

        <Body tone="muted" align="center">
          {handedOver
            ? 'Handed over. Enjoy it.'
            : isPaid
              ? 'Show this to the vendor to collect.'
              : reversed
                ? 'Do not hand this over.'
                : 'Do not hand this over until it says paid.'}
        </Body>

        <Button
          label={`Back to ${item.store.name}`}
          variant="quiet"
          onPress={() =>
            router.replace({ pathname: '/booth/[slug]', params: { slug: item.store.slug } })
          }
        />
      </ScrollView>
    </>
  );
}
