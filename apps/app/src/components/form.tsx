/**
 * Form pieces for the longer screens: a labelled field, a text box, and
 * choice chips.
 */

import type { ReactNode } from 'react';
import { Pressable, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../theme/index';
import { BodyStrong, Micro } from './text';

export function Field({
  label,
  note,
  noteTone = 'muted',
  children,
}: {
  label: string;
  note?: string;
  noteTone?: 'muted' | 'critical' | 'primary';
  children: ReactNode;
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

export function TextField({ style, multiline, ...props }: TextInputProps) {
  const { colors, radius } = useTheme();

  return (
    <TextInput
      placeholderTextColor={colors.muted}
      multiline={multiline}
      {...props}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          paddingHorizontal: 16,
          paddingVertical: 14,
          fontFamily: 'DMSans_400Regular',
          fontSize: 16,
          color: colors.ink,
          ...(multiline ? { minHeight: 96, textAlignVertical: 'top' as const } : {}),
        },
        style,
      ]}
    />
  );
}

export function Chips<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
  label?: string;
}) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
    >
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            onPress={() => onToggle(option.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.accent : colors.line,
              backgroundColor: on ? colors.accent : pressed ? colors.sunk : colors.surface,
            })}
          >
            <BodyStrong style={{ fontSize: 14, color: on ? colors.onAccent : colors.ink }}>
              {option.label}
            </BodyStrong>
          </Pressable>
        );
      })}
    </View>
  );
}
