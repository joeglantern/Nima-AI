/**
 * Email sign in, in two steps: address, then the six digit code.
 *
 * Shared by the welcome screen and the gate sheet so the flow behaves the
 * same in both, and so the copy only has to be right once.
 *
 * Neither step asks for a button press that the person has already made
 * clear. A finished email address submits on the keyboard's return key, and
 * a sixth digit submits itself. The buttons stay for anyone who wants them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { CodeInput, type CodeState } from './code-input';
import { BodyStrong, Caption } from './text';

export interface EmailStepsProps {
  onSendCode: (email: string) => Promise<void>;
  onVerify: (email: string, code: string) => Promise<void>;
  /** The password way in, offered under the code as a smaller choice. */
  onPassword?: (email: string, password: string) => Promise<void>;
  /** Absent when email is the only way in, so there is nothing to go back to. */
  onCancel?: () => void;
  /**
   * Open the keyboard straight away. Right after choosing email, wrong when
   * the field is the first thing on a screen, where the keyboard would
   * cover whatever else is there.
   */
  autoFocus?: boolean;
  /** Which background it sits on, so the small print stays readable. */
  onSurface?: 'ground' | 'deep';
}

/** How long before another code can be asked for. Long enough for the first to arrive. */
const RESEND_AFTER = 30;

/** Enough to catch a typo, not so much that a valid address is refused. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function EmailSteps({
  onSendCode,
  onVerify,
  onPassword,
  onCancel,
  onSurface = 'ground',
  autoFocus = true,
}: EmailStepsProps) {
  const { colors, radius } = useTheme();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // What the code wells show: the check is the caller's, the look is theirs.
  const [codeState, setCodeState] = useState<CodeState>('idle');

  // Counts down once a code is out, so "send another" cannot be hammered.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const quietText = onSurface === 'deep' ? colors.onEspresso : colors.muted;
  // An error must not look like a hint. On the deep brown sheet the usual
  // red disappears, so it gets a light rose there.
  const errorText = onSurface === 'deep' ? '#F3B7B2' : colors.critical;

  const inputStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingVertical: 15,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
  } as const;

  const run = useCallback(async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }, []);

  function send() {
    if (!looksLikeEmail(email) || busy) return;
    Keyboard.dismiss();
    void run(
      () => onSendCode(email.trim()),
      () => {
        setSent(true);
        setResendIn(RESEND_AFTER);
      },
    );
  }

  function signInWithPassword() {
    if (!onPassword || !looksLikeEmail(email) || password.length < 8 || busy) return;
    Keyboard.dismiss();
    void run(() => onPassword(email.trim(), password));
  }

  function resend() {
    if (resendIn > 0 || busy) return;
    setCode('');
    setCodeState('idle');
    void run(
      () => onSendCode(email.trim()),
      () => setResendIn(RESEND_AFTER),
    );
  }

  // Given to CodeInput, which calls it on the sixth digit. Stable, so the
  // effect behind it does not refire on every keystroke.
  const verify = useCallback(
    (entered: string) => {
      setCodeState('checking');
      void run(async () => {
        try {
          await onVerify(email.trim(), entered);
          setCodeState('success');
        } catch (caught) {
          setCodeState('error');
          throw caught;
        }
      });
    },
    [email, onVerify, run],
  );

  if (!sent) {
    return (
      <View style={{ gap: 12 }}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          inputMode="email"
          // The keyboard says Go, and Go sends it.
          returnKeyType="go"
          onSubmitEditing={send}
          submitBehavior="blurAndSubmit"
          style={inputStyle}
          accessibilityLabel="Email address"
        />

        {withPassword && onPassword ? (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={signInWithPassword}
              style={inputStyle}
              accessibilityLabel="Password"
            />
            <Button
              label="Sign in"
              loading={busy}
              disabled={!looksLikeEmail(email) || password.length < 8}
              onPress={signInWithPassword}
            />
          </>
        ) : (
          <Button
            label="Send me a code"
            loading={busy}
            disabled={!looksLikeEmail(email)}
            onPress={send}
          />
        )}

        <View style={{ alignItems: 'center' }}>
          {onPassword ? (
            <TextLink
              label={withPassword ? 'Send me a code instead' : 'I have a password'}
              color={quietText}
              onPress={() => {
                setError(null);
                setWithPassword((current) => !current);
              }}
            />
          ) : null}
          {onCancel ? <TextLink label="Back" color={quietText} onPress={onCancel} /> : null}
        </View>

        {error ? (
          <Caption style={{ color: errorText }} align="center" accessibilityLiveRegion="polite">
            {error}
          </Caption>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <Caption style={{ color: quietText }} align="center">
        {`We sent a six digit code to ${email}`}
      </Caption>

      <CodeInput
        value={code}
        onChange={(next) => {
          setCode(next);
          // A new digit after a miss is a fresh go: the why line steps aside.
          if (codeState === 'error' && next.length > 0) {
            setCodeState('idle');
            setError(null);
          }
        }}
        onComplete={verify}
        state={codeState}
        message={error ?? undefined}
        onSurface={onSurface}
      />

      {/*
        Two small actions, stacked. Side by side they were wider than a
        phone, and the second fell off the edge.
      */}
      <View style={{ alignItems: 'center', marginTop: 2 }}>
        <TextLink
          label={
            resendIn > 0
              ? `Send a new code in 0:${String(resendIn).padStart(2, '0')}`
              : 'Send a new code'
          }
          color={quietText}
          disabled={resendIn > 0 || busy}
          onPress={resend}
        />
        <TextLink
          label="Use a different email"
          color={quietText}
          onPress={() => {
            setSent(false);
            setCode('');
            setError(null);
            setResendIn(0);
          }}
        />
      </View>
    </View>
  );
}

/** An action that matters less than a button. */
function TextLink({
  label,
  color,
  disabled = false,
  onPress,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }) => ({
        // The whole line is the target, 44 tall: a 14 point link is a sliver.
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 12,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      {/* Tabular figures, so a countdown does not jiggle as it changes. */}
      <BodyStrong style={{ color, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] }}>
        {label}
      </BodyStrong>
    </Pressable>
  );
}
