/**
 * Paying.
 *
 * One screen: where it goes, who is collecting it, which number gets the
 * M-Pesa prompt. Then a wait, because that is what paying by M-Pesa is.
 *
 * The waiting state is the part that matters. The prompt opens on the SIM
 * toolkit, the person leaves the app, and the answer arrives on the socket
 * whenever Safaricom gets round to it. So the screen says exactly what is
 * happening, keeps a poll going in case the socket dropped while they were
 * out of the app, and never pretends to know more than it does.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { Body, BodyStrong, Caption, Micro, Price, Title } from '../src/components/text';
import { ApiError, api } from '../src/lib/api';
import { useServerFrame } from '../src/lib/realtime';
import { useTheme } from '../src/theme/index';

type Stage = 'form' | 'waiting' | 'paid' | 'failed';

/** Payments off means nothing to pay with yet, so the basket explains. */
export default function CheckoutGate() {
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  if (bootstrap.data && !bootstrap.data.features.checkout) return <Redirect href="/cart" />;
  return <CheckoutScreen />;
}

function CheckoutScreen() {
  const { colors, gutter, radius, isWide } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [method, setMethod] = useState<'PICKUP_POINT' | 'DOORSTEP'>('PICKUP_POINT');
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const [stage, setStage] = useState<Stage>('form');
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const points = useQuery({ queryKey: ['pickup-points'], queryFn: () => api.pickupPoints() });
  const quote = useQuery({
    queryKey: ['delivery-quote', method],
    queryFn: () => api.deliveryQuote({ method }),
  });

  // Pick the first collection point rather than making someone choose before
  // they know the list. They can change it, and most people use the nearest.
  useEffect(() => {
    if (!pickupPointId && points.data?.items[0]) setPickupPointId(points.data.items[0].id);
  }, [points.data, pickupPointId]);

  useServerFrame('payment.status', (frame) => {
    if (frame.checkoutId !== checkoutId) return;

    if (frame.status === 'SUCCEEDED') {
      setStage('paid');
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    } else if (frame.status === 'FAILED' || frame.status === 'CANCELLED') {
      setStage('failed');
      setMessage(frame.message ?? 'The payment did not go through.');
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
  useEffect(() => {
    if (stage !== 'waiting' || !checkoutId) return;

    const timer = setInterval(() => {
      void api
        .checkout(checkoutId)
        .then((result) => {
          if (result.status === 'SUCCEEDED') {
            setStage('paid');
            void queryClient.invalidateQueries({ queryKey: ['cart'] });
          } else if (result.status === 'FAILED' || result.status === 'CANCELLED') {
            setStage('failed');
            setMessage(result.instruction);
          }
        })
        .catch(() => {
          // A missed poll is not worth telling anyone about. The next one or
          // the socket will carry the answer.
        });
    }, 4000);

    return () => clearInterval(timer);
  }, [stage, checkoutId, queryClient]);

  const start = useMutation({
    mutationFn: () =>
      api.startCheckout({
        deliveryMethod: method,
        pickupPointId: method === 'PICKUP_POINT' ? (pickupPointId ?? undefined) : undefined,
        recipientName: name.trim(),
        recipientPhone: phone.trim(),
        deliveryNote: note.trim() || undefined,
        payerPhone: phone.trim(),
      }),
    onSuccess: (result) => {
      setCheckoutId(result.id);
      setMessage(result.instruction);
      setStage('waiting');
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'That did not work. Try again.');
    },
  });

  const subtotal = cart.data?.subtotalCents ?? 0;
  const delivery = quote.data?.costCents ?? 0;
  const ready = name.trim().length > 1 && phone.trim().length >= 9;

  if (stage !== 'form') {
    return (
      <Outcome
        stage={stage}
        message={message}
        onDone={() => router.replace('/store')}
        onRetry={() => {
          setStage('form');
          setCheckoutId(null);
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
            onPress={() => router.back()}
            accessibilityLabel="Back"
            style={{
              width: 36,
              height: 36,
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

          <Title style={{ fontSize: 24, lineHeight: 28 }}>Checkout</Title>
        </View>

        <ScrollView
          style={{ flex: 1, width: '100%' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 32,
            gap: 26,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <View style={{ gap: 12 }}>
            <BodyStrong>How you want it</BodyStrong>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Choice
                label="Collect it"
                hint="From an agent near you"
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

            {quote.data ? <Caption>{quote.data.estimate}</Caption> : null}
          </View>

          {method === 'PICKUP_POINT' ? (
            <View style={{ gap: 10 }}>
              <BodyStrong>Where from</BodyStrong>

              {(points.data?.items ?? []).map((point) => {
                const selected = point.id === pickupPointId;

                return (
                  <Pressable
                    key={point.id}
                    onPress={() => setPickupPointId(point.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={{
                      padding: 14,
                      borderRadius: radius.card,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.line,
                      backgroundColor: selected ? colors.accentSoft : colors.surface,
                      gap: 2,
                    }}
                  >
                    <Body>{point.name}</Body>
                    <Micro>{`${point.area}, ${point.county}`}</Micro>
                    {point.openingHours ? <Micro>{point.openingHours}</Micro> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={{ gap: 12 }}>
            <BodyStrong>Who is collecting</BodyStrong>

            <Field
              label="Full name"
              value={name}
              onChange={setName}
              placeholder="As on your ID"
              autoComplete="name"
            />
            <Field
              label="Phone"
              value={phone}
              onChange={setPhone}
              placeholder="07xx xxx xxx"
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Caption>The M-Pesa prompt goes to this number.</Caption>

            <Field
              label={method === 'DOORSTEP' ? 'Address and landmark' : 'Anything else'}
              value={note}
              onChange={setNote}
              placeholder={
                method === 'DOORSTEP' ? 'Estate, house or flat, nearest landmark' : 'Optional'
              }
              multiline
            />
          </View>

          <View style={{ gap: 8 }}>
            <Row label="Items" cents={subtotal} />
            <Row label="Delivery" cents={delivery} />
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
            <Row label="To pay" cents={subtotal + delivery} strong />
          </View>

          {message ? (
            <Body tone="critical" align="center">
              {message}
            </Body>
          ) : null}

          <Button
            label="Send the M-Pesa prompt"
            loading={start.isPending}
            disabled={!ready || subtotal === 0}
            onPress={() => start.mutate()}
          />

          <Caption align="center">
            You pay the shop through Nima. Nothing is taken until you enter your PIN.
          </Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {strong ? <BodyStrong>{label}</BodyStrong> : <Body tone="muted">{label}</Body>}
      <Price cents={cents} style={{ fontSize: strong ? 18 : 15 }} />
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
      style={{
        flex: 1,
        padding: 14,
        gap: 2,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
      }}
    >
      <BodyStrong>{label}</BodyStrong>
      <Micro>{hint}</Micro>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'phone-pad';
  autoComplete?: 'name' | 'tel';
}) {
  const { colors, radius } = useTheme();

  return (
    <View style={{ gap: 6 }}>
      <Micro tone="ink">{label}</Micro>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        accessibilityLabel={label}
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.image,
          borderWidth: 1,
          borderColor: colors.line,
          paddingHorizontal: 16,
          paddingVertical: 13,
          minHeight: multiline ? 76 : undefined,
          fontFamily: 'DMSans_400Regular',
          fontSize: 16,
          color: colors.ink,
        }}
      />
    </View>
  );
}

/** Waiting for the PIN, paid, or not paid. One screen, three faces. */
function Outcome({
  stage,
  message,
  onDone,
  onRetry,
}: {
  stage: Stage;
  message: string | null;
  onDone: () => void;
  onRetry: () => void;
}) {
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
      {stage === 'waiting' ? (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Title align="center">Check your phone</Title>
          <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
            {message ?? 'Enter your M-Pesa PIN to finish. This screen updates on its own.'}
          </Body>
        </>
      ) : stage === 'paid' ? (
        <>
          <Title align="center">Paid</Title>
          <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
            The shop is getting your order ready. You will get a message when it is on its way.
          </Body>
          <Button label="See my orders" full={false} onPress={onDone} />
        </>
      ) : (
        <>
          <Title align="center">Not paid</Title>
          <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
            {message ?? 'The payment did not go through. Nothing was taken.'}
          </Body>
          <Button label="Try again" full={false} onPress={onRetry} />
        </>
      )}
    </View>
  );
}
