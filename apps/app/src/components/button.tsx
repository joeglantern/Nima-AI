/**
 * Buttons.
 *
 * Fully round, as in the screens. Three kinds only: the main action, a quiet
 * one, and a provider button for the sign in sheet. Anything else is a link.
 */

import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useTheme } from '../theme/index';
import { BodyStrong } from './text';

type Variant = 'primary' | 'quiet' | 'provider';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  icon?: React.ReactNode;
  full?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  icon,
  full = true,
  disabled,
  onPress,
  style,
  ...props
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary' ? colors.primary : variant === 'provider' ? colors.surface : 'transparent';

  const foreground =
    variant === 'primary' ? colors.onPrimary : variant === 'provider' ? colors.ink : colors.primary;

  return (
    <Pressable
      {...props}
      disabled={isDisabled}
      onPress={(event) => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress?.(event);
      }}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: radius.pill,
          paddingVertical: 16,
          paddingHorizontal: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
          borderWidth: variant === 'quiet' ? 1 : 0,
          borderColor: colors.line,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <BodyStrong style={{ color: foreground }}>{label}</BodyStrong>
        </>
      )}
    </Pressable>
  );
}
