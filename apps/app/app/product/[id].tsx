/**
 * A product.
 *
 * The screen where most try-ons start, so the try-on button is the main
 * action and everything else sits under it. Three honest states: ready,
 * working, and the result.
 *
 * The fit notice is always shown with a result. Nima promises a picture, not
 * a fit, and the brief is firm that this must never be buried.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price, Title } from '../../src/components/text';
import { ApiError, api } from '../../src/lib/api';
import { useServerFrame } from '../../src/lib/realtime';
import { useTheme } from '../../src/theme/index';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const { width } = useWindowDimensions();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [variantId, setVariantId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.product(String(id)),
    enabled: Boolean(id),
  });

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

  const chosen =
    product.data?.variants.find((variant) => variant.id === variantId) ??
    product.data?.variants.find((variant) => variant.inStock) ??
    null;

  const addToCart = useMutation({
    mutationFn: () => {
      if (!chosen) throw new ApiError(400, 'no_variant', 'Pick a size first');
      return api.addToCart({ variantId: chosen.id, quantity: 1 });
    },
    onSuccess: () => {
      setAdded(true);
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to start a basket');
        return;
      }
      setProblem(error instanceof Error ? error.message : 'That did not work');
    },
  });

  // The result arrives on the socket, not from polling.
  useServerFrame('tryon.progress', (frame) => {
    if (frame.jobId === jobId) setProgress(frame.note ?? 'Working on it');
  });

  useServerFrame('tryon.done', (frame) => {
    if (frame.jobId !== jobId) return;
    setResultUrl(frame.imageUrl);
    setProgress(null);
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  });

  useServerFrame('tryon.failed', (frame) => {
    if (frame.jobId !== jobId) return;
    setJobId(null);
    setProgress(null);
    setProblem(frame.reason);
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  });

  const tryOn = useMutation({
    mutationFn: () =>
      api.startTryOn({
        kind: 'SINGLE_ITEM',
        items: [
          {
            slot: slotFor(product.data?.category),
            productId: String(id),
            ...(variantId ? { variantId } : {}),
          },
        ],
      }),
    onSuccess: (response) => {
      setJobId(response.job.id);
      setProgress('Nima is dressing you');
      setProblem(null);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setProblem('Something went wrong. Try again.');
        return;
      }

      if (error.needsAccount) {
        requireAccount('Create an account to try this on yourself');
      } else if (error.needsPhoto) {
        setProblem('Add a photo of yourself first, then try again.');
      } else if (error.needsCredits) {
        setProblem(error.message);
      } else {
        setProblem(error.message);
      }
    },
  });

  if (product.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const item = product.data;
  if (!item) return null;

  const selected = item.variants.find((variant) => variant.id === variantId);
  const price = selected?.priceCents ?? item.priceFromCents;
  const imageHeight = Math.min(width * 1.25, 560);

  return (
    <>
      <Stack.Screen options={{ title: item.title }} />

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
          {/* Photography */}
          <View style={{ flex: isWide ? 1 : undefined }}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ height: imageHeight }}
            >
              {item.images.map((image, index) => (
                <Image
                  key={image.url}
                  source={{ uri: image.url }}
                  contentFit="cover"
                  transition={150}
                  style={{
                    width: isWide ? 520 : width,
                    height: imageHeight,
                    backgroundColor: colors.sunk,
                  }}
                  accessibilityLabel={`${item.title}, photo ${index + 1}`}
                />
              ))}
            </ScrollView>

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

          {/* Everything else */}
          <View style={{ flex: isWide ? 1 : undefined, padding: isWide ? 0 : gutter, gap: 20 }}>
            <View style={{ gap: 6 }}>
              <Micro>{item.store.name}</Micro>
              <Title>{item.title}</Title>
              <Price cents={price} style={{ fontSize: 20 }} />
            </View>

            {item.variants.length > 1 ? (
              <View style={{ gap: 10 }}>
                <BodyStrong>Size</BodyStrong>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {item.variants.map((variant) => {
                    const active = variant.id === variantId;

                    return (
                      <Pressable
                        key={variant.id}
                        disabled={!variant.inStock}
                        onPress={() => setVariantId(variant.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active, disabled: !variant.inStock }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.line,
                          backgroundColor: active ? colors.primary : 'transparent',
                          opacity: variant.inStock ? 1 : 0.4,
                        }}
                      >
                        <Body style={{ color: active ? colors.onPrimary : colors.ink }}>
                          {variant.size ?? variant.colour ?? 'One size'}
                        </Body>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <Button
              label={tryOn.isPending || jobId ? 'Nima is dressing you' : 'See it on me'}
              loading={tryOn.isPending || Boolean(jobId && !resultUrl)}
              onPress={() => tryOn.mutate()}
            />

            {/*
              Buying comes second, under the try-on, because seeing it on
              yourself is what Nima is for and is what makes the decision.
              It is hidden entirely until payments are connected: a basket
              you cannot pay for is worse than no basket.
            */}
            {bootstrap.data?.features.checkout ? (
              <Button
                label={added ? 'In your basket' : 'Add to basket'}
                variant="quiet"
                loading={addToCart.isPending}
                disabled={!chosen?.inStock}
                onPress={() => addToCart.mutate()}
              />
            ) : null}

            {progress ? <Caption align="center">{progress}</Caption> : null}
            {problem ? (
              <Body tone="critical" align="center">
                {problem}
              </Body>
            ) : null}

            {bootstrap.data?.user && !bootstrap.data.user.isAnonymous ? (
              <Caption align="center">
                {`${bootstrap.data.credits.balance} credits left, one per try-on`}
              </Caption>
            ) : null}

            {item.description ? (
              <View style={{ gap: 8 }}>
                <BodyStrong>About this</BodyStrong>
                <Body tone="muted">{item.description}</Body>
              </View>
            ) : null}

            {item.sizeGuide ? (
              <View style={{ gap: 6 }}>
                <BodyStrong>Size guide</BodyStrong>
                {item.sizeGuide.note ? <Caption>{item.sizeGuide.note}</Caption> : null}
              </View>
            ) : null}

            {item.returnPolicy ? (
              <View style={{ gap: 6 }}>
                <BodyStrong>Returns</BodyStrong>
                <Caption>{item.returnPolicy}</Caption>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* The result */}
      <Sheet
        open={Boolean(resultUrl)}
        onClose={() => {
          setResultUrl(null);
          setJobId(null);
        }}
        title="Here you are"
      >
        {resultUrl ? (
          <Image
            source={{ uri: resultUrl }}
            style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.image }}
            contentFit="cover"
            accessibilityLabel={`You wearing ${item.title}`}
          />
        ) : null}

        <View
          style={{
            backgroundColor: colors.secondarySoft,
            borderRadius: radius.image,
            padding: 14,
            gap: 4,
            marginTop: 8,
          }}
        >
          <Eyebrow tone="secondary">{bootstrap.data?.fitNotice.title ?? 'About the fit'}</Eyebrow>
          <Caption tone="ink">
            {bootstrap.data?.fitNotice.body ??
              "Nima shows you how something looks, not how it will fit. Check the seller's size guide."}
          </Caption>
        </View>

        <Button label="Save to my looks" onPress={() => setResultUrl(null)} />
        <Button label="Try something else" variant="quiet" onPress={() => setResultUrl(null)} />
      </Sheet>
    </>
  );
}

/** Which part of the body a category belongs to. */
function slotFor(category: string | undefined): string {
  switch (category) {
    case 'BOTTOM':
      return 'BOTTOM';
    case 'DRESS':
      return 'FULL_BODY';
    case 'OUTERWEAR':
      return 'OUTERWEAR';
    case 'SHOES':
      return 'SHOES';
    case 'BAG':
      return 'BAG';
    case 'JEWELLERY':
      return 'JEWELLERY';
    case 'EYEWEAR':
      return 'EYEWEAR';
    case 'HEADWEAR':
      return 'HEADWEAR';
    default:
      return 'TOP';
  }
}
