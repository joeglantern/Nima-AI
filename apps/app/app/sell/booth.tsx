/**
 * Your booth QR.
 *
 * The board a vendor prints and stands on the table. The picture comes from the
 * API, so what is on screen is exactly what prints, and the address inside it
 * follows the server's configuration rather than anything in this build.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { Button } from '../../src/components/button';
import { EmptyState } from '../../src/components/empty-state';
import { ScreenHeader } from '../../src/components/screen-header';
import { Caption } from '../../src/components/text';
import { api, boothBoardUrl } from '../../src/lib/api';
import { sellOrders } from '../../src/lib/routes';
import { useTheme } from '../../src/theme/index';

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

export default function BoothQr() {
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();

  const store = useQuery({ queryKey: ['seller-store'], queryFn: api.sellerStore });
  const slug = store.data?.store?.slug;
  const page = useQuery({
    queryKey: ['booth', slug],
    queryFn: () => api.boothPage(String(slug)),
    enabled: Boolean(slug),
  });

  if (store.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Your booth QR" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!slug) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScreenHeader title="Your booth QR" />
        <EmptyState art="hanger" message="Open a shop first, and its QR shows here." />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Your booth QR' }} />
      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <ScreenHeader title="Your booth QR" />
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 40,
            gap: 14,
            maxWidth: isWide ? 480 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <Image
            source={{ uri: boothBoardUrl(slug) }}
            style={{
              width: '100%',
              aspectRatio: 1748 / 2480,
              borderRadius: radius.image,
              backgroundColor: colors.primary,
            }}
            contentFit="contain"
            accessibilityLabel="Your booth board: shop name, QR code, Scan to pay, Nima Checkout"
          />

          {page.data && LOOPBACK.test(page.data.url) ? (
            <Caption tone="critical">
              This QR points at a local address and will not open on a guest's phone. Set the public
              address before printing.
            </Caption>
          ) : null}

          <Button
            label="Save the print file"
            onPress={() => void Linking.openURL(boothBoardUrl(slug, true))}
          />
          <Caption align="center">A5, ready to print. Keep it flat and well lit.</Caption>
          <Button
            label="See paid sales"
            variant="quiet"
            onPress={() => router.push(sellOrders())}
          />
        </ScrollView>
      </View>
    </>
  );
}
