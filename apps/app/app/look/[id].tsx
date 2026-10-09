/**
 * A look.
 *
 * The whole outfit, every piece in it, what it would cost to buy, and the
 * two things you can do with it: wear it yourself, or make it yours and
 * change a piece.
 */

import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { api, ApiError } from '../../src/lib/api';
import { useTheme } from '../../src/theme/index';
import { Body, BodyStrong, Caption, Label, Price, Title } from '../../src/components/text';
import { Button } from '../../src/components/button';
import { useAuthGate } from '../../src/components/auth-gate';

export default function LookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const { width } = useWindowDimensions();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const look = useQuery({
    queryKey: ['look', id],
    queryFn: () => api.look(String(id)),
    enabled: Boolean(id),
  });

  const recreate = useMutation({
    mutationFn: () => api.startTryOn({ kind: 'RECREATE', lookId: String(id) }),
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to wear this yourself');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
  });

  const share = useMutation({
    mutationFn: async () => {
      const link = await api.shareLink(String(id));

      if (Platform.OS === 'web') {
        const navigatorWithShare = globalThis.navigator as Navigator & {
          share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
        };

        if (navigatorWithShare?.share) {
          await navigatorWithShare.share({ title: 'Nima', text: link.message, url: link.url });
        } else {
          await globalThis.navigator?.clipboard?.writeText(link.url);
        }
        return;
      }

      await Share.share({ message: link.message, url: link.url });
    },
  });

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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
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
                source={{ uri: item.image.url }}
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
              onPress={() => router.back()}
              accessibilityLabel="Back"
              style={{
                position: 'absolute',
                top: 16,
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
              {item.author ? <Label>{item.author.displayName}</Label> : null}
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
                <Label tone="primary">Nima says</Label>
                <Body>{item.nimaSays}</Body>
              </View>
            ) : null}

            {item.canRecreate ? (
              <Button
                label="See this on me"
                loading={recreate.isPending}
                onPress={() => recreate.mutate()}
              />
            ) : null}

            {/*
              Sharing uses whatever the person already uses, which here is
              almost always WhatsApp, rather than a Nima only inbox. The
              message comes from the server so the wording stays in one place.
            */}
            <Button
              label="Share this look"
              variant="quiet"
              loading={share.isPending}
              onPress={() => share.mutate()}
            />

            <View style={{ gap: 12 }}>
              <BodyStrong>{`In this look (${item.items.length})`}</BodyStrong>

              {item.items.map((piece) => {
                const product = piece.product;

                return (
                  <Pressable
                    key={piece.id}
                    disabled={!product}
                    onPress={() => product && router.push({ pathname: '/product/[id]', params: { id: product.id } })}
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
          </View>
        </View>
      </ScrollView>
    </>
  );
}
