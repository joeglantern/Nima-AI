/**
 * A password.
 *
 * Accounts are opened with a code sent to the address, which proves it is
 * theirs. A password is a convenience added afterwards, for signing in
 * without waiting on an email. Nobody has to have one, and forgetting it is
 * not a crisis: a code still works, and a new password can be set here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
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
import { Body, Caption, Micro, Title } from '../src/components/text';
import { ApiError, api } from '../src/lib/api';
import { useTheme } from '../src/theme/index';

const MIN = 8;

export default function PasswordScreen() {
  const { colors, gutter, radius, isWide } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const profile = useQuery({ queryKey: ['profile'], queryFn: api.myProfile });
  const hasPassword = profile.data?.hasPassword ?? false;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [reveal, setReveal] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.setPassword({ newPassword: next, ...(hasPassword ? { currentPassword: current } : {}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      setSaved(true);
      setCurrent('');
      setNext('');
      setAgain('');
    },
    onError: (error) => {
      setProblem(error instanceof ApiError ? error.message : 'That did not save. Try again.');
    },
  });

  function submit() {
    setProblem(null);
    setSaved(false);
    if (next.length < MIN) {
      setProblem(`Use at least ${MIN} characters.`);
      return;
    }
    if (next !== again) {
      setProblem('The two passwords are not the same.');
      return;
    }
    if (hasPassword && !current) {
      setProblem('Enter your current password first.');
      return;
    }
    save.mutate();
  }

  const inputStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
  } as const;

  const strength = strengthOf(next);

  return (
    <>
      <Stack.Screen options={{ title: hasPassword ? 'Change your password' : 'Set a password' }} />

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
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
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
            {hasPassword ? 'Change your password' : 'Set a password'}
          </Title>
        </View>

        <ScrollView
          style={{ flex: 1, width: '100%' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: gutter,
            paddingBottom: 48,
            gap: 20,
            maxWidth: isWide ? 620 : undefined,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <Body tone="muted">
            {hasPassword
              ? 'A code sent to your email always works too, so a forgotten password is never a locked door.'
              : 'Sign in without waiting for a code. A code will still work whenever you want it.'}
          </Body>

          {profile.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              {hasPassword ? (
                <Field label="Current password">
                  <TextInput
                    value={current}
                    onChangeText={setCurrent}
                    secureTextEntry={!reveal}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    autoComplete="current-password"
                    placeholder="What you use now"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                    accessibilityLabel="Current password"
                  />
                </Field>
              ) : null}

              <Field label="New password" note={strength.note} noteTone={strength.tone}>
                <TextInput
                  value={next}
                  onChangeText={setNext}
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  placeholder={`At least ${MIN} characters`}
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                  accessibilityLabel="New password"
                />
              </Field>

              <Field label="Once more">
                <TextInput
                  value={again}
                  onChangeText={setAgain}
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  placeholder="The same again"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  style={inputStyle}
                  accessibilityLabel="New password again"
                />
              </Field>

              <Pressable
                onPress={() => setReveal((value) => !value)}
                accessibilityRole="button"
                hitSlop={8}
                style={{ alignSelf: 'flex-start' }}
              >
                <Caption tone="primary">
                  {reveal ? 'Hide what I typed' : 'Show what I typed'}
                </Caption>
              </Pressable>

              {problem ? <Body tone="critical">{problem}</Body> : null}
              {saved ? (
                <Body tone="primary">
                  {hasPassword ? 'Changed. ' : 'Set. '}
                  You can sign in with it from now on.
                </Body>
              ) : null}

              <Button
                label={hasPassword ? 'Change password' : 'Set password'}
                loading={save.isPending}
                disabled={next.length < MIN || again.length < MIN}
                onPress={submit}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/** A word about the password as it is typed, never a red bar. */
function strengthOf(value: string): { note?: string; tone: 'muted' | 'critical' | 'primary' } {
  if (value.length === 0) return { tone: 'muted' };
  if (value.length < MIN) return { note: `${MIN - value.length} more`, tone: 'muted' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (value.length >= 14 || kinds >= 3) return { note: 'Strong', tone: 'primary' };
  return { note: 'Fine', tone: 'muted' };
}

function Field({
  label,
  note,
  noteTone = 'muted',
  children,
}: {
  label: string;
  note?: string;
  noteTone?: 'muted' | 'critical' | 'primary';
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Micro tone="muted">{label.toUpperCase()}</Micro>
        {note ? <Micro tone={noteTone}>{note}</Micro> : null}
      </View>
      {children}
    </View>
  );
}
