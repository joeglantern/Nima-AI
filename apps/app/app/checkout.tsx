/**
 * Paying.
 *
 * One calm page: what is being bought, where it goes, who collects it,
 * which number gets the M-Pesa prompt, and what happens after the button.
 * The amount is in the button, so the last thing read before paying is the
 * number being paid.
 *
 * The waiting state is the part that matters. The prompt opens on the SIM
 * toolkit, the person leaves the app, and the answer arrives on the socket
 * whenever Safaricom gets round to it. So the screen says which number the
 * prompt went to, keeps a poll going in case the socket dropped while they
 * were out of the app, and never pretends to know more than it does. The
 * money goes to Nima's own Till and the PIN never comes near this app, and
 * the screen says so, because that is what people are deciding about.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { Sheet } from '../src/components/sheet';
import { Body, BodyStrong, Caption, Eyebrow, Micro, Price, Title } from '../src/components/text';
import { ApiError, api, type Cart, type Checkout } from '../src/lib/api';
import { formatPhone, isPhoneComplete, phoneForApi } from '../src/lib/phone';
import { useServerFrame } from '../src/lib/realtime';
import { back } from '../src/lib/routes';
import { useTheme } from '../src/theme/index';

type Stage = 'form' | 'waiting' | 'paid' | 'failed';
type Method = 'PICKUP_POINT' | 'DOORSTEP';

/** After this long without an answer the screen offers help. */
const SLOW_AFTER_MS = 45_000;

/** Payments off means nothing to pay with yet, so the basket explains. */
export default function CheckoutGate() {
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  if (bootstrap.data && !bootstrap.data.features.checkout) return <Redirect href="/cart" />;
  return <CheckoutScreen />;
}

function CheckoutScreen() {
  const { colors, gutter, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [method, setMethod] = useState<Method>('PICKUP_POINT');
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [note, setNote] = useState('');

  const [stage, setStage] = useState<Stage>('form');
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const points = useQuery({ queryKey: ['pickup-points'], queryFn: () => api.pickupPoints() });
  const quote = useQuery({
    queryKey: ['delivery-quote', method, pickupPointId],
    queryFn: () =>
      api.deliveryQuote({
        method,
        pickupPointId: method === 'PICKUP_POINT' ? (pickupPointId ?? undefined) : undefined,
      }),
  });

  // Pick the first collection point rather than making someone choose before
  // they know the list. They can change it, and most people use the nearest.
  useEffect(() => {
    if (!pickupPointId && points.data?.items[0]) setPickupPointId(points.data.items[0].id);
  }, [points.data, pickupPointId]);

  const finish = (next: Checkout) => {
    setCheckout(next);
    if (next.status === 'SUCCEEDED') {
      setStage('paid');
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['cart-count'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    } else if (next.status === 'FAILED' || next.status === 'CANCELLED') {
      setStage('failed');
      setMessage(next.instruction);
    }
  };

  useServerFrame('payment.status', (frame) => {
    if (!checkout || frame.checkoutId !== checkout.id) return;
    if (frame.status === 'SUCCEEDED') {
      // The socket says paid; the poll below fetches the receipt number.
      void api
        .checkout(checkout.id)
        .then(finish)
        .catch(() => finish({ ...checkout, status: 'SUCCEEDED' }));
    } else if (frame.status === 'FAILED' || frame.status === 'CANCELLED') {
      finish({
        ...checkout,
        status: frame.status,
        instruction: frame.message ?? 'The payment did not go through.',
      });
    }
  });

  /*
   * A safety net, not the main channel.
   *
   * The socket is how the answer normally arrives. But the person has just
   * left the app to type a PIN, and on a patchy connection the socket can
   * come back a different one. Asking every four seconds while they wait
   * costs nothing and saves a screen that spins forever.
   */
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const checkoutId = checkout?.id ?? null;

  useEffect(() => {
    if (stage !== 'waiting' || !checkoutId) return;
    const timer = setInterval(() => {
      void api
        .checkout(checkoutId)
        .then((result) => {
          if (result.status !== 'PENDING' && result.status !== 'PROCESSING') {
            finishRef.current(result);
          }
        })
        .catch(() => {
          // A missed poll is not worth telling anyone about. The next one or
          // the socket will carry the answer.
        });
    }, 4000);
    return () => clearInterval(timer);
  }, [stage, checkoutId]);

  const start = useMutation({
    mutationFn: () =>
      api.startCheckout({
        deliveryMethod: method,
        pickupPointId: method === 'PICKUP_POINT' ? (pickupPointId ?? undefined) : undefined,
        recipientName: name.trim(),
        recipientPhone: phoneForApi(phone),
        deliveryNote: note.trim() || undefined,
        payerPhone: phoneForApi(phone),
      }),
    onSuccess: (result) => {
      setCheckout(result);
      setMessage(null);
      setStage('waiting');
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'That did not work. Try again.');
    },
  });

  const subtotal = cart.data?.subtotalCents ?? 0;
  const delivery = quote.data?.costCents ?? 0;
  const total = subtotal + delivery;
  const phoneOk = isPhoneComplete(phone);
  const ready = name.trim().length > 1 && phoneOk && subtotal > 0 && !quote.isLoading;
  const till = bootstrap.data?.payments?.mpesaTill ?? null;
  const chosenPoint = points.data?.items.find((point) => point.id === pickupPointId) ?? null;

  if (stage !== 'form' && checkout) {
    return (
      <Outcome
        stage={stage}
        checkout={checkout}
        phone={phone}
        message={message}
        till={till}
        onDone={() => {
          const first = checkout.orderIds[0];
          if (first) router.replace({ pathname: '/order/[id]', params: { id: first } });
          else router.replace('/store');
        }}
        onRetry={() => {
          setStage('form');
          setCheckout(null);
          setMessage(null);
        }}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />

      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title="Checkout" onBack={() => back(router)} />

        <ScrollView
          style={{ flex: 1, width: '100%' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
            gap: 28,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {cart.data ? <OrderSummary cart={cart.data} /> : null}

          <Section title="Delivery">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Choice
                label="Collect it"
                hint="From a pickup point"
                selected={method === 'PICKUP_POINT'}
                onPress={() => setMethod('PICKUP_POINT')}
              />
              <Choice
                label="Doorstep"
                hint="Brought to your address"
                selected={method === 'DOORSTEP'}
                onPress={() => setMethod('DOORSTEP')}
              />
            </View>

            {method === 'PICKUP_POINT' ? (
              <View style={{ gap: 8 }}>
                {(points.data?.items ?? []).map((point) => (
                  <PointCard
                    key={point.id}
                    name={point.name}
                    place={`${point.area}, ${point.county}`}
                    hours={point.openingHours}
                    costCents={point.costCents}
                    selected={point.id === pickupPointId}
                    onPress={() => setPickupPointId(point.id)}
                  />
                ))}
              </View>
            ) : null}

            {quote.data ? <Caption>{quote.data.estimate}</Caption> : null}
          </Section>

          <Section title="Who is collecting">
            <Field
              label="Full name"
              value={name}
              onChange={setName}
              placeholder="As on your ID"
              autoComplete="name"
            />
            <Field
              label="M-Pesa number"
              value={phone}
              onChange={(value) => setPhone(formatPhone(value))}
              onBlur={() => setPhoneTouched(true)}
              placeholder="+254 7XX XXX XXX"
              keyboardType="phone-pad"
              autoComplete="tel"
              problem={
                phoneTouched && phone.length > 0 && !phoneOk
                  ? 'Enter a Kenyan mobile number, like 0712 345 678'
                  : null
              }
              hint="The prompt goes to this number. The shop uses it to reach you about the order."
            />
            <Field
              label={method === 'DOORSTEP' ? 'Address and landmark' : 'Anything else'}
              value={note}
              onChange={setNote}
              placeholder={
                method === 'DOORSTEP' ? 'Estate, house or flat, nearest landmark' : 'Optional'
              }
              multiline
            />
          </Section>

          <Section title="What happens next">
            <Steps
              steps={[
                `A prompt opens on ${phoneOk ? phone : 'your phone'}`,
                'You enter your M-Pesa PIN',
                chosenPoint && method === 'PICKUP_POINT'
                  ? `Collect at ${chosenPoint.name} when the shop says it is ready`
                  : 'The shop sends it and you get a message',
              ]}
            />
          </Section>

          <View style={{ gap: 8 }}>
            <Row label="Pieces" cents={subtotal} />
            <Row label="Delivery" cents={delivery} pending={quote.isLoading} />
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
            <Row label="To pay" cents={total} strong />
          </View>

          {message ? (
            <Caption tone="critical" align="center">
              {message}
            </Caption>
          ) : null}

          <View style={{ gap: 12 }}>
            <Button
              label={`Pay ${shillings(total)} by M-Pesa`}
              loading={start.isPending}
              disabled={!ready}
              onPress={() => start.mutate()}
            />
            <TrustLine till={till} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function shillings(cents: number): string {
  return `KSh ${Math.round(cents / 100).toLocaleString('en-KE')}`;
}

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
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
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityLabel="Back"
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
      ) : null}
      <Title style={{ fontSize: 24, lineHeight: 28 }}>{title}</Title>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <BodyStrong>{title}</BodyStrong>
      {children}
    </View>
  );
}

/**
 * What is being bought, folded to one line with the first piece's picture.
 * Opening it lists every line; the total stays put either way.
 */
function OrderSummary({ cart }: { cart: Cart }) {
  const { colors, radius } = useTheme();
  const [open, setOpen] = useState(false);

  const lines = cart.groups.flatMap((group) => group.items);
  const first = lines[0];
  const shops = cart.groups.length;
  const others = cart.itemCount - (first?.quantity ?? 0);

  return (
    <Animated.View
      layout={LinearTransition}
      style={{ borderRadius: radius.card, backgroundColor: colors.surface, overflow: 'hidden' }}
    >
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Order summary, ${cart.itemCount} pieces`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 }}
      >
        <View
          style={{
            width: 52,
            height: 64,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: colors.sunk,
          }}
        >
          {first?.product.image ? (
            <Image
              source={{ uri: first.product.image.url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Body numberOfLines={1}>{first?.product.title ?? 'Your basket'}</Body>
          <Caption>
            {others > 0
              ? `and ${others} more, from ${shops} ${shops === 1 ? 'shop' : 'shops'}`
              : `from ${first?.product.store?.name ?? 'the shop'}`}
          </Caption>
        </View>
        <Price cents={cart.subtotalCents} style={{ fontSize: 16 }} />
        <Svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        >
          <Path
            d="m6 9 6 6 6-6"
            stroke={colors.muted}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Pressable>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}
        >
          {lines.map((line) => (
            <View key={line.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Micro
                style={{ fontVariant: ['tabular-nums'], minWidth: 22 }}
              >{`${line.quantity}×`}</Micro>
              <Body numberOfLines={1} style={{ flex: 1 }}>
                {line.product.title}
                {line.variant.size ? <Caption>{`  ${line.variant.size}`}</Caption> : null}
              </Body>
              <Price cents={line.lineTotalCents} style={{ fontSize: 14 }} tone="muted" />
            </View>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Three quiet steps in a row, numbered, nothing to tap. */
function Steps({ steps }: { steps: string[] }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: colors.sunk }}>
      {steps.map((step, index) => (
        <View key={step} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
            }}
          >
            <Micro style={{ fontVariant: ['tabular-nums'], color: colors.ink }}>
              {String(index + 1)}
            </Micro>
          </View>
          <Caption style={{ flex: 1, color: colors.ink }}>{step}</Caption>
        </View>
      ))}
    </View>
  );
}

/** The lock line. Where the money goes and what never leaves the phone. */
function TrustLine({ till }: { till: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Svg width={12} height={12} viewBox="0 0 24 24">
        <Path
          d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
          stroke={colors.muted}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
      <Micro align="center">
        {till
          ? `Paid to Nima's M-Pesa Till ${till}. Nima never sees your PIN.`
          : "Paid to Nima's M-Pesa Till. Nima never sees your PIN."}
      </Micro>
    </View>
  );
}

function Row({
  label,
  cents,
  strong,
  pending,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  pending?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      {strong ? <BodyStrong>{label}</BodyStrong> : <Body tone="muted">{label}</Body>}
      {pending ? (
        <Caption>working it out</Caption>
      ) : (
        <Price cents={cents} style={{ fontSize: strong ? 20 : 15 }} />
      )}
    </View>
  );
}

function Choice({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        padding: 14,
        gap: 2,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.line,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <BodyStrong>{label}</BodyStrong>
      <Micro>{hint}</Micro>
    </Pressable>
  );
}

/** A pickup point: name, where, when, and what it costs, with a radio mark. */
function PointCard({
  name,
  place,
  hours,
  costCents,
  selected,
  onPress,
}: {
  name: string;
  place: string;
  hours: string | null;
  costCents: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: radius.card,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.line,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Circle
          cx={10}
          cy={10}
          r={8.5}
          stroke={selected ? colors.primary : colors.line}
          strokeWidth={1.5}
          fill="none"
        />
        {selected ? <Circle cx={10} cy={10} r={4.5} fill={colors.primary} /> : null}
      </Svg>
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{name}</Body>
        <Micro>{place}</Micro>
        {hours ? <Micro>{hours}</Micro> : null}
      </View>
      {costCents === 0 ? (
        <Caption>Free</Caption>
      ) : (
        <Price cents={costCents} style={{ fontSize: 14 }} tone="muted" />
      )}
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
  problem,
  multiline,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  hint?: string;
  problem?: string | null;
  multiline?: boolean;
  keyboardType?: 'phone-pad';
  autoComplete?: 'name' | 'tel';
}) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Micro tone="ink">{label}</Micro>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        textContentType={
          autoComplete === 'tel' ? 'telephoneNumber' : autoComplete === 'name' ? 'name' : undefined
        }
        accessibilityLabel={label}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.image,
          borderWidth: 1.5,
          borderColor: problem ? colors.critical : focused ? colors.primary : colors.line,
          paddingHorizontal: 16,
          paddingVertical: 13,
          minHeight: multiline ? 76 : undefined,
          fontFamily: 'DMSans_400Regular',
          fontSize: 16,
          color: colors.ink,
          ...(keyboardType === 'phone-pad' ? { fontVariant: ['tabular-nums' as const] } : {}),
        }}
      />
      {problem ? (
        <Caption tone="critical">{problem}</Caption>
      ) : hint ? (
        <Caption>{hint}</Caption>
      ) : null}
    </View>
  );
}

/** Waiting for the PIN, paid, or not paid. One screen, three faces. */
function Outcome({
  stage,
  checkout,
  phone,
  message,
  till,
  onDone,
  onRetry,
}: {
  stage: Stage;
  checkout: Checkout;
  phone: string;
  message: string | null;
  till: string | null;
  onDone: () => void;
  onRetry: () => void;
}) {
  const { colors, gutter, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [seconds, setSeconds] = useState(0);
  const [help, setHelp] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (stage !== 'waiting') return;
    started.current = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [stage]);

  const slow = seconds * 1000 >= SLOW_AFTER_MS;

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <View
        style={{
          flex: 1,
          padding: gutter,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
          justifyContent: 'center',
          gap: 24,
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {stage === 'waiting' ? (
          <>
            <Pulse />
            <View style={{ gap: 8 }}>
              <Eyebrow>Prompt sent</Eyebrow>
              <Title>Check your phone</Title>
              <Body tone="muted">
                {`The M-Pesa prompt went to ${phone || 'your number'}. Enter your PIN there and this page updates on its own.`}
              </Body>
            </View>

            <View
              style={{
                gap: 6,
                padding: 14,
                borderRadius: radius.card,
                backgroundColor: colors.sunk,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Caption style={{ color: colors.ink }}>To pay</Caption>
                <Price cents={checkout.totalCents} style={{ fontSize: 15 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Caption style={{ color: colors.ink }}>Waiting</Caption>
                <Caption style={{ fontVariant: ['tabular-nums'], color: colors.ink }}>
                  {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
                </Caption>
              </View>
            </View>

            {slow ? (
              <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center' }}>
                <Pressable
                  onPress={() => setHelp(true)}
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}
                >
                  <Micro style={{ color: colors.primary }}>Did not get the prompt?</Micro>
                </Pressable>
              </Animated.View>
            ) : (
              <Micro align="center">
                Usually under a minute. The prompt expires on its own if it is left.
              </Micro>
            )}

            <TrustLine till={till} />

            <Sheet open={help} onClose={() => setHelp(false)} title="No prompt yet?">
              <Body>{`It was sent to ${phone || 'your number'}. A few things that help:`}</Body>
              <Steps
                steps={[
                  'Unlock the phone and pull down the notifications; the prompt hides there on some phones',
                  'Dial *334# on Safaricom and choose My Account, then pay the pending request',
                  'If it has expired, the page will say so in a moment and you can pay again from here with the same or another number',
                ]}
              />
              <Button label="Got it" onPress={() => setHelp(false)} style={{ marginTop: 8 }} />
            </Sheet>
          </>
        ) : stage === 'paid' ? (
          <>
            <Tick />
            <View style={{ gap: 8 }}>
              <Eyebrow>Paid</Eyebrow>
              <Title>{`${shillings(checkout.totalCents)} received`}</Title>
              <Body tone="muted">
                The shop is getting your order ready. You will get a message when it is ready to
                collect.
              </Body>
            </View>
            {checkout.receipt ? (
              <View
                style={{
                  gap: 2,
                  padding: 14,
                  borderRadius: radius.card,
                  backgroundColor: colors.sunk,
                }}
              >
                <Caption style={{ color: colors.ink }}>M-Pesa receipt</Caption>
                <BodyStrong style={{ fontVariant: ['tabular-nums'] }}>
                  {checkout.receipt}
                </BodyStrong>
              </View>
            ) : null}
            <Button label="Done" onPress={onDone} />
          </>
        ) : (
          <>
            <View style={{ gap: 8 }}>
              <Eyebrow tone="critical">Not paid</Eyebrow>
              <Title>Nothing was taken</Title>
              <Body tone="muted">{message ?? 'The payment did not go through.'}</Body>
            </View>
            <Button label="Try again" onPress={onRetry} />
            <Micro align="center">Your details are kept, so it is one tap.</Micro>
          </>
        )}
      </View>
    </View>
  );
}

/** A soft pulse, instead of a spinner, while the phone does the work. */
function Pulse() {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Circle cx={28} cy={28} r={26} stroke={colors.primarySoft} strokeWidth={4} fill="none" />
        <Path
          d="M18 28a10 10 0 0 1 10-10m10 10a10 10 0 0 1-10 10"
          stroke={colors.primary}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

/** The drawn tick for paid. */
function Tick() {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Circle cx={28} cy={28} r={26} fill={colors.positiveSoft} />
        <Path
          d="m18 29 7 7 13-15"
          stroke={colors.positive}
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
