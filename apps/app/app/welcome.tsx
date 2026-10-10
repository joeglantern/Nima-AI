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

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from '../src/components/button';
import { EmailSteps } from '../src/components/email-steps';
import { Body, Caption, Display, Label } from '../src/components/text';
import { sendEmailCode, signInWithApple, signInWithGoogle, verifyEmailCode } from '../src/lib/auth';
import { markWelcomeSeen } from '../src/lib/first-run';
import { useTheme } from '../src/theme/index';

export default function WelcomeScreen() {
  const { colors, radius, isWide } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<'choose' | 'email'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    await markWelcomeSeen();
    router.replace('/');
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await leave();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
      {/* The top half: who this is */}
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: insets.top + 24,
          paddingHorizontal: 24,
          gap: 28,
        }}
      >
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Display>Nima</Display>
          <Label>AI stylist</Label>
        </View>

        <Image
          source={require('../assets/mascot.png')}
          style={{ width: 180, height: 180 }}
          contentFit="contain"
          accessibilityLabel="Nima, drawn as a friendly character"
        />

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Body style={{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 22 }}>
            Your personal AI stylist
          </Body>
          <Body tone="muted">See yourself in every outfit</Body>
        </View>
      </View>

      {/* The bottom sheet: the ways in */}
      <View
        style={{
          // The deep brown from the opening screen, not the burgundy: it is
          // what makes the cream above it feel lit rather than tinted.
          backgroundColor: colors.espresso,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 20,
          gap: 12,
          width: '100%',
          maxWidth: isWide ? 520 : undefined,
          alignSelf: 'center',
          borderBottomLeftRadius: isWide ? radius.sheet : 0,
          borderBottomRightRadius: isWide ? radius.sheet : 0,
          marginBottom: isWide ? 32 : 0,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 44,
            height: 5,
            borderRadius: 999,
            backgroundColor: colors.onEspresso,
            opacity: 0.5,
            marginBottom: 14,
          }}
        />

        {mode === 'choose' ? (
          <>
            {Platform.OS === 'ios' ? (
              <Button
                label="Continue with Apple"
                variant="provider"
                loading={busy}
                icon={<AppleMark color={colors.ink} />}
                onPress={() => void run(signInWithApple)}
              />
            ) : null}

            <Button
              label="Continue with Google"
              variant="provider"
              loading={busy}
              icon={<GoogleMark />}
              onPress={() => void run(signInWithGoogle)}
            />

            <Button
              label="Continue with email"
              variant="provider"
              icon={<MailMark color={colors.ink} />}
              onPress={() => setMode('email')}
            />
          </>
        ) : (
          <EmailSteps
            onCancel={() => setMode('choose')}
            onSendCode={sendEmailCode}
            onVerify={async (email, code) => {
              await verifyEmailCode(email, code);
              await leave();
            }}
            onSurface="deep"
          />
        )}

        {error ? (
          <Caption style={{ color: colors.onEspresso }} align="center">
            {error}
          </Caption>
        ) : null}

        <Pressable
          onPress={() => void leave()}
          accessibilityRole="button"
          style={{ paddingVertical: 14, alignItems: 'center' }}
        >
          <Body style={{ color: colors.onEspresso, opacity: 0.9 }}>Look around first</Body>
        </Pressable>
      </View>
    </View>
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
