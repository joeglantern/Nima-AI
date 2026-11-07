/**
 * A look.
 *
 * The whole outfit, every piece in it, what it would cost to buy, and the
 * two things you can do with it: wear it yourself, or make it yours and
 * change a piece.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { CommentsSheet } from '../../src/components/feed-sheets';
import { ReportSheet } from '../../src/components/report-sheet';
import { SendSheet } from '../../src/components/send-sheet';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price, Title } from '../../src/components/text';
import {
  SOON,
  TryOnResultSheet,
  TryOnSoonSheet,
  useTryOn,
  useTryOnAvailable,
} from '../../src/components/try-on';
import { api } from '../../src/lib/api';
import { sized } from '../../src/lib/media';
import { PageTitle } from '../../src/lib/page-title';
import { back } from '../../src/lib/routes';
import { useSignedIn } from '../../src/lib/social';
import { useTheme } from '../../src/theme/index';

export default function LookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();

  const look = useQuery({
    queryKey: ['look', id],
    queryFn: () => api.look(String(id)),
    enabled: Boolean(id),
  });

  const tryOn = useTryOn('Create an account to wear this yourself');
  const canTryOn = useTryOnAvailable();
  const [soon, setSoon] = useState(false);

  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const signedIn = useSignedIn();
  const { requireAccount } = useAuthGate();

  if (look.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const item = look.data;
  if (!item) return null;

  const imageHeight = Math.min(width * 1.25, 600);

  return (
    <>
      <Stack.Screen options={{ title: item.title ?? 'A look' }} />
      <PageTitle title={item.title ?? 'A look'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: isWide ? 1080 : undefined,
            alignSelf: 'center',
            flexDirection: isWide ? 'row' : 'column',
            gap: isWide ? 32 : 0,
            padding: isWide ? 24 : 0,
          }}
        >
          <View style={{ flex: isWide ? 1 : undefined }}>
            {item.image ? (
              <Image
                source={{ uri: sized(item.image.url, 1080) }}
                contentFit="cover"
                transition={150}
                style={{
                  width: isWide ? '100%' : width,
                  height: imageHeight,
                  backgroundColor: colors.sunk,
                  borderRadius: isWide ? radius.image : 0,
                }}
                accessibilityLabel={item.title ?? 'A look on Nima'}
              />
            ) : null}

            <Pressable
              onPress={() => back(router)}
              accessibilityLabel="Back"
              style={{
                position: 'absolute',
                top: insets.top + 16,
                left: 16,
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.ground,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24">
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
          </View>

          <View style={{ flex: isWide ? 1 : undefined, padding: isWide ? 0 : gutter, gap: 20 }}>
            <View style={{ gap: 6 }}>
              {item.author ? <Micro>{item.author.displayName}</Micro> : null}
              {item.title ? <Title>{item.title}</Title> : null}
              {item.caption ? <Body tone="muted">{item.caption}</Body> : null}
            </View>

            {item.nimaSays ? (
              <View
                style={{
                  backgroundColor: colors.primarySoft,
                  borderRadius: radius.image,
                  padding: 16,
                  gap: 4,
                }}
              >
                <Eyebrow>Nima Says</Eyebrow>
                <Body>{item.nimaSays}</Body>
              </View>
            ) : null}

            {item.canRecreate ? (
              <Button
                label={tryOn.busy ? 'Nima is dressing you' : 'See this on me'}
                loading={tryOn.busy}
                variant={canTryOn ? 'primary' : 'quiet'}
                tag={canTryOn ? undefined : SOON}
                onPress={() =>
                  canTryOn ? tryOn.start({ kind: 'RECREATE', lookId: item.id }) : setSoon(true)
                }
              />
            ) : null}
            {tryOn.progress ? <Caption align="center">{tryOn.progress}</Caption> : null}
            {tryOn.problem ? (
              <Body tone="critical" align="center">
                {tryOn.problem}
              </Body>
            ) : null}

            {/* The conversation under a look lives here now that the feed row is for wearing it. */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Ask about it" variant="quiet" onPress={() => setAsking(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Send to a friend" variant="quiet" onPress={() => setSending(true)} />
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <BodyStrong>{`In this look (${item.items.length})`}</BodyStrong>

              {item.items.map((piece) => {
                const product = piece.product;

                return (
                  <Pressable
                    key={piece.id}
                    disabled={!product}
                    onPress={() =>
                      product &&
                      router.push({ pathname: '/product/[id]', params: { id: product.id } })
                    }
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      padding: 10,
                      borderRadius: radius.image,
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
                      {(product?.image ?? piece.wardrobeItem?.image) ? (
                        <Image
                          source={{
                            uri: (product?.image ?? piece.wardrobeItem?.image)?.url ?? '',
                          }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                        />
                      ) : null}
                    </View>

                    <View style={{ flex: 1, gap: 2 }}>
                      <Body numberOfLines={1}>
                        {product?.title ?? piece.wardrobeItem?.label ?? 'From a wardrobe'}
                      </Body>
                      {product ? (
                        <>
                          <Price cents={product.priceFromCents} style={{ fontSize: 14 }} />
                          <Caption numberOfLines={1}>{product.store.name}</Caption>
                        </>
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
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <Caption>Everything in this look</Caption>
                <Price cents={item.shopTotalCents} style={{ fontSize: 18 }} />
              </View>
            ) : null}

            {/* Quiet and last, where the stores put it: a report is a last resort, not a feature. */}
            {item.author ? (
              <Pressable
                onPress={() =>
                  signedIn
                    ? setReporting(true)
                    : requireAccount('Create an account to report a look')
                }
                accessibilityRole="button"
                hitSlop={8}
                style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}
              >
                <Caption>Report this look</Caption>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <TryOnSoonSheet open={soon} onClose={() => setSoon(false)} />
      <TryOnResultSheet tryOn={tryOn} label={item.title ?? 'this look'} />
      <ReportSheet
        target={reporting ? { kind: 'look', id: item.id } : null}
        onClose={() => setReporting(false)}
      />
      <CommentsSheet lookId={asking ? item.id : null} onClose={() => setAsking(false)} />
      <SendSheet
        target={sending ? { kind: 'LOOK', id: item.id } : null}
        onClose={() => setSending(false)}
      />
    </>
  );
}
