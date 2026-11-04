/**
 * The rail.
 *
 * A shop front opens on its pieces hanging from one long rail, the way a
 * good shop does, rather than on a grid of photographs. Every piece here is
 * a ghost mannequin shot (see the media worker): one wall colour, one
 * wooden hanger, one light, so the rail itself can be drawn in code on top
 * and a seller's phone photo sits next to a studio's without a seam.
 *
 * Tap a piece and it comes forward: bigger, with a swing on its hook, then
 * its sizes and the two things you can do with it. The grid stays below for
 * people who scan.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ApiError, api, type ProductCard, type ProductDetail } from '../lib/api';
import { sized } from '../lib/media';
import { useReducedMotion } from '../lib/motion';
import { slotFor, sortBySize } from '../lib/slots';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Button } from './button';
import { Body, Caption, Micro, Price, Title } from './text';

/** The wall behind every ghost shot. The worker paints the same colour. */
export const RAIL_WALL = '#F4F3F1';
/** The rail itself: warm brushed metal, a shade darker than a beech hanger. */
const BAR = '#B9AB9B';
const BAR_TOP = 18;
const BAR_THICKNESS = 4;

export interface TryOnRequest {
  kind: 'SINGLE_ITEM';
  items: Array<{ slot: string; productId: string; variantId?: string }>;
}

interface RailProps {
  items: ProductCard[];
  storeName: string;
  /** Try-on is off while the image provider is not set up. */
  canTryOn: boolean;
  /** Baskets are hidden until payments are connected. */
  checkout: boolean;
  onTryOn: (request: TryOnRequest) => void;
}

export function Rail({ items, storeName, canTryOn, checkout, onTryOn }: RailProps) {
  const { colors, gutter, isCompact, radius } = useTheme();
  const { width } = useWindowDimensions();
  const [forward, setForward] = useState<ProductCard | null>(null);
  const scroller = useRef<ScrollView>(null);
  const offset = useRef(0);

  const height = isCompact ? 300 : 360;
  const tileWidth = Math.round(height * 0.75);
  const gap = isCompact ? 14 : 20;
  const page = Math.max(tileWidth + gap, width - gutter * 2 - tileWidth);
  const overflows = items.length * (tileWidth + gap) + gutter * 2 > width;

  const slide = (direction: -1 | 1) => {
    scroller.current?.scrollTo({
      x: Math.max(0, offset.current + direction * page),
      animated: true,
    });
  };

  return (
    <View
      style={{
        backgroundColor: RAIL_WALL,
        borderRadius: isCompact ? 0 : radius.image,
        overflow: 'hidden',
      }}
    >
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={tileWidth + gap}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={48}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.x;
        }}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          // The hook's tip sits just under the bar, so the piece hangs on it.
          paddingTop: BAR_TOP + 1,
          paddingBottom: 28,
          gap,
        }}
      >
        {items.map((item) => (
          <Hanging
            key={item.id}
            item={item}
            width={tileWidth}
            height={height}
            onPress={() => setForward(item)}
          />
        ))}
      </ScrollView>

      {/* The bar is in front, so every hook disappears behind it. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: BAR_TOP,
          height: BAR_THICKNESS,
          backgroundColor: BAR,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: BAR_TOP,
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.55)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: BAR_TOP + BAR_THICKNESS,
          height: 1,
          backgroundColor: 'rgba(45,41,38,0.12)',
        }}
      />

      {!isCompact && overflows ? (
        <>
          <Arrow side="left" onPress={() => slide(-1)} color={colors.ink} ground={colors.ground} />
          <Arrow side="right" onPress={() => slide(1)} color={colors.ink} ground={colors.ground} />
        </>
      ) : null}

      <Forward
        item={forward}
        storeName={storeName}
        canTryOn={canTryOn}
        checkout={checkout}
        onTryOn={onTryOn}
        onClose={() => setForward(null)}
      />
    </View>
  );
}

/** One piece on its hook. Press and it sways; let go and it settles. */
function Hanging({
  item,
  width,
  height,
  onPress,
}: {
  item: ProductCard;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const sway = useRef(new Animated.Value(0)).current;
  const still = useReducedMotion();
  const pivot = height / 2;

  const swing = (to: number) => {
    if (still) return;
    Animated.spring(sway, {
      toValue: to,
      useNativeDriver: true,
      friction: to === 0 ? 3.2 : 7,
      tension: to === 0 ? 42 : 90,
    }).start();
  };

  const shillings = Math.round(item.priceFromCents / 100).toLocaleString('en-KE');

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => swing(1)}
      onPressOut={() => swing(0)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, KSh ${shillings}. Pull it forward`}
      style={{ width, height }}
    >
      <Animated.View
        style={{
          width,
          height,
          transform: [
            { translateY: -pivot },
            { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-3.5deg'] }) },
            { translateY: pivot },
          ],
        }}
      >
        {item.image ? (
          <Image
            source={{ uri: sized(item.image.url, 480) }}
            contentFit="cover"
            transition={220}
            style={{ width, height }}
            accessibilityLabel={item.title}
          />
        ) : null}
        <SwingTag text={`KSh ${shillings}`} left={width / 2} />
      </Animated.View>
    </Pressable>
  );
}

/** The price, on a swing tag threaded onto the hook. */
function SwingTag({ text, left }: { text: string; left: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: left + 2 }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1,
          height: 26,
          backgroundColor: 'rgba(45,41,38,0.45)',
          transform: [{ rotate: '-34deg' }],
          transformOrigin: 'top left',
        }}
      />
      <View
        style={{
          marginTop: 20,
          marginLeft: 10,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 3,
          backgroundColor: '#FFFDF8',
          borderWidth: 1,
          borderColor: 'rgba(45,41,38,0.16)',
          transform: [{ rotate: '7deg' }],
          shadowColor: '#2D2926',
          shadowOpacity: 0.08,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            width: 3,
            height: 3,
            borderRadius: 2,
            backgroundColor: 'rgba(45,41,38,0.22)',
          }}
        />
        <Micro style={{ color: '#2D2926', fontVariant: ['tabular-nums'], paddingLeft: 4 }}>
          {text}
        </Micro>
      </View>
    </View>
  );
}

function Arrow({
  side,
  onPress,
  color,
  ground,
}: {
  side: 'left' | 'right';
  onPress: () => void;
  color: string;
  ground: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={side === 'left' ? 'Earlier on the rail' : 'Further along the rail'}
      style={({ pressed }) => ({
        position: 'absolute',
        top: '50%',
        [side]: 14,
        marginTop: -20,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ground,
        opacity: pressed ? 0.7 : 1,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      })}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d={side === 'left' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Pressable>
  );
}

// -------------------------------------------------------------- forward ---

/**
 * A piece pulled forward off the rail.
 *
 * It swings in on its hook and lands big on the wall, with its name, price,
 * sizes and the two things worth doing: see it on yourself, or put it in
 * the basket. The full page is one tap further for the rest.
 */
function Forward({
  item,
  storeName,
  canTryOn,
  checkout,
  onTryOn,
  onClose,
}: {
  item: ProductCard | null;
  storeName: string;
  canTryOn: boolean;
  checkout: boolean;
  onTryOn: (request: TryOnRequest) => void;
  onClose: () => void;
}) {
  const open = item !== null;
  const { colors, radius, isCompact, gutter } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { requireAccount } = useAuthGate();
  const still = useReducedMotion();

  // The last piece stays while the view fades out, so closing never blanks.
  const shown = useRef<ProductCard | null>(null);
  if (item) shown.current = item;
  const piece = shown.current;

  const [variantId, setVariantId] = useState<string | null>(null);
  const [side, setSide] = useState(0);
  const [added, setAdded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['product', piece?.id],
    queryFn: () => api.product(String(piece?.id)),
    enabled: open && Boolean(piece),
  });

  // The swing in. Spring, not a timing curve: it is a thing on a hook.
  const arrive = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) return;
    setVariantId(null);
    setSide(0);
    setAdded(false);
    setProblem(null);
    arrive.setValue(still ? 1 : 0);
    Animated.spring(arrive, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5.2,
      tension: 54,
    }).start();
  }, [open, still, arrive]);

  // Escape closes it on the web, which people expect from a dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    globalThis.addEventListener?.('keydown', handler);
    return () => globalThis.removeEventListener?.('keydown', handler);
  }, [open, onClose]);

  // The browser's Back button closes it rather than leaving the shop. Same
  // dance as the sheet: one history entry while open, popped on close.
  const pushed = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (open && !pushed.current) {
      window.history.pushState({ nimaSheet: true }, '');
      pushed.current = true;
    }

    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!open && pushed.current) {
        pushed.current = false;
        if (window.history.state?.nimaSheet) window.history.back();
      }
    };
  }, [open, onClose]);

  const info: ProductDetail | undefined = detail.data;
  const images = info?.images?.length ? info.images : piece?.image ? [piece.image] : [];
  const image = images[Math.min(side, Math.max(0, images.length - 1))];
  const variants = sortBySize(info?.variants ?? []);
  const chosen =
    variants.find((variant) => variant.id === variantId) ??
    variants.find((variant) => variant.inStock) ??
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

  if (!piece) return null;

  // The wall takes the top of the card on a phone and the left on a desk.
  const imageHeight = isCompact ? Math.min((width - 88) * (4 / 3), height * 0.46) : 480;
  const imageWidth = imageHeight * 0.75;
  const pivot = imageHeight / 2;

  const tryOn = () => {
    onTryOn({
      kind: 'SINGLE_ITEM',
      items: [
        {
          slot: slotFor(piece.category),
          productId: piece.id,
          ...(chosen ? { variantId: chosen.id } : {}),
        },
      ],
    });
    onClose();
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          justifyContent: isCompact ? 'flex-end' : 'center',
          alignItems: isCompact ? 'stretch' : 'center',
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.ground,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderBottomLeftRadius: isCompact ? 0 : radius.sheet,
            borderBottomRightRadius: isCompact ? 0 : radius.sheet,
            overflow: 'hidden',
            width: isCompact ? '100%' : Math.min(920, width - 48),
            maxHeight: height * 0.92,
            flexDirection: isCompact ? 'column' : 'row',
          }}
        >
          <View
            style={{
              backgroundColor: RAIL_WALL,
              alignItems: 'center',
              paddingTop: BAR_TOP + 1,
              paddingBottom: images.length > 1 ? 54 : 22,
              width: isCompact ? '100%' : 460,
            }}
          >
            <Animated.View
              style={{
                opacity: arrive,
                transform: [
                  { translateY: -pivot },
                  {
                    rotate: arrive.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-8deg', '0deg'],
                    }),
                  },
                  { translateY: pivot },
                  { scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
                ],
              }}
            >
              {image ? (
                <Image
                  source={{ uri: sized(image.url, 1080) }}
                  placeholder={piece.image ? { uri: sized(piece.image.url, 480) } : undefined}
                  contentFit="contain"
                  transition={160}
                  style={{ width: imageWidth, height: imageHeight }}
                  accessibilityLabel={piece.title}
                />
              ) : null}
            </Animated.View>

            {/* The bar, so it is still hanging while you look at it. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: BAR_TOP,
                height: BAR_THICKNESS,
                backgroundColor: BAR,
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: BAR_TOP + BAR_THICKNESS,
                height: 1,
                backgroundColor: 'rgba(45,41,38,0.12)',
              }}
            />

            {images.length > 1 ? (
              <View
                style={{
                  position: 'absolute',
                  bottom: 16,
                  flexDirection: 'row',
                  gap: 22,
                }}
              >
                {images.slice(0, 2).map((_, index) => (
                  <Pressable
                    key={index === 0 ? 'front' : 'back'}
                    onPress={() => setSide(index)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: side === index }}
                    hitSlop={8}
                    style={{
                      paddingBottom: 4,
                      borderBottomWidth: 1.5,
                      borderBottomColor: side === index ? '#2D2926' : 'transparent',
                    }}
                  >
                    <Micro style={{ color: side === index ? '#2D2926' : '#6E655E' }}>
                      {index === 0 ? 'Front' : 'Back'}
                    </Micro>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Put it back"
              hitSlop={8}
              style={({ pressed }) => ({
                position: 'absolute',
                top: 12,
                right: 12,
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? '#E8E5E0' : '#FFFFFF',
              })}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24">
                <Path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="#2D2926"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: isCompact ? undefined : 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              padding: isCompact ? gutter : 28,
              paddingTop: isCompact ? 18 : 28,
              paddingBottom: isCompact ? insets.bottom + 20 : 28,
              gap: 14,
            }}
          >
            <View style={{ gap: 4 }}>
              <Micro>{storeName}</Micro>
              <Title style={{ fontSize: 26, lineHeight: 30 }}>{piece.title}</Title>
              <Price
                cents={chosen?.priceCents ?? piece.priceFromCents}
                style={{ fontSize: 18, marginTop: 2 }}
              />
            </View>

            {variants.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variants.map((variant) => {
                  const selected = chosen?.id === variant.id;
                  return (
                    <Pressable
                      key={variant.id}
                      onPress={() => variant.inStock && setVariantId(variant.id)}
                      disabled={!variant.inStock}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: !variant.inStock }}
                      style={{
                        minWidth: 46,
                        height: 38,
                        paddingHorizontal: 13,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: radius.chip,
                        borderWidth: 1,
                        borderColor: selected ? colors.ink : colors.line,
                        backgroundColor: selected ? colors.ink : 'transparent',
                      }}
                    >
                      <Body
                        style={{
                          fontSize: 14,
                          lineHeight: 18,
                          color: selected
                            ? colors.ground
                            : variant.inStock
                              ? colors.ink
                              : colors.muted,
                          textDecorationLine: variant.inStock ? 'none' : 'line-through',
                        }}
                      >
                        {variant.size ?? variant.colour ?? 'One size'}
                      </Body>
                    </Pressable>
                  );
                })}
              </View>
            ) : detail.isLoading ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[0, 1, 2].map((n) => (
                  <View
                    key={n}
                    style={{
                      width: 46,
                      height: 38,
                      borderRadius: radius.chip,
                      backgroundColor: colors.sunk,
                    }}
                  />
                ))}
              </View>
            ) : null}

            {!piece.inStock ? <Caption tone="critical">Sold out</Caption> : null}

            <View style={{ gap: 10, marginTop: 4 }}>
              {canTryOn ? (
                <Button label="See it on me" onPress={tryOn} />
              ) : (
                <Caption align="center">
                  Seeing it on yourself is switched off in this preview. It is back soon.
                </Caption>
              )}
              {checkout ? (
                <Button
                  label={added ? 'In your basket' : 'Add to basket'}
                  variant="quiet"
                  loading={addToCart.isPending}
                  disabled={!chosen?.inStock}
                  onPress={() => addToCart.mutate()}
                />
              ) : null}
              <Button
                label="Everything about it"
                variant="quiet"
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/product/[id]', params: { id: piece.id } });
                }}
              />
            </View>

            {problem ? (
              <Body tone="critical" align="center">
                {problem}
              </Body>
            ) : null}

            {info?.description ? (
              <Body tone="muted" numberOfLines={isCompact ? 3 : 6} style={{ marginTop: 4 }}>
                {info.description}
              </Body>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
