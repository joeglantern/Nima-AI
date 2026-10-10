/**
 * Buttons.
 *
 * Fully round, as in the screens. Three kinds only: the main action, a quiet
 * one, and a provider button for the sign in sheet. Anything else is a link.
 */

import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableProps,
  View,
  type ViewStyle,
} from 'react-native';
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
    variant === 'primary'
      ? colors.primary
      : variant === 'provider'
        ? colors.surface
        : 'transparent';

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
          paddingVertical: 17,
          paddingHorizontal: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.45 : 1,
          borderWidth: variant === 'quiet' ? 1 : 0,
          borderColor: colors.line,
          // Pressing moves it, rather than only fading it. A button that
          // only changes opacity reads as disabled for the moment it is held.
          transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
          // The main action sits above the page. The quiet one does not,
          // because a shadow on an outline is what makes a screen look
          // like a pile of widgets.
          ...(variant === 'quiet' || isDisabled
            ? {}
            : {
                shadowColor: variant === 'primary' ? colors.primary : '#2D2926',
                shadowOpacity: pressed ? 0.1 : 0.18,
                shadowRadius: pressed ? 6 : 14,
                shadowOffset: { width: 0, height: pressed ? 2 : 6 },
                elevation: pressed ? 2 : 5,
              }),
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : variant === 'provider' && icon ? (
        <>
          <View style={{ position: 'absolute', left: 24 }}>{icon}</View>
          <BodyStrong style={{ color: foreground }}>{label}</BodyStrong>
        </>
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <BodyStrong style={{ color: foreground }}>{label}</BodyStrong>
        </>
      )}
    </Pressable>
  );
}
