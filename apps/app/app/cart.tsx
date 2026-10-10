/**
 * The basket.
 *
 * Grouped by shop, because that is what it becomes: one order per seller,
 * packed and sent separately. Showing that here rather than at the payment
 * screen means nobody is surprised by two delivery notifications.
 *
 * Totals are never computed in this file. They arrive with the basket, so
 * what the screen shows and what the card is charged are the same number.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { EmptyState } from '../src/components/empty-state';
import { Body, BodyStrong, Caption, Micro, Price, Title } from '../src/components/text';
import { api, type Cart } from '../src/lib/api';
import { useTheme } from '../src/theme/index';

export default function CartScreen() {
  const { colors, gutter, radius, isWide } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

  // Every change returns the whole basket, so the screen never has to work
  // out what the new totals should be.
  const settle = (next: Cart) => queryClient.setQueryData(['cart'], next);

  const setQuantity = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.setCartQuantity(id, quantity),
    onSuccess: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeFromCart(id),
    onSuccess: settle,
  });

  const basket = cart.data;
  const busy = setQuantity.isPending || remove.isPending;

  return (
    <>
      <Stack.Screen options={{ title: 'Basket' }} />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
        <Header onClose={() => router.back()} />

        {cart.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !basket || basket.itemCount === 0 ? (
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
                <View key={group.store.id} style={{ gap: 12 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <BodyStrong>{group.store.name}</BodyStrong>
                    <Price cents={group.subtotalCents} style={{ fontSize: 14 }} tone="muted" />
                  </View>

                  {group.items.map((line) => (
                    <View
                      key={line.id}
                      style={{
                        flexDirection: 'row',
                        gap: 14,
                        padding: 12,
                        borderRadius: radius.card,
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/product/[id]',
                            params: { id: line.product.id },
                          })
                        }
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
                            accessibilityLabel={line.product.title}
                          />
                        ) : null}
                      </Pressable>

                      <View style={{ flex: 1, gap: 4 }}>
                        <Body numberOfLines={2}>{line.product.title}</Body>
                        {line.variant.size || line.variant.colour ? (
                          <Micro>
                            {[line.variant.size, line.variant.colour].filter(Boolean).join(' · ')}
                          </Micro>
                        ) : null}
                        <Price cents={line.lineTotalCents} style={{ fontSize: 15 }} />

                        {line.variant.stockLeft !== null ? (
                          <Caption tone="critical">{`Only ${line.variant.stockLeft} left`}</Caption>
                        ) : null}

                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            marginTop: 4,
                          }}
                        >
                          <Stepper
                            value={line.quantity}
                            disabled={busy}
                            onChange={(quantity) =>
                              quantity === 0
                                ? remove.mutate(line.id)
                                : setQuantity.mutate({ id: line.id, quantity })
                            }
                          />

                          <Pressable
                            onPress={() => remove.mutate(line.id)}
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${line.product.title}`}
                            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                          >
                            <Micro tone="muted">Remove</Micro>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ))}

              {basket.unavailable.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <BodyStrong>Sold out while you were deciding</BodyStrong>
                  {basket.unavailable.map((line) => (
                    <View
                      key={line.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: 12,
                        borderRadius: radius.card,
                        backgroundColor: colors.sunk,
                      }}
                    >
                      <Body numberOfLines={1} tone="muted" style={{ flex: 1 }}>
                        {line.product.title}
                      </Body>
                      <Pressable onPress={() => remove.mutate(line.id)} disabled={busy}>
                        <Micro tone="muted">Remove</Micro>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.line,
                padding: gutter,
                paddingBottom: 28,
                gap: 12,
                width: '100%',
                maxWidth: isWide ? 760 : undefined,
                alignSelf: 'center',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Body tone="muted">
                  {`${basket.itemCount} ${basket.itemCount === 1 ? 'piece' : 'pieces'}`}
                </Body>
                <Price cents={basket.subtotalCents} style={{ fontSize: 18 }} />
              </View>

              <Caption>Delivery is worked out on the next screen.</Caption>

              {bootstrap.data?.features.checkout ? (
                <Button label="Checkout" onPress={() => router.push('/checkout')} />
              ) : (
                <Button label="Checkout opens soon" disabled onPress={() => undefined} />
              )}
            </View>
          </>
        )}
      </View>
    </>
  );
}

function Header({ onClose }: { onClose: () => void }) {
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
        style={{
          width: 36,
          height: 36,
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
    </View>
  );
}

/**
 * Minus, the number, plus.
 *
 * Going below one removes the line, which is what people expect from a
 * minus button on a quantity of one, and saves a trip to a separate control.
 */
function Stepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { colors, radius } = useTheme();

  const button = (label: '-' | '+', to: number, hint: string) => (
    <Pressable
      onPress={() => onChange(to)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      style={{
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: colors.sunk,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <BodyStrong>{label}</BodyStrong>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {button('-', value - 1, 'One fewer')}
      <Body style={{ minWidth: 18, textAlign: 'center' }}>{value}</Body>
      {button('+', value + 1, 'One more')}
    </View>
  );
}
