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
import { ActivityIndicator, Keyboard, TextInput, View } from 'react-native';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { CodeInput } from './code-input';
import { Body, Caption } from './text';

export interface EmailStepsProps {
  onSendCode: (email: string) => Promise<void>;
  onVerify: (email: string, code: string) => Promise<void>;
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
  onCancel,
  onSurface = 'ground',
  autoFocus = true,
}: EmailStepsProps) {
  const { colors, radius } = useTheme();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Counts down once a code is out, so "send another" cannot be hammered.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const quietText = onSurface === 'deep' ? colors.onEspresso : colors.muted;
  // A quiet button is burgundy on burgundy once it sits on the deep sheet.
  const quietLabel = onSurface === 'deep' ? colors.onEspresso : undefined;

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

  function resend() {
    if (resendIn > 0 || busy) return;
    setCode('');
    void run(
      () => onSendCode(email.trim()),
      () => setResendIn(RESEND_AFTER),
    );
  }

  // Given to CodeInput, which calls it on the sixth digit. Stable, so the
  // effect behind it does not refire on every keystroke.
  const verify = useCallback(
    (entered: string) => {
      void run(() => onVerify(email.trim(), entered));
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

        <Button
          label="Send me a code"
          loading={busy}
          disabled={!looksLikeEmail(email)}
          onPress={send}
        />

        {onCancel ? (
          <Button label="Back" variant="quiet" labelColor={quietLabel} onPress={onCancel} />
        ) : null}

        {error ? (
          <Caption style={{ color: quietText }} align="center">
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

      <CodeInput value={code} onChange={setCode} onComplete={verify} busy={busy} />

      {busy ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}
        >
          <ActivityIndicator size="small" color={colors.primary} />
          <Body style={{ color: quietText }}>Signing you in</Body>
        </View>
      ) : null}

      {error ? (
        <Caption style={{ color: colors.critical }} align="center">
          {error}
        </Caption>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
        <Button
          label={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
          variant="quiet"
          full={false}
          labelColor={quietLabel}
          disabled={resendIn > 0 || busy}
          onPress={resend}
        />
        <Button
          label="Use a different email"
          variant="quiet"
          full={false}
          labelColor={quietLabel}
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
