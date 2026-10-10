/**
 * The six digit code, as six boxes.
 *
 * One hidden field does the typing and six views do the showing. Six real
 * inputs looks the same and behaves badly: backspace at the start of a box
 * has nowhere to go, pasting a code fills one box with six digits, and the
 * one time code the phone offers goes into whichever box happens to be
 * focused. With a single field, paste, autofill and backspace all work
 * because the platform is doing them, not us.
 *
 * It submits itself on the sixth digit. Typing the last digit of a code is
 * an unambiguous statement of intent, and making someone then find a
 * button, with the keyboard over it, is the thing that makes this screen
 * feel broken.
 */

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, TextInput, View } from 'react-native';
import { useTheme } from '../theme/index';
import { Title } from './text';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once, when the last digit lands. */
  onComplete: (value: string) => void;
  length?: number;
  /** Stops input while the code is being checked. */
  busy?: boolean;
  autoFocus?: boolean;
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  busy = false,
  autoFocus = true,
}: CodeInputProps) {
  const { colors, radius } = useTheme();
  const field = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // Only once per complete code. Without this guard a failed check that
  // leaves the digits in place would resubmit on every render.
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (value.length < length) {
      submitted.current = null;
      return;
    }

    if (submitted.current === value) return;
    submitted.current = value;

    // Out of the way first: the answer appears where the keyboard was.
    Keyboard.dismiss();
    onComplete(value);
  }, [value, length, onComplete]);

  useEffect(() => {
    if (!autoFocus) return;
    // A tick, so the sheet has finished animating before the keyboard
    // comes up over it.
    const timer = setTimeout(() => field.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => field.current?.focus()} accessibilityRole="none" style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {digits.map((digit, index) => {
          const here = focused && index === active && value.length < length;

          return (
            <View
              key={`box-${index}`}
              style={{
                flex: 1,
                maxWidth: 54,
                aspectRatio: 0.82,
                borderRadius: radius.chip,
                borderWidth: here ? 2 : 1,
                borderColor: here ? colors.accent : digit ? colors.primary : colors.line,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Title style={{ fontSize: 26, lineHeight: 32, color: colors.ink }}>{digit}</Title>
            </View>
          );
        })}
      </View>

      {/*
        The real field, invisible and on top, so a tap anywhere on the boxes
        opens the keyboard. It is not `display: none`, because a field that
        is not laid out cannot be focused and cannot receive an autofilled
        code.
      */}
      <TextInput
        ref={field}
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!busy}
        keyboardType="number-pad"
        inputMode="numeric"
        returnKeyType="done"
        maxLength={length}
        // What lets the phone offer the code from the message itself.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={false}
        caretHidden
        accessibilityLabel={`Six digit code, ${value.length} of ${length} entered`}
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0,
            // Android ignores a zero height field for autofill, so it keeps
            // its size and hides behind the boxes instead.
            color: 'transparent',
          },
          // The focus ring would show through the invisible field.
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        ]}
      />
    </Pressable>
  );
}
