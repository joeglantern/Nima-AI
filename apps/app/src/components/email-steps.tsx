/**
 * Email sign in, in two steps: address, then the six digit code.
 *
 * Shared by the welcome screen and the gate sheet so the flow behaves the
 * same in both, and so the copy only has to be right once.
 */

import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button } from './button';
import { Caption } from './text';
import { useTheme } from '../theme/index';

export interface EmailStepsProps {
  onSendCode: (email: string) => Promise<void>;
  onVerify: (email: string, code: string) => Promise<void>;
  onCancel: () => void;
  /** Which background it sits on, so the small print stays readable. */
  onSurface?: 'ground' | 'primary';
}

export function EmailSteps({
  onSendCode,
  onVerify,
  onCancel,
  onSurface = 'ground',
}: EmailStepsProps) {
  const { colors, radius } = useTheme();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quietText = onSurface === 'primary' ? colors.onPrimary : colors.muted;

  const inputStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
  } as const;

  const run = async (action: () => Promise<void>, after?: () => void) => {
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
  };

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
          keyboardType="email-address"
          textContentType="emailAddress"
          inputMode="email"
          style={inputStyle}
          accessibilityLabel="Email address"
        />

        <Button
          label="Send me a code"
          loading={busy}
          disabled={!email.includes('@')}
          onPress={() => void run(() => onSendCode(email.trim()), () => setSent(true))}
        />

        <Button label="Back" variant="quiet" onPress={onCancel} />

        {error ? (
          <Caption style={{ color: quietText }} align="center">
            {error}
          </Caption>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Caption style={{ color: quietText }} align="center">
        {`We sent a six digit code to ${email}`}
      </Caption>

      <TextInput
        value={code}
        onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        style={[inputStyle, { textAlign: 'center', letterSpacing: 8, fontSize: 22 }]}
        accessibilityLabel="Six digit code"
      />

      <Button
        label="Sign in"
        loading={busy}
        disabled={code.length !== 6}
        onPress={() => void run(() => onVerify(email.trim(), code))}
      />

      <Button
        label="Use a different email"
        variant="quiet"
        onPress={() => {
          setSent(false);
          setCode('');
        }}
      />

      {error ? (
        <Caption style={{ color: quietText }} align="center">
          {error}
        </Caption>
      ) : null}
    </View>
  );
}
