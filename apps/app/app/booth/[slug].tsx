/**
 * Buying at a booth.
 *
 * Someone has just pointed a phone at a QR in a loud room, often in a browser
 * that has never seen Nima. So: the shop's pieces, tap one, pick a size, pay.
 * One thing to do on each screen, and no account until they decide to pay.
 *
 * The basket and any payment in progress are kept on the device. Paying sends
 * people out to the M-Pesa prompt, and a cheap phone will often throw this tab
 * away while they type a PIN. Coming back must land on the same wait, not on an
 * empty page that invites them to pay again.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthGate } from '../../src/components/auth-gate';
import { Button } from '../../src/components/button';
import { EmptyState } from '../../src/components/empty-state';
import { BackButton } from '../../src/components/screen-header';
import { Sheet } from '../../src/components/sheet';
import { Body, BodyStrong, Caption, Price, Title } from '../../src/components/text';
import { ApiError, api, type BoothItem, type Checkout } from '../../src/lib/api';
import { useServerFrame } from '../../src/lib/realtime';
import { boothReceipt } from '../../src/lib/routes';
import { sessionStorage } from '../../src/lib/session-storage';
import { useSignedIn } from '../../src/lib/social';
import { useTheme } from '../../src/theme/index';

type Stage = 'shop' | 'basket' | 'waiting' | 'failed';

/** After this long without an answer, stop implying it is about to arrive. */
const SLOW_AFTER_MS = 90_000;

interface Saved {
  /** Variant id to how many. */
  basket: Record<string, number>;
  /** One per basket, so a double tap or a retry cannot charge twice. */
  key: string;
  checkout: { id: string; orderId: string } | null;
}

function newKey(): string {
  const part = () => Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}${part()}${part()}`.slice(0, 40);
}

function ksh(cents: number): string {
  return `KSh ${Math.round(cents / 100).toLocaleString('en-KE')}`;
}

/** Stored as 2547..., which is not how anyone in Kenya writes their number. */
function localPhone(phone: string): string {
  return phone.startsWith('254') ? `0${phone.slice(3)}` : phone;
}

function variantLabel(variant: { size: string | null; colour: string | null }): string {
  return [variant.size, variant.colour].filter(Boolean).join(', ') || 'One size';
}

export default function BoothScreen() {
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string }>();
  const slug = String(rawSlug);
  const { colors, gutter, isWide } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const { requireAccount } = useAuthGate();

  const [stage, setStage] = useState<Stage>('shop');
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [attemptKey, setAttemptKey] = useState(newKey);
  const [checkout, setCheckout] = useState<{ id: string; orderId: string } | null>(null);
  const [picking, setPicking] = useState<BoothItem | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneEdited, setPhoneEdited] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [restored, setRestored] = useState(false);

  const page = useQuery({
    queryKey: ['booth', slug],
    queryFn: () => api.boothPage(slug),
    enabled: Boolean(rawSlug),
    retry: false,
  });

  const storageKey = `nima.booth.${slug.replace(/[^a-zA-Z0-9-]/g, '')}`;

  // Pick up where this phone left off.
  useEffect(() => {
    let stale = false;

    void sessionStorage.getItemAsync(storageKey).then((raw) => {
      if (stale) return;

      if (raw) {
        try {
          const saved = JSON.parse(raw) as Saved;
          setBasket(saved.basket ?? {});
          if (saved.key) setAttemptKey(saved.key);
          if (saved.checkout) {
            setCheckout(saved.checkout);
            setStage('waiting');
          }
        } catch {
          // Unreadable means nothing was saved worth keeping.
        }
      }
      setRestored(true);
    });

    return () => {
      stale = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    const saved: Saved = { basket, key: attemptKey, checkout };
    void sessionStorage.setItemAsync(storageKey, JSON.stringify(saved));
  }, [restored, basket, attemptKey, checkout, storageKey]);

  // Prefill once, and never over something they have typed.
  const knownPhone = page.data?.payerPhone;
  useEffect(() => {
    if (knownPhone && !phoneEdited) setPhone(localPhone(knownPhone));
  }, [knownPhone, phoneEdited]);

  const variants = useMemo(() => {
    const out = new Map<string, { item: BoothItem; variant: BoothItem['variants'][number] }>();
    for (const item of page.data?.items ?? []) {
      for (const variant of item.variants) out.set(variant.id, { item, variant });
    }
    return out;
  }, [page.data]);

  // Only what this shop still sells. Prices always come from the page, never storage.
  const lines = Object.entries(basket).flatMap(([variantId, quantity]) => {
    const found = variants.get(variantId);
    return found && quantity > 0 ? [{ ...found, quantity }] : [];
  });
  const totalCents = lines.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  const change = (variantId: string, by: number) => {
    setMessage(null);
    // A different basket is a different purchase, so it gets its own key.
    setAttemptKey(newKey());
    setBasket((current) => {
      const next = { ...current };
      const quantity = (next[variantId] ?? 0) + by;
      if (quantity > 0) next[variantId] = quantity;
      else delete next[variantId];
      return next;
    });
  };

  const paid = (orderId: string) => {
    void sessionStorage.deleteItemAsync(storageKey);
    router.replace(boothReceipt(orderId));
  };

  const notPaid = (reason: string) => {
    setMessage(reason);
    setCheckout(null);
    // This key is spent. The next try is a new payment.
    setAttemptKey(newKey());
    setStage('failed');
  };

  const apply = (result: Checkout, orderId: string) => {
    if (result.status === 'SUCCEEDED') paid(orderId);
    else if (result.status === 'FAILED' || result.status === 'CANCELLED') {
      notPaid(result.instruction);
    }
  };

  const start = useMutation({
    mutationFn: () =>
      api.startBoothCheckout(slug, {
        items: lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
        payerPhone: phone.trim(),
        idempotencyKey: attemptKey,
      }),
    onSuccess: (result) => {
      const orderId = result.orderIds[0];
      if (!orderId) return;
      setMessage(null);
      setCheckout({ id: result.id, orderId });
      setStage('waiting');
      apply(result, orderId);
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'That did not work. Try again.');
      void page.refetch();
    },
  });

  useServerFrame('payment.status', (frame) => {
    if (!checkout || frame.checkoutId !== checkout.id) return;

    if (frame.status === 'SUCCEEDED') paid(checkout.orderId);
    else if (frame.status === 'FAILED' || frame.status === 'CANCELLED') {
      notPaid(frame.message ?? 'The payment did not go through.');
    }
  });

  const applyRef = useRef(apply);
  applyRef.current = apply;

  // A safety net for the socket, which is often gone by the time they are back
  // from the PIN prompt. Asks at once too, for a tab that has just come back.
  const checkoutId = checkout?.id;
  const checkoutOrderId = checkout?.orderId;
  useEffect(() => {
    if (stage !== 'waiting' || !checkoutId || !checkoutOrderId) return;

    const ask = () => {
      void api
        .checkout(checkoutId)
        .then((result) => applyRef.current(result, checkoutOrderId))
        .catch(() => {
          // The next one, or the socket, will carry the answer.
        });
    };

    ask();
    const timer = setInterval(ask, 4000);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    return () => {
      clearInterval(timer);
      clearTimeout(slowTimer);
    };
  }, [stage, checkoutId, checkoutOrderId]);

  const store = page.data?.store;
  const open = page.data?.paymentsOpen ?? false;
  const title = store?.name ?? 'Nima Checkout';
  const screenTitle = <Stack.Screen options={{ title }} />;

  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.status === 404;
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <Stack.Screen options={{ title }} />
        <EmptyState
          art="hanger"
          message={gone ? 'There is no shop at that address.' : 'That shop could not be loaded.'}
          action={
            gone ? undefined : (
              <Button label="Try again" full={false} onPress={() => void page.refetch()} />
            )
          }
        />
      </View>
    );
  }

  if (!restored || page.isLoading || !page.data || !store) {
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

  if (stage === 'waiting') {
    return (
      <Centre>
        {screenTitle}
        <ActivityIndicator size="large" color={colors.primary} />
        <Title align="center">Check your phone</Title>
        <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
          {slow
            ? 'Still waiting on M-Pesa. Do not pay again yet. If the money left your phone, this screen will catch up.'
            : `Enter your M-Pesa PIN to pay ${store.name}. This screen updates on its own.`}
        </Body>
        {slow ? (
          <Button
            label="Back to the basket"
            variant="quiet"
            full={false}
            onPress={() => setStage('basket')}
          />
        ) : null}
      </Centre>
    );
  }

  if (stage === 'failed') {
    return (
      <Centre>
        {screenTitle}
        <Title align="center">Not paid</Title>
        <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
          {message ?? 'The payment did not go through. Nothing was taken.'}
        </Body>
        <Button
          label="Try again"
          full={false}
          onPress={() => {
            setMessage(null);
            setStage('basket');
          }}
        />
      </Centre>
    );
  }

  if (stage === 'basket' && open) {
    const ready = phone.replace(/\D/g, '').length >= 9 && lines.length > 0;

    return (
      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {screenTitle}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: gutter,
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 32,
            gap: 22,
            maxWidth: isWide ? 560 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <BackButton onPress={() => setStage('shop')} />
            <Title numberOfLines={1} style={{ flex: 1, fontSize: 26, lineHeight: 32 }}>
              {store.name}
            </Title>
          </View>

          {lines.length === 0 ? (
            <Body tone="muted">Your basket is empty.</Body>
          ) : (
            <View style={{ gap: 14 }}>
              {lines.map((line) => (
                <View
                  key={line.variant.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <BodyStrong numberOfLines={2}>{line.item.title}</BodyStrong>
                    <Caption>{`${variantLabel(line.variant)} · ${ksh(line.variant.priceCents)}`}</Caption>
                  </View>
                  <Stepper
                    title={line.item.title}
                    quantity={line.quantity}
                    onLess={() => change(line.variant.id, -1)}
                    onMore={() => change(line.variant.id, 1)}
                  />
                </View>
              ))}
            </View>
          )}

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
            <BodyStrong>To pay</BodyStrong>
            <Price cents={totalCents} style={{ fontSize: 24, lineHeight: 30 }} />
          </View>

          <View style={{ gap: 8 }}>
            <BodyStrong>M-Pesa number</BodyStrong>
            <TextInput
              value={phone}
              onChangeText={(next) => {
                setPhoneEdited(true);
                setPhone(next);
              }}
              placeholder="07xx xxx xxx"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoComplete="tel"
              accessibilityLabel="M-Pesa number"
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.line,
                paddingHorizontal: 18,
                paddingVertical: 16,
                fontFamily: 'DMSans_600SemiBold',
                fontSize: 20,
                color: colors.ink,
              }}
            />
          </View>

          {message ? <Body tone="critical">{message}</Body> : null}

          <Button
            label={signedIn ? `Pay ${ksh(totalCents)}` : `Continue to pay ${ksh(totalCents)}`}
            loading={start.isPending}
            disabled={!ready}
            onPress={() => {
              if (signedIn) start.mutate();
              else requireAccount(`Create an account to pay ${store.name}`);
            }}
          />

          <Caption align="center">Nothing is taken until you enter your PIN.</Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
      {screenTitle}
      <FlatList
        data={page.data.items}
        keyExtractor={(item) => item.id}
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: insets.top + 20,
          paddingBottom: 130 + insets.bottom,
          gap: 14,
          maxWidth: isWide ? 560 : undefined,
          width: '100%',
          alignSelf: 'center',
        }}
        ListHeaderComponent={
          <View style={{ gap: 4, paddingBottom: 6 }}>
            <Title>{store.name}</Title>
            {open ? (
              <Caption>Tap what you want.</Caption>
            ) : (
              <Body tone="muted">
                Payments are not open yet. You can still look through the pieces.
              </Body>
            )}
          </View>
        }
        ListEmptyComponent={<EmptyState art="hanger" message="Nothing on the rail right now." />}
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            canBuy={open}
            onPress={() => {
              const only = item.variants.length === 1 ? item.variants[0] : null;
              if (only) change(only.id, 1);
              else setPicking(item);
            }}
          />
        )}
      />

      {open && count > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            paddingHorizontal: gutter,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            backgroundColor: colors.ground,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <View style={{ width: '100%', maxWidth: isWide ? 560 : undefined }}>
            <Button
              label={`Basket, ${count} ${count === 1 ? 'piece' : 'pieces'}, ${ksh(totalCents)}`}
              onPress={() => setStage('basket')}
            />
          </View>
        </View>
      ) : null}

      <Sheet open={picking !== null} onClose={() => setPicking(null)} title={picking?.title}>
        <BodyStrong style={{ marginBottom: 10 }}>Choose a size</BodyStrong>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {(picking?.variants ?? []).map((variant) => (
            <SizeButton
              key={variant.id}
              label={variantLabel(variant)}
              price={ksh(variant.priceCents)}
              available={variant.inStock}
              onPress={() => {
                change(variant.id, 1);
                setPicking(null);
              }}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  const { colors, gutter } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        backgroundColor: colors.ground,
        alignItems: 'center',
        justifyContent: 'center',
        padding: gutter,
        gap: 20,
      }}
    >
      {children}
    </View>
  );
}

function ItemRow({
  item,
  canBuy,
  onPress,
}: {
  item: BoothItem;
  canBuy: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  const tappable = canBuy && item.inStock;

  const content = (
    <>
      <View
        style={{
          width: 92,
          height: 116,
          borderRadius: radius.image,
          overflow: 'hidden',
          backgroundColor: colors.sunk,
        }}
      >
        {item.image ? (
          <Image
            source={{ uri: item.image.url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={item.title}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <BodyStrong numberOfLines={2}>{item.title}</BodyStrong>
        <Price cents={item.priceFromCents} style={{ fontSize: 18, color: colors.primary }} />
        {item.inStock ? null : <Caption>Sold out</Caption>}
      </View>
    </>
  );

  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    opacity: item.inStock ? 1 : 0.5,
  };

  // Not a button when it cannot do anything, so nothing looks tappable and fails.
  if (!tappable) return <View style={row}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, add to basket`}
      style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

function SizeButton({
  label,
  price,
  available,
  onPress,
}: {
  label: string;
  price: string;
  available: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!available}
      accessibilityRole="button"
      accessibilityLabel={available ? `${label}, ${price}` : `${label}, sold out`}
      accessibilityState={{ disabled: !available }}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '45%',
        minHeight: 68,
        paddingHorizontal: 14,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.image,
        borderWidth: 1,
        borderColor: colors.line,
        opacity: available ? 1 : 0.45,
        backgroundColor: pressed ? colors.accentSoft : colors.surface,
      })}
    >
      <BodyStrong align="center">{label}</BodyStrong>
      <Caption align="center">{available ? price : 'Sold out'}</Caption>
    </Pressable>
  );
}

function Stepper({
  title,
  quantity,
  onLess,
  onMore,
}: {
  title: string;
  quantity: number;
  onLess: () => void;
  onMore: () => void;
}) {
  const { colors } = useTheme();

  const step = (symbol: string, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 46,
        height: 46,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.line : colors.sunk,
      })}
    >
      <BodyStrong style={{ fontSize: 22, lineHeight: 26 }}>{symbol}</BodyStrong>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {step('-', quantity === 1 ? `Take ${title} out` : `One less ${title}`, onLess)}
      <BodyStrong style={{ minWidth: 20, textAlign: 'center' }}>{quantity}</BodyStrong>
      {step('+', `One more ${title}`, onMore)}
    </View>
  );
}
