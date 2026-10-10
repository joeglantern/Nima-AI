/**
 * Ask Nima.
 *
 * A conversation, not a search box. The reply arrives word by word over the
 * WebSocket, and when Nima looks something up it says so, because a silent
 * pause reads as broken.
 *
 * Products that come back are real rows from the shop, tappable, with real
 * prices. Nothing here is invented by the model.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { useAuthGate } from '../src/components/auth-gate';
import { ProductCard } from '../src/components/cards';
import { Body, Caption, Eyebrow, Title } from '../src/components/text';
import { ApiError, api, type ProductCard as ProductCardData } from '../src/lib/api';
import { useServerFrame } from '../src/lib/realtime';
import { useTheme } from '../src/theme/index';

interface Turn {
  id: string;
  role: 'you' | 'nima';
  text: string;
  products: ProductCardData[];
  /** What Nima is doing right now, for example looking through the shop. */
  note?: string | null;
  streaming?: boolean;
}

export default function AskScreen() {
  const params = useLocalSearchParams<{ productId?: string; occasion?: string }>();
  const { colors, gutter, radius, isWide } = useTheme();
  const { requireAccount } = useAuthGate();
  const router = useRouter();
  const scroller = useRef<ScrollView>(null);

  const [threadId, setThreadId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);

  const prompts = useQuery({ queryKey: ['stylist-prompts'], queryFn: api.stylistPrompts });

  // Words arrive one frame at a time and append to the open reply.
  useServerFrame('stylist.delta', (frame) => {
    if (threadId && frame.threadId !== threadId) return;

    setTurns((current) => {
      const last = current.at(-1);
      if (last?.role !== 'nima' || !last.streaming) return current;

      return [...current.slice(0, -1), { ...last, text: last.text + frame.text, note: null }];
    });
  });

  useServerFrame('stylist.tool', (frame) => {
    if (threadId && frame.threadId !== threadId) return;

    setTurns((current) => {
      const last = current.at(-1);
      if (last?.role !== 'nima') return current;
      return [...current.slice(0, -1), { ...last, note: frame.note }];
    });
  });

  useServerFrame('stylist.done', (frame) => {
    if (threadId && frame.threadId !== threadId) return;

    // The saved turn carries the products, so the thread is re-read once.
    void api
      .stylistThread(frame.threadId)
      .then((thread) => {
        setTurns(
          thread.messages
            .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
            .map((message) => ({
              id: message.id,
              role: message.role === 'USER' ? ('you' as const) : ('nima' as const),
              text: message.content,
              products: message.products,
            })),
        );
      })
      .catch(() => {
        setTurns((current) => {
          const last = current.at(-1);
          if (!last) return current;
          return [...current.slice(0, -1), { ...last, streaming: false, note: null }];
        });
      });
  });

  const ask = useMutation({
    mutationFn: (message: string) =>
      api.askNima({
        message,
        threadId,
        context: {
          ...(params.productId ? { productId: String(params.productId) } : {}),
          ...(params.occasion ? { occasion: String(params.occasion) } : {}),
        },
      }),
    onSuccess: (response) => setThreadId(response.threadId),
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to talk to Nima');
      }
      setTurns((current) => current.slice(0, -1));
    },
  });

  function send(message: string) {
    const text = message.trim();
    if (!text || ask.isPending) return;

    setDraft('');
    setTurns((current) => [
      ...current,
      { id: `you-${Date.now()}`, role: 'you', text, products: [] },
      {
        id: `nima-${Date.now()}`,
        role: 'nima',
        text: '',
        products: [],
        note: 'Thinking',
        streaming: true,
      },
    ]);

    ask.mutate(text);
  }

  // A new turn, or another word of one, should bring the bottom back into
  // view. The conversation is the trigger even though nothing reads it here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: turns is the trigger
  useEffect(() => {
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [turns]);

  const ready = Boolean(draft.trim()) && !ask.isPending;

  return (
    <>
      <Stack.Screen options={{ title: 'Ask Nima' }} />

      <KeyboardAvoidingView
        style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
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

          <View style={{ flex: 1 }}>
            <Title style={{ fontSize: 24, lineHeight: 28 }}>Ask Nima</Title>
          </View>
        </View>

        <ScrollView
          ref={scroller}
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 24,
            gap: 20,
            maxWidth: isWide ? 760 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 ? (
            <View style={{ gap: 18, paddingTop: 24 }}>
              <View style={{ alignItems: 'center', gap: 14 }}>
                <Image
                  source={require('../assets/mascot.png')}
                  style={{ width: 96, height: 96 }}
                  contentFit="contain"
                  accessibilityLabel="Nima"
                />
                <Body tone="muted" align="center" style={{ maxWidth: 320 }}>
                  Tell me where you are going, or what you already own, and I will work with that.
                </Body>
              </View>

              <View style={{ gap: 8 }}>
                {(prompts.data?.items ?? []).map((prompt) => (
                  <Pressable
                    key={prompt.label}
                    onPress={() => send(prompt.message)}
                    style={{
                      paddingHorizontal: 18,
                      paddingVertical: 14,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: colors.line,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Body>{prompt.label}</Body>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {turns.map((turn) => (
            <View key={turn.id} style={{ gap: 10 }}>
              {turn.role === 'you' ? (
                <View
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    backgroundColor: colors.primary,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderRadius: radius.image,
                    borderBottomRightRadius: 6,
                  }}
                >
                  <Body style={{ color: colors.onPrimary }}>{turn.text}</Body>
                </View>
              ) : (
                <View style={{ gap: 10, maxWidth: '95%' }}>
                  <Eyebrow>Nima</Eyebrow>

                  {turn.note ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={colors.secondary} />
                      <Caption>{turn.note}</Caption>
                    </View>
                  ) : null}

                  {turn.text ? <Body>{turn.text}</Body> : null}

                  {turn.products.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ width: '100%', flexGrow: 0 }}
                      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
                    >
                      {turn.products.map((product) => (
                        <View key={product.id} style={{ width: 150 }}>
                          <ProductCard product={product} />
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 10,
            paddingHorizontal: gutter,
            paddingBottom: 20,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            maxWidth: isWide ? 760 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="What are you dressing for?"
            placeholderTextColor={colors.muted}
            multiline
            onSubmitEditing={() => send(draft)}
            blurOnSubmit
            style={{
              flex: 1,
              maxHeight: 120,
              backgroundColor: colors.surface,
              borderRadius: radius.image,
              borderWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: 16,
              paddingVertical: 12,
              fontFamily: 'DMSans_400Regular',
              fontSize: 16,
              color: colors.ink,
            }}
            accessibilityLabel="Your message"
          />

          <Pressable
            onPress={() => send(draft)}
            disabled={!draft.trim() || ask.isPending}
            accessibilityLabel="Send"
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              // Empty box: the button steps back to a neutral rather than a
              // faded burgundy, which reads as a rendering fault.
              backgroundColor: ready ? colors.primary : colors.sunk,
            }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path
                d="M5 12h13M12 5l7 7-7 7"
                stroke={ready ? colors.onPrimary : colors.muted}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
