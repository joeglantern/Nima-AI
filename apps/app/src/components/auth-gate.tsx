/**
 * The sign in sheet.
 *
 * It appears over whatever the person was looking at, and it says why. The
 * brief is specific about this: "Create an account to try this look on
 * yourself" tells you what you get, where "Sign in to continue" tells you
 * nothing.
 *
 * Email is a six digit code. There is no password anywhere in the app.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../lib/api';
import { sendEmailCode, signInWithApple, signInWithGoogle, verifyEmailCode } from '../lib/auth';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { EmailSteps } from './email-steps';
import { Sheet } from './sheet';
import { Body, Caption, Title } from './text';

interface GateState {
  /** Opens the sheet. The reason becomes the heading. */
  requireAccount: (reason?: string) => void;
}

const AuthGateContext = createContext<GateState | null>(null);

const DEFAULT_REASON = 'Create an account to try this look on yourself';

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const [reason, setReason] = useState<string | null>(null);

  const value = useMemo<GateState>(
    () => ({ requireAccount: (next) => setReason(next ?? DEFAULT_REASON) }),
    [],
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <AuthSheet reason={reason} onClose={() => setReason(null)} />
    </AuthGateContext.Provider>
  );
}

export function useAuthGate(): GateState {
  const context = useContext(AuthGateContext);
  if (!context) throw new Error('useAuthGate must be used inside AuthGateProvider');
  return context;
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

function AuthSheet({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'choose' | 'email'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the ways in that the server is set up for. A Google button that
  // answers "provider not found" is worse than no Google button.
  // Always shown, as in the design. A provider the server is not set up
  // for says so when tapped rather than failing with "provider not found".
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const showApple = Platform.OS !== 'android';
  const showGoogle = true;
  const ready = bootstrap.data?.signIn;

  const social = (provider: 'apple' | 'google', action: () => Promise<void>) => {
    if (!ready?.[provider]) {
      setError(
        `${provider === 'apple' ? 'Apple' : 'Google'} sign in is not switched on yet. Use email for now.`,
      );
      return;
    }
    void run(action);
  };

  const close = useCallback(() => {
    setStep('choose');
    setError(null);
    onClose();
  }, [onClose]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={reason !== null} onClose={close}>
      <View style={{ gap: 6, marginBottom: 14 }}>
        <Title>{reason ?? DEFAULT_REASON}</Title>
        <Caption>It takes a moment, and your browsing comes with you.</Caption>
      </View>

      {step === 'choose' ? (
        <View style={{ gap: 10 }}>
          {showApple ? (
            <Button
              label="Continue with Apple"
              variant="provider"
              icon={<AppleMark color={colors.ink} />}
              loading={busy}
              onPress={() => social('apple', signInWithApple)}
            />
          ) : null}

          {showGoogle ? (
            <Button
              label="Continue with Google"
              variant="provider"
              icon={<GoogleMark />}
              loading={busy}
              onPress={() => social('google', signInWithGoogle)}
            />
          ) : null}

          <Button
            label="Continue with email"
            variant="provider"
            icon={<MailMark color={colors.ink} />}
            onPress={() => setStep('email')}
          />

          <Button label="Not now" variant="quiet" onPress={close} />
        </View>
      ) : (
        /*
         * The same component the welcome screen uses.
         *
         * This sheet used to carry its own copy, which is how it ended up
         * with a code field that had no way to submit itself while the
         * other one did.
         */
        <EmailSteps
          onCancel={() => setStep('choose')}
          onSendCode={sendEmailCode}
          onVerify={async (email, code) => {
            await verifyEmailCode(email, code);
            await queryClient.invalidateQueries();
            close();
          }}
        />
      )}

      {error ? (
        <Body tone="critical" style={{ marginTop: 10 }}>
          {error}
        </Body>
      ) : null}

      <Caption align="center" style={{ marginTop: 16 }}>
        By continuing you agree to Nima's terms and privacy notice.
      </Caption>
    </Sheet>
  );
}
