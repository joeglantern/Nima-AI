/**
 * The first screen, from the design.
 *
 * Wordmark, mascot, one line about what Nima does, then the three ways in,
 * sitting in the deep sheet at the bottom.
 *
 * "Look around first" is deliberate and sits right under the buttons: the
 * brief's first rule is that Nima works without an account, so the way past
 * this screen has to be obvious rather than hidden.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { usePageTitle } from '../src/lib/page-title';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { EmailSteps } from '../src/components/email-steps';
import { Body, Caption, Display } from '../src/components/text';
import { WelcomeWall } from '../src/components/welcome-wall';
import { api } from '../src/lib/api';
import {
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  signInWithPassword,
  verifyEmailCode,
} from '../src/lib/auth';
import { markWelcomeSeen } from '../src/lib/first-run';
import { useKeyboardShown } from '../src/lib/keyboard';
import { elevation } from '../src/theme/elevation';
import { useTheme } from '../src/theme/index';

export default function WelcomeScreen() {
  usePageTitle('Welcome');
  const { colors, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'choose' | 'email'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The buttons are always there, as the design shows them. Whether the
  // server is set up for each decides what a tap does: the sign in, or a
  // plain sentence saying it is not switched on yet.
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const showApple = Platform.OS !== 'android';
  const showGoogle = true;
  const ready = bootstrap.data?.signIn;

  // Everything above the sheet sits on photographs, so it is set in the
  // same light tone the sheet uses for its own text.
  const cream = colors.onEspresso;

  const social = (provider: 'apple' | 'google', action: () => Promise<void>) => {
    if (!ready?.[provider]) {
      setError(
        `${provider === 'apple' ? 'Apple' : 'Google'} sign in is not switched on yet. Use email for now.`,
      );
      return;
    }
    void run(action);
  };

  // The hero makes way for the keyboard on a phone. On a wide window there
  // is room for both.
  const typing = useKeyboardShown() && !isWide;

  async function leave() {
    await markWelcomeSeen();
    router.replace('/');
  }

  /*
   * After a sign in, everything fetched so far describes the guest. Fetch it
   * again before the feed shows, or the first heart tapped after signing in
   * asks for an account a second time.
   */
  async function leaveSignedIn() {
    await queryClient.invalidateQueries();
    await leave();
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await leaveSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
      The sheet at the bottom holds the email field, so the whole screen
      lifts with the keyboard. Without this the field and the button under
      it end up behind the keys.
    */
    <KeyboardAvoidingView
      style={{ flex: 1, width: '100%', backgroundColor: colors.espresso }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* The looks themselves, drifting behind everything. */}
      <WelcomeWall hidden={typing} />

      {/*
        The top half: who this is.

        The wordmark sits high and the promise sits just above the sheet,
        with the wall showing between them, so the eye travels down through
        the clothes to the buttons.
      */}
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: typing ? 'center' : 'space-between',
          paddingTop: insets.top + (typing ? 12 : 30),
          paddingBottom: typing ? 12 : 26,
          paddingHorizontal: 24,
        }}
      >
        {/*
          Opened again from settings there is somewhere to go back to, and
          the screen says so. On first launch there is not, and it does not.
        */}
        {router.canGoBack() ? (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={({ pressed }) => ({
              position: 'absolute',
              top: insets.top + 10,
              left: 16,
              width: 36,
              height: 36,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.32)',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d="m14 6-6 6 6 6"
                stroke={cream}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        ) : null}

        {/*
          The wordmark alone, the way a label sits on a lookbook. No
          strapline under it: the wall behind says what Nima is.
        */}
        <Display
          style={{
            color: cream,
            ...(typing ? { fontSize: 34, lineHeight: 38 } : { fontSize: 44, lineHeight: 48 }),
          }}
        >
          Nima
        </Display>

        {/*
          With the keyboard up there is room for the wordmark and nothing
          else. The promise goes, rather than being crushed into whatever
          strip is left above the sheet.
        */}
        {typing ? null : (
          <>
            <View style={{ flex: 1 }} />

            <Body
              align="center"
              style={{
                color: cream,
                fontFamily: 'CormorantGaramond_500Medium',
                fontSize: 27,
                lineHeight: 32,
                maxWidth: 260,
                textShadowColor: 'rgba(0, 0, 0, 0.35)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 10,
              }}
            >
              See yourself in every outfit.
            </Body>
          </>
        )}
      </View>

      {/* The bottom sheet: the ways in */}
      <View
        style={{
          // The deep brown from the opening screen, not the burgundy: it is
          // what makes the cream above it feel lit rather than tinted.
          backgroundColor: colors.espresso,
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          paddingTop: 18,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: 22,
          gap: 12,
          width: '100%',
          maxWidth: isWide ? 520 : undefined,
          alignSelf: 'center',
          borderBottomLeftRadius: isWide ? 32 : 0,
          borderBottomRightRadius: isWide ? 32 : 0,
          marginBottom: isWide ? 32 : 0,
          // The sheet lifts off the cream rather than being pasted onto it.
          ...elevation('sheet', { up: true }),
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 48,
            height: 5,
            borderRadius: 999,
            backgroundColor: colors.onEspresso,
            opacity: 0.4,
            marginBottom: 18,
          }}
        />

        {mode === 'choose' ? (
          <>
            {showApple ? (
              <Button
                label="Continue with Apple"
                variant="provider"
                loading={busy}
                icon={<AppleMark color={colors.ink} />}
                onPress={() => social('apple', signInWithApple)}
              />
            ) : null}

            {showGoogle ? (
              <Button
                label="Continue with Google"
                variant="provider"
                loading={busy}
                icon={<GoogleMark />}
                onPress={() => social('google', signInWithGoogle)}
              />
            ) : null}

            {/*
              Always a step of its own, even when email is the only way in.
              Landing on an empty field with nowhere to go back to reads as
              being made to sign up, which is the one thing this screen
              must not do.
            */}
            <Button
              label="Continue with email"
              variant="provider"
              icon={<MailMark color={colors.ink} />}
              onPress={() => {
                setError(null);
                setMode('email');
              }}
            />
          </>
        ) : (
          <EmailSteps
            onCancel={() => setMode('choose')}
            onPassword={signInWithPassword}
            onSendCode={sendEmailCode}
            onVerify={async (email, code) => {
              await verifyEmailCode(email, code);
              await leaveSignedIn();
            }}
            onSurface="deep"
          />
        )}

        {error ? (
          <Caption style={{ color: colors.onEspresso }} align="center">
            {error}
          </Caption>
        ) : null}

        {/* The way past this screen, drawn like the buttons above it. */}
        <Button
          label="Look around first"
          variant="quiet"
          labelColor={colors.onEspresso}
          onPress={() => void leave()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function AppleMark({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M16.4 12.8c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.8-1.6 0-3 .9-3.8 2.3-1.7 2.9-.4 7.1 1.2 9.4.8 1.1 1.7 2.4 3 2.3 1.2 0 1.6-.7 3.1-.7 1.4 0 1.8.7 3.1.7 1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.6M14.3 5.8c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4"
      />
    </Svg>
  );
}

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6Z"
      />
      <Path
        fill="#34A853"
        d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21 7.6 23.5 12 23.5Z"
      />
      <Path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3Z" />
      <Path
        fill="#EA4335"
        d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15.1.5 12 .5 7.6.5 3.7 3 1.8 6.8l3.8 3c.9-2.7 3.4-4.7 6.4-4.7Z"
      />
    </Svg>
  );
}

function MailMark({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1.6 8 5.4 8-5.4"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
