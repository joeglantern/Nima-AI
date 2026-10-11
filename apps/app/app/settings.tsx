/**
 * Settings.
 *
 * Mostly a way out of places. Signing in, signing out, seeing the opening
 * screen again, and leaving for good. A guest who got past the welcome
 * screen had no route back to it before this existed, which meant the only
 * way to sign in was to trip over a gated action.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../src/components/auth-gate';
import { Button } from '../src/components/button';
import { Sheet } from '../src/components/sheet';
import { Body, BodyStrong, Micro, Title } from '../src/components/text';
import { api } from '../src/lib/api';
import { signOut } from '../src/lib/auth';
import { useSetupProgress } from '../src/lib/setup';
import { useTheme } from '../src/theme/index';

export default function SettingsScreen() {
  const { colors, gutter, radius, isWide } = useTheme();
  const { requireAccount } = useAuthGate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const user = bootstrap.data?.user;
  const isGuest = !user || user.isAnonymous;
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.myProfile, enabled: !isGuest });
  const setup = useSetupProgress();

  const leave = useMutation({
    mutationFn: api.requestDeletion,
    onSuccess: async () => {
      setConfirmingLeave(false);
      await signOut();
      await queryClient.invalidateQueries();
      router.replace('/welcome');
    },
  });

  async function endSession() {
    await signOut();
    await queryClient.invalidateQueries();
    router.replace('/welcome');
  }

  function confirmSignOut() {
    // Alert does not exist on the web, where a window confirm is the native
    // thing and is what a browser user expects.
    if (Platform.OS === 'web') {
      void endSession();
      return;
    }

    Alert.alert('Sign out', 'Your looks stay on your account.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void endSession() },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={{ flex: 1, width: '100%', backgroundColor: colors.ground }}>
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

          <Title style={{ fontSize: 24, lineHeight: 28, flex: 1 }} numberOfLines={1}>
            Settings
          </Title>
        </View>

        <ScrollView
          style={{ flex: 1, width: '100%' }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 48,
            gap: 28,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <Group title="Account">
            {isGuest ? (
              <>
                <View
                  style={{
                    padding: 16,
                    gap: 10,
                    borderRadius: radius.card,
                    backgroundColor: colors.primarySoft,
                  }}
                >
                  <BodyStrong>You are browsing as a guest</BodyStrong>
                  <Body tone="muted">
                    Everything you have liked and saved so far comes with you when you sign in.
                  </Body>
                  <Button
                    label="Sign in or create an account"
                    full={false}
                    style={{ marginTop: 4 }}
                    onPress={() => requireAccount('Create an account to keep all of this')}
                  />
                </View>

                <Row
                  label="See the opening screen again"
                  hint="Apple, Google and email, as on first launch"
                  onPress={() => router.push('/welcome')}
                />
              </>
            ) : (
              <>
                <Field label="Signed in as" value={user?.email ?? user?.name ?? 'You'} />
                {user?.handle ? <Field label="Handle" value={`@${user.handle}`} /> : null}
                <Field label="Credits" value={String(bootstrap.data?.credits.balance ?? 0)} />

                <Row
                  label="Your profile"
                  hint="Name, handle and photo"
                  onPress={() => router.push('/profile')}
                />
                <Row
                  label="Your style profile"
                  hint={`${user?.styleProfileCompletion ?? 0} percent answered`}
                  onPress={() => router.push('/style')}
                />
                <Row
                  label="Your photos"
                  hint="The pictures Nima dresses"
                  onPress={() => router.push('/photos')}
                />
                <Row
                  label="Password"
                  hint={
                    profile.data?.hasPassword
                      ? 'Change it'
                      : 'Set one to sign in without waiting for a code'
                  }
                  onPress={() => router.push('/password')}
                />
                {setup.complete ? null : (
                  <Row
                    label="Finish setting up"
                    hint={`${setup.done} of ${setup.total} done`}
                    onPress={() => router.push('/setup')}
                  />
                )}
                <Row label="Sign out" onPress={confirmSignOut} />
              </>
            )}
          </Group>

          <Group title="About">
            <Field label="Version" value="0.1.0, in development" />
            <Body tone="muted">
              Nima shows you how something looks, not how it will fit. Check the seller's size guide
              before you buy.
            </Body>
          </Group>

          {!isGuest ? (
            <Group title="Leaving">
              <Body tone="muted">
                Your account, your looks, your photos and your wardrobe are deleted. Orders are
                kept, because a shop has to be able to account for what it sold.
              </Body>
              <Button
                label="Delete my account"
                variant="quiet"
                onPress={() => setConfirmingLeave(true)}
              />
            </Group>
          ) : null}
        </ScrollView>
      </View>

      <Sheet
        open={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        title="Delete your account"
      >
        <Body tone="muted">
          This cannot be undone. Everything you have made is removed, including the photographs you
          uploaded.
        </Body>

        <View style={{ gap: 10, marginTop: 16 }}>
          <Button label="Yes, delete it" loading={leave.isPending} onPress={() => leave.mutate()} />
          <Button
            label="Keep my account"
            variant="quiet"
            onPress={() => setConfirmingLeave(false)}
          />
        </View>

        {leave.isError ? (
          <Body tone="critical" style={{ marginTop: 10 }}>
            That did not work. Try again in a moment.
          </Body>
        ) : null}
      </Sheet>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Micro tone="muted">{title.toUpperCase()}</Micro>
      {children}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: radius.card,
        backgroundColor: colors.surface,
      }}
    >
      <Body tone="muted">{label}</Body>
      <Body numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Body>
    </View>
  );
}

function Row({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: radius.card,
        backgroundColor: pressed ? colors.sunk : colors.surface,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        {hint ? <Micro>{hint}</Micro> : null}
      </View>

      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="m10 6 6 6-6 6"
          stroke={colors.muted}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Pressable>
  );
}
