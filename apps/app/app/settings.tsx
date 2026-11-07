/**
 * Settings.
 *
 * Laid out the way a large company's app lays it out: who you are at the
 * top, then grouped lists with a heading each, every row a full width
 * target with its label, what it is set to on the right and a chevron;
 * the one destructive thing on its own at the bottom in the critical
 * colour; the version in small type under everything.
 *
 * Every row does something real today. There are no placeholders.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuthGate } from '../src/components/auth-gate';
import { Button } from '../src/components/button';
import { Avatar } from '../src/components/feed-post';
import { Sheet } from '../src/components/sheet';
import { Body, BodyStrong, Caption, Micro, Title } from '../src/components/text';
import { useTryOnAvailable } from '../src/components/try-on';
import { api } from '../src/lib/api';
import { signOut } from '../src/lib/auth';
import { API_URL } from '../src/lib/config';
import { usePageTitle } from '../src/lib/page-title';
import { back, SELL_HOME } from '../src/lib/routes';
import { useSetupProgress } from '../src/lib/setup';
import { useTheme } from '../src/theme/index';

/** The API serves these pages itself, so they always match the running server. */
function openPage(path: '/privacy' | '/terms' | '/help') {
  const url = `${API_URL}${path}`;
  if (Platform.OS === 'web') {
    void Linking.openURL(url);
    return;
  }
  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

export default function SettingsScreen() {
  usePageTitle('Settings');
  const { colors, gutter, isWide } = useTheme();
  const canTryOn = useTryOnAvailable();
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
      if (globalThis.confirm?.('Sign out? Your looks stay on your account.') ?? true) {
        void endSession();
      }
      return;
    }

    Alert.alert('Sign out', 'Your looks stay on your account.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void endSession() },
    ]);
  }

  const tryOnsLeft = Math.floor(
    (bootstrap.data?.credits.balance ?? 0) /
      Math.max(1, bootstrap.data?.costs.tryOnSingleItem ?? 1),
  );
  const completion = user?.styleProfileCompletion ?? 0;
  const version = Constants.expoConfig?.version ?? '0.1.0';
  const update = Updates.updateId ? Updates.updateId.slice(0, 8) : null;

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
            onPress={() => back(router)}
            accessibilityLabel="Back"
            accessibilityRole="button"
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? colors.line : colors.sunk,
            })}
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
            paddingHorizontal: gutter,
            paddingTop: 4,
            paddingBottom: 48,
            gap: 24,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {/* Who you are */}
          {isGuest ? (
            <Card>
              <View style={{ padding: 16, gap: 10 }}>
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
            </Card>
          ) : (
            <Card>
              <Pressable
                onPress={() => router.push('/profile')}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  padding: 14,
                  backgroundColor: pressed ? colors.sunk : 'transparent',
                })}
              >
                <Avatar url={user?.avatarUrl} name={user?.name} size={56} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <BodyStrong numberOfLines={1}>{user?.name?.trim() || 'You'}</BodyStrong>
                  <Caption numberOfLines={1}>
                    {user?.handle ? `@${user.handle}` : (user?.email ?? '')}
                  </Caption>
                  {user?.handle && user.email ? (
                    <Caption numberOfLines={1}>{user.email}</Caption>
                  ) : null}
                </View>
                <Chevron color={colors.muted} />
              </Pressable>
            </Card>
          )}

          <Group title="Account">
            {isGuest ? (
              <Row
                label="See the opening screen again"
                onPress={() => router.push('/welcome')}
                first
                last
              />
            ) : (
              <>
                <Row
                  label="Your profile"
                  value="Name, handle, photo, banner"
                  onPress={() => router.push('/profile')}
                  first
                />
                <Row
                  label="Style profile"
                  value={completion >= 100 ? 'Complete' : `${completion} percent`}
                  onPress={() => router.push('/style')}
                />
                <Row label="Your photos" onPress={() => router.push('/photos')} />
                <Row
                  label="Password"
                  value={profile.data?.hasPassword ? 'Set' : 'Not set'}
                  onPress={() => router.push('/password')}
                />
                {canTryOn ? <Row label="Try-ons left" value={String(tryOnsLeft)} /> : null}
                <Row
                  label={setup.complete ? 'Set up' : 'Finish setting up'}
                  value={setup.complete ? 'Done' : `${setup.done} of ${setup.total}`}
                  onPress={setup.complete ? undefined : () => router.push('/setup')}
                  last
                />
              </>
            )}
          </Group>

          {!isGuest ? (
            <Group title="Shop">
              {user?.hasStore ? (
                <Row
                  label="Your shop"
                  value="Orders, pieces, payouts"
                  onPress={() => router.push(SELL_HOME)}
                  first
                  last
                />
              ) : (
                <Row
                  label="Sell on Nima"
                  value="Open a shop"
                  onPress={() => router.push('/sell/setup')}
                  first
                  last
                />
              )}
            </Group>
          ) : null}

          <Group title="Privacy and legal">
            <Row label="Privacy policy" onPress={() => openPage('/privacy')} first />
            <Row label="Terms of use" onPress={() => openPage('/terms')} />
            <Row label="Help and contact" onPress={() => openPage('/help')} last />
          </Group>

          {!isGuest ? (
            <>
              <Group>
                <Row label="Sign out" onPress={confirmSignOut} first last />
              </Group>

              <Group>
                <Row
                  label="Delete my account"
                  tone="critical"
                  onPress={() => setConfirmingLeave(true)}
                  first
                  last
                />
              </Group>
            </>
          ) : null}

          <Micro align="center" style={{ marginTop: 8 }}>
            {update ? `Nima ${version}, update ${update}` : `Nima ${version}`}
          </Micro>
        </ScrollView>
      </View>

      <Sheet
        open={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        title="Delete your account"
      >
        <Body tone="muted">
          This cannot be undone. Your account, your looks, your photos and your wardrobe are
          removed. Orders are kept, because a shop has to be able to account for what it sold.
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

/** A heading in small capitals over one rounded block of rows. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      {title ? <Micro style={{ paddingHorizontal: 16 }}>{title.toUpperCase()}</Micro> : null}
      <Card>{children}</Card>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

/**
 * One row: the label, what it is set to, a chevron when it goes somewhere.
 *
 * Rows sit flush in their block with a hairline between them, which is
 * what makes a list read as a list rather than as a stack of buttons.
 */
function Row({
  label,
  value,
  onPress,
  tone = 'ink',
  first = false,
  last = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'ink' | 'critical';
  first?: boolean;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const color = tone === 'critical' ? colors.critical : colors.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        paddingLeft: 16,
        paddingRight: onPress ? 12 : 16,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.line,
        backgroundColor: pressed && onPress ? colors.sunk : 'transparent',
      })}
    >
      <Body style={{ flex: 1, color }} numberOfLines={1}>
        {label}
      </Body>
      {value ? (
        <Caption numberOfLines={1} style={{ flexShrink: 1, maxWidth: '55%', textAlign: 'right' }}>
          {value}
        </Caption>
      ) : null}
      {onPress && tone !== 'critical' ? <Chevron color={colors.muted} /> : null}
    </Pressable>
  );
}

function Chevron({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="m10 6 6 6-6 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
