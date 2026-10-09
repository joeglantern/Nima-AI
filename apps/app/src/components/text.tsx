/**
 * Type components.
 *
 * Screens never set a font family or a size directly. They pick a role, and
 * the roles come from the brand book: Cormorant Garamond for headlines, DM
 * Sans for everything a person reads or taps, JetBrains Mono for small
 * uppercase labels.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/index';

type Tone = 'ink' | 'muted' | 'primary' | 'secondary' | 'onPrimary' | 'critical';

export interface TextProps extends RNTextProps {
  tone?: Tone;
  align?: TextStyle['textAlign'];
}

function useTone(tone: Tone = 'ink'): string {
  const { colors } = useTheme();

  switch (tone) {
    case 'muted':
      return colors.muted;
    case 'primary':
      return colors.primary;
    case 'secondary':
      return colors.secondary;
    case 'onPrimary':
      return colors.onPrimary;
    case 'critical':
      return colors.critical;
    default:
      return colors.ink;
  }
}

/** Screen titles and the wordmark. */
export function Display({ tone, align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.display, { color, textAlign: align }, style]} />;
}

export function Title({ tone, align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.title, { color, textAlign: align }, style]} />;
}

export function Heading({ tone, align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.heading, { color, textAlign: align }, style]} />;
}

export function Body({ tone, align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.body, { color, textAlign: align }, style]} />;
}

export function BodyStrong({ tone, align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.bodyStrong, { color, textAlign: align }, style]} />;
}

export function Caption({ tone = 'muted', align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.caption, { color, textAlign: align }, style]} />;
}

/** Small uppercase labels: AI STYLIST, section eyebrows, data captions. */
export function Label({ tone = 'muted', align, style, ...props }: TextProps) {
  const { type } = useTheme();
  const color = useTone(tone);
  return <RNText {...props} style={[type.label, { color, textAlign: align }, style]} />;
}

/** Prices. Tabular figures so columns line up. */
export function Price({
  cents,
  style,
  tone,
  ...props
}: TextProps & { cents: number }) {
  const { type } = useTheme();
  const color = useTone(tone);
  const shillings = Math.round(cents / 100);

  return (
    <RNText
      {...props}
      style={[type.bodyStrong, { color, fontVariant: ['tabular-nums'] }, style]}
    >
      {`KSh ${shillings.toLocaleString('en-KE')}`}
    </RNText>
  );
}
