/**
 * The basket.
 *
 * Grouped by shop, because that is what it becomes: one order per seller,
 * packed and sent separately. Showing that here rather than at the payment
 * screen means nobody is surprised by two delivery notifications.
 *
 * Every change shows at once and the server catches up. A line that is
 * taken out leaves the list immediately and a capsule offers Undo for a few
 * seconds; only when that passes does the request go. A count that changes
 * changes on the spot. If the server then disagrees, the basket comes back
 * as the server has it and one line says what happened. Nothing here waits
 * on a spinner, and nothing asks "are you sure" except Clear basket, which
 * is the one thing that cannot be undone.
 *
 * Totals arrive with the basket; this file only ever subtracts a line the
 * server already priced, so the number on screen is never one it invented.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { EmptyState } from '../src/components/empty-state';
import { Sheet } from '../src/components/sheet';
import { Body, BodyStrong, Caption, Micro, Price, Title } from '../src/components/text';
import { ApiError, api, type Cart } from '../src/lib/api';
import { usePageTitle } from '../src/lib/page-title';
import { back } from '../src/lib/routes';
import { useTheme } from '../src/theme/index';

type Line = Cart['groups'][number]['items'][number];

/** How long Undo stays on screen before the removal is sent. */
const UNDO_MS = 5000;

/** A basket with one line taken out, totals adjusted by that line's own price. */
function without(cart: Cart, lineId: string): Cart {
  const groups = cart.groups
    .map((group) => {
      const items = group.items.filter((line) => line.id !== lineId);
      const gone = group.items.find((line) => line.id === lineId);
      return {
        ...group,
        items,
        subtotalCents: group.subtotalCents - (gone?.lineTotalCents ?? 0),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    groups,
    subtotalCents: groups.reduce((total, group) => total + group.subtotalCents, 0),
    itemCount: groups.reduce(
      (total, group) => total + group.items.reduce((count, line) => count + line.quantity, 0),
      0,
    ),
    unavailable: cart.unavailable.filter((line) => line.id !== lineId),
  };
}

/** The same basket with one line at a new count. */
function withQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  const groups = cart.groups.map((group) => {
    const items = group.items.map((line) =>
      line.id === lineId
        ? { ...line, quantity, lineTotalCents: line.variant.priceCents * quantity }
        : line,
    );
    return {
      ...group,
      items,
      subtotalCents: items.reduce((total, line) => total + line.lineTotalCents, 0),
    };
  });

  return {
    ...cart,
    groups,
    subtotalCents: groups.reduce((total, group) => total + group.subtotalCents, 0),
    itemCount: groups.reduce(
      (total, group) => total + group.items.reduce((count, line) => count + line.quantity, 0),
      0,
    ),
  };
}

const EMPTY: Cart = { groups: [], subtotalCents: 0, itemCount: 0, unavailable: [] };

export default function CartScreen() {
  usePageTitle('Basket');
  const { colors, gutter, radius, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

  const [problem, setProblem] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  /*
   * A removed line waits here, out of sight, until Undo has had its chance.
   * The capsule shows the last one. Leaving the screen sends whatever is
   * still waiting, so a quick exit never quietly puts things back.
   */
  const [undo, setUndo] = useState<{ line: Line; snapshot: Cart } | null>(null);
  const waiting = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const settle = useCallback(
    (next: Cart) => {
      queryClient.setQueryData(['cart'], next);
      void queryClient.invalidateQueries({ queryKey: ['cart-count'] });
    },
    [queryClient],
  );

  const explain = useCallback((error: unknown, fallback: string) => {
    setProblem(error instanceof ApiError ? error.message : fallback);
  }, []);

  const sendRemoval = useCallback(
    (lineId: string, snapshot: Cart) => {
      waiting.current.delete(lineId);
      api
        .removeFromCart(lineId)
        .then(settle)
        .catch((error: unknown) => {
          // A 404 means it was already gone, which is what we wanted.
          if (error instanceof ApiError && error.status === 404) return;
          queryClient.setQueryData(['cart'], snapshot);
          explain(error, 'It could not be taken out. Check your connection and try again.');
        });
    },
    [settle, queryClient, explain],
  );

  const remove = useCallback(
    (line: Line) => {
      const snapshot = queryClient.getQueryData<Cart>(['cart']);
      if (!snapshot) return;

      setProblem(null);
      queryClient.setQueryData(['cart'], without(snapshot, line.id));
      setUndo({ line, snapshot });

      const timer = setTimeout(() => {
        setUndo((current) => (current?.line.id === line.id ? null : current));
        sendRemoval(line.id, snapshot);
      }, UNDO_MS);
      waiting.current.set(line.id, timer);
    },
    [queryClient, sendRemoval],
  );

  const undoRemove = useCallback(() => {
    if (!undo) return;
    const timer = waiting.current.get(undo.line.id);
    if (timer) clearTimeout(timer);
    waiting.current.delete(undo.line.id);
    queryClient.setQueryData(['cart'], undo.snapshot);
    setUndo(null);
  }, [undo, queryClient]);

  useEffect(
    () => () => {
      // Anything still waiting for Undo when the screen goes is sent now.
      for (const [lineId, timer] of waiting.current) {
        clearTimeout(timer);
        void api.removeFromCart(lineId).catch(() => undefined);
      }
      waiting.current.clear();
    },
    [],
  );

  const setQuantity = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.setCartQuantity(id, quantity),
    onMutate: ({ id, quantity }) => {
      const snapshot = queryClient.getQueryData<Cart>(['cart']);
      if (snapshot) queryClient.setQueryData(['cart'], withQuantity(snapshot, id, quantity));
      setProblem(null);
      return { snapshot };
    },
    onSuccess: settle,
    onError: (error, _variables, context) => {
      if (context?.snapshot) queryClient.setQueryData(['cart'], context.snapshot);
      explain(error, 'That change did not go through. Check your connection and try again.');
    },
  });

  const clear = useMutation({
    mutationFn: () => api.clearCart(),
    onMutate: () => {
      const snapshot = queryClient.getQueryData<Cart>(['cart']);
      for (const timer of waiting.current.values()) clearTimeout(timer);
      waiting.current.clear();
      setUndo(null);
      setProblem(null);
      queryClient.setQueryData(['cart'], EMPTY);
      return { snapshot };
    },
    onSuccess: settle,
    onError: (error, _variables, context) => {
      if (context?.snapshot) queryClient.setQueryData(['cart'], context.snapshot);
      explain(error, 'The basket could not be cleared. Check your connection and try again.');
    },
  });

  const basket = cart.data;
  const empty = !basket || (basket.itemCount === 0 && basket.unavailable.length === 0);

  return (
    <>
      <Stack.Screen options={{ title: 'Basket' }} />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <Header
          count={basket?.itemCount ?? 0}
          loading={cart.isLoading}
          onClose={() => back(router)}
        />

        {cart.isLoading ? (
          <Skeleton />
        ) : cart.isError && !basket ? (
          <View style={{ flex: 1, padding: gutter, gap: 12, justifyContent: 'center' }}>
            <BodyStrong align="center">The basket did not load</BodyStrong>
            <Caption align="center">What you added is still there. Check your connection.</Caption>
            <Button
              label="Try again"
              full={false}
              onPress={() => void cart.refetch()}
              style={{ alignSelf: 'center' }}
            />
          </View>
        ) : empty ? (
          <EmptyState
            art="cart"
            message="Nothing in here yet."
            action={
              <Button label="Open the shop" full={false} onPress={() => router.push('/shop')} />
            }
          />
        ) : (
          <>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                padding: gutter,
                paddingBottom: 28,
                gap: 24,
                maxWidth: isWide ? 760 : undefined,
                width: '100%',
                alignSelf: 'center',
              }}
            >
              {basket.groups.map((group) => (
                <Animated.View key={group.store.id} layout={LinearTransition} style={{ gap: 10 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      paddingHorizontal: 2,
                    }}
                  >
                    <BodyStrong>{group.store.name}</BodyStrong>
                    <Price cents={group.subtotalCents} style={{ fontSize: 14 }} tone="muted" />
                  </View>

                  {group.items.map((line) => (
                    <BasketLine
                      key={line.id}
                      line={line}
                      busy={clear.isPending}
                      onOpen={() =>
                        router.push({ pathname: '/product/[id]', params: { id: line.product.id } })
                      }
                      onQuantity={(quantity) =>
                        quantity === 0
                          ? remove(line)
                          : setQuantity.mutate({ id: line.id, quantity })
                      }
                      onRemove={() => remove(line)}
                    />
                  ))}
                </Animated.View>
              ))}

              {basket.unavailable.length > 0 ? (
                <Animated.View layout={LinearTransition} style={{ gap: 10 }}>
                  <BodyStrong>Sold out while you were deciding</BodyStrong>
                  {basket.unavailable.map((line) => (
                    <View
                      key={line.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        borderRadius: radius.card,
                        backgroundColor: colors.sunk,
                      }}
                    >
                      <Body numberOfLines={1} tone="muted" style={{ flex: 1 }}>
                        {line.product.title}
                      </Body>
                      <QuietAction label="Remove" onPress={() => remove(line)} />
                    </View>
                  ))}
                </Animated.View>
              ) : null}

              {problem ? (
                <Caption tone="critical" align="center">
                  {problem}
                </Caption>
              ) : null}

              <View style={{ alignItems: 'center', marginTop: 4 }}>
                <QuietAction label="Clear basket" onPress={() => setClearing(true)} />
              </View>
            </ScrollView>

            {undo ? (
              <Animated.View
                entering={FadeInDown.duration(180)}
                exiting={FadeOutDown.duration(160)}
                style={{ alignItems: 'center', paddingHorizontal: gutter, marginBottom: 10 }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingLeft: 18,
                    paddingRight: 6,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: colors.ink,
                    maxWidth: '100%',
                  }}
                >
                  <Body numberOfLines={1} style={{ color: colors.ground, flexShrink: 1 }}>
                    {`Removed ${undo.line.product.title}`}
                  </Body>
                  <Pressable
                    onPress={undoRemove}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <BodyStrong style={{ color: colors.ground }}>Undo</BodyStrong>
                  </Pressable>
                </View>
              </Animated.View>
            ) : null}

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingHorizontal: gutter,
                paddingTop: 16,
                paddingBottom: Math.max(insets.bottom, 16) + 8,
                gap: 12,
                width: '100%',
                maxWidth: isWide ? 760 : undefined,
                alignSelf: 'center',
                backgroundColor: colors.ground,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Caption>
                    {`${basket.itemCount} ${basket.itemCount === 1 ? 'piece' : 'pieces'}`}
                  </Caption>
                  <Caption>Delivery is chosen at checkout</Caption>
                </View>
                <Price cents={basket.subtotalCents} style={{ fontSize: 28, lineHeight: 34 }} />
              </View>

              {bootstrap.data?.features.checkout ? (
                <Button
                  label="Checkout"
                  disabled={basket.itemCount === 0}
                  onPress={() => router.push('/checkout')}
                />
              ) : (
                <Button label="Checkout opens soon" disabled onPress={() => undefined} />
              )}

              <Micro align="center">
                Paid by M-Pesa. Nothing is taken until you enter your PIN.
              </Micro>
            </View>
          </>
        )}
      </View>

      <Sheet open={clearing} onClose={() => setClearing(false)} title="Clear the basket?">
        <Caption>
          {`${basket?.itemCount ?? 0} ${basket?.itemCount === 1 ? 'piece comes' : 'pieces come'} out. Pieces you loved stay saved.`}
        </Caption>
        <Button
          label="Clear basket"
          onPress={() => {
            setClearing(false);
            clear.mutate();
          }}
          style={{ marginTop: 8 }}
        />
        <Button label="Keep them" variant="quiet" onPress={() => setClearing(false)} />
      </Sheet>
    </>
  );
}

function Header({
  count,
  loading,
  onClose,
}: {
  count: number;
  loading: boolean;
  onClose: () => void;
}) {
  const { colors, gutter } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: gutter,
        paddingTop: 12,
        paddingBottom: 8,
      }}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        hitSlop={6}
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.sunk,
        }}
      >
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path
            d="m7 7 10 10M17 7 7 17"
            stroke={colors.ink}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>

      <Title style={{ fontSize: 24, lineHeight: 28 }}>Basket</Title>
      {!loading && count > 0 ? (
        <Caption style={{ fontVariant: ['tabular-nums'] }}>{String(count)}</Caption>
      ) : null}
    </View>
  );
}

/** Three line shapes, so the page keeps its shape while the basket loads. */
function Skeleton() {
  const { colors, gutter, radius } = useTheme();
  return (
    <View style={{ padding: gutter, gap: 10 }}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{
            flexDirection: 'row',
            gap: 14,
            padding: 12,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
          }}
        >
          <View style={{ width: 64, height: 84, borderRadius: 12, backgroundColor: colors.sunk }} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <View
              style={{ height: 14, width: '70%', borderRadius: 7, backgroundColor: colors.sunk }}
            />
            <View
              style={{ height: 12, width: '30%', borderRadius: 6, backgroundColor: colors.sunk }}
            />
            <View
              style={{ height: 14, width: '40%', borderRadius: 7, backgroundColor: colors.sunk }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** A small text action with a full size touch area. */
function QuietAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 12,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Micro style={{ color: colors.primary }}>{label}</Micro>
    </Pressable>
  );
}

/**
 * One line of the basket.
 *
 * Swipe it left to reveal Remove, as every list on the phone works, or use
 * the control on the line itself: both end in the same Undo capsule. The
 * card follows the finger; the red behind it is the only time the critical
 * colour appears on this screen.
 */
function BasketLine({
  line,
  busy,
  onOpen,
  onQuantity,
  onRemove,
}: {
  line: Line;
  busy: boolean;
  onOpen: () => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const { colors, radius } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);

  const renderRemove = () => (
    <Pressable
      onPress={() => {
        swipe.current?.close();
        onRemove();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${line.product.title}`}
      style={{
        width: 96,
        marginLeft: 10,
        borderRadius: radius.card,
        backgroundColor: colors.critical,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <BodyStrong style={{ color: colors.ground }}>Remove</BodyStrong>
    </Pressable>
  );

  return (
    <Animated.View layout={LinearTransition} exiting={FadeOutDown.duration(160)}>
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.6}
        rightThreshold={48}
        overshootRight={false}
        renderRightActions={renderRemove}
        onSwipeableOpen={(direction) => {
          if (direction === SwipeDirection.RIGHT) {
            swipe.current?.close();
            onRemove();
          }
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            gap: 14,
            padding: 12,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
          }}
        >
          <Pressable
            onPress={onOpen}
            accessibilityRole="imagebutton"
            accessibilityLabel={line.product.title}
            style={{
              width: 64,
              height: 84,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: colors.sunk,
            }}
          >
            {line.product.image ? (
              <Image
                source={{ uri: line.product.image.url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : null}
          </Pressable>

          <View style={{ flex: 1, gap: 4 }}>
            <Body numberOfLines={2}>{line.product.title}</Body>
            {line.variant.size || line.variant.colour ? (
              <Micro>{[line.variant.size, line.variant.colour].filter(Boolean).join(' · ')}</Micro>
            ) : null}
            <Price cents={line.lineTotalCents} style={{ fontSize: 15 }} />

            {line.variant.stockLeft !== null ? (
              <Caption tone="critical">{`Only ${line.variant.stockLeft} left`}</Caption>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 6,
              }}
            >
              <Stepper
                value={line.quantity}
                max={line.variant.stockLeft ?? 99}
                disabled={busy}
                onChange={onQuantity}
              />
              <QuietAction label="Remove" onPress={onRemove} />
            </View>
          </View>
        </View>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

/**
 * Minus, the number, plus.
 *
 * Going below one removes the line, which is what people expect from a
 * minus button on a quantity of one. The number is set in tabular figures
 * so a 1 becoming a 2 does not nudge the buttons.
 */
function Stepper({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { colors, radius } = useTheme();

  const button = (label: string, to: number, hint: string, off: boolean) => (
    <Pressable
      onPress={() => onChange(to)}
      disabled={disabled || off}
      accessibilityRole="button"
      accessibilityLabel={hint}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.line : colors.sunk,
        opacity: disabled || off ? 0.4 : 1,
      })}
    >
      <BodyStrong>{label}</BodyStrong>
    </Pressable>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 3,
        borderRadius: radius.pill,
        backgroundColor: colors.ground,
      }}
      accessibilityRole="adjustable"
      accessibilityValue={{ now: value, min: 0, max }}
    >
      {button('−', value - 1, 'One fewer', false)}
      <BodyStrong style={{ minWidth: 24, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
        {String(value)}
      </BodyStrong>
      {button('+', value + 1, 'One more', value >= max)}
    </View>
  );
}
