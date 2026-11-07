/**
 * The six digit code, as six wells.
 *
 * One hidden field does the typing and six views do the showing. Six real
 * inputs looks the same and behaves badly: backspace at the start of a box
 * has nowhere to go, pasting a code fills one box with six digits, and the
 * one time code the phone offers goes into whichever box happens to be
 * focused. With a single field, paste, autofill and backspace all work
 * because the platform is doing them, not us.
 *
 * Every state looks like itself, after the code entry Blancosy ships and the
 * "Premium OTP" recipe in the app playbook:
 *
 *   idle      soft wells with no stroke; the next one shows a slow caret
 *   typing    each digit springs up into its well, with a light tick
 *   paste     a pasted or autofilled code cascades in, 40 ms a digit
 *   checking  all six dim together and "Checking" sits beneath, no spinner
 *   success   the wells collapse into the centre and become a drawn tick
 *   error     three decaying shakes, a short critical tint, then the digits
 *             clear, focus returns to the first well, and one line says why
 *
 * The caller owns the outcome and sets `state` from its own request. The
 * component owns only how that looks. It submits itself on the sixth digit:
 * typing the last digit of a code is an unambiguous statement of intent.
 *
 * Motion runs through Reanimated, whose animations land instantly when the
 * person has asked for less motion, so the states keep their look and lose
 * only their movement. The holds (the tint, the pause on the tick) are plain
 * timers, so they survive that too.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  type TextInputInstance,
  type TextStyle,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/index';
import { Caption } from './text';

export type CodeState = 'idle' | 'checking' | 'success' | 'error';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once, when the last digit lands. */
  onComplete: (value: string) => void;
  length?: number;
  /** What the check is doing. `busy` is kept as a shorthand for checking. */
  state?: CodeState;
  /** Stops input while the code is being checked. */
  busy?: boolean;
  /** One plain line of why, shown under the wells while the state is error. */
  message?: string;
  /** Fires once the tick has been seen, which is when a screen should move on. */
  onSuccessShown?: () => void;
  autoFocus?: boolean;
  /** Which background the wells sit on, so they read on the deep brown too. */
  onSurface?: 'ground' | 'deep';
}

const GAP = 8;
const WELL_HEIGHT = 58;
const CASCADE_MS = 40;
/** How long the critical tint holds before the digits clear. */
const ERROR_HOLD_MS = 600;
/** Long enough to see the tick finish drawing. */
const SUCCESS_HOLD_MS = 800;
const DIGIT_SPRING = { damping: 14, stiffness: 260, mass: 0.6 };

const tick = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync();
};
const buzz = () => {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
const tap = () => {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
};

export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  state: givenState,
  busy = false,
  message,
  onSuccessShown,
  autoFocus = true,
  onSurface = 'ground',
}: CodeInputProps) {
  const { colors, scheme } = useTheme();
  const state: CodeState = givenState ?? (busy ? 'checking' : 'idle');
  const field = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(0);
  /** Per well entrance delay, so a pasted code cascades instead of landing at once. */
  const [delays, setDelays] = useState<number[]>(() => Array.from({ length }, () => 0));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** True for the error hold: a digit typed then would be wiped when it clears. */
  const holding = useRef(false);

  // Shared by every well, so "all six dim together" is literal.
  const dim = useSharedValue(0);
  const tint = useSharedValue(0);
  const collapse = useSharedValue(0);
  const shake = useSharedValue(0);
  const check = useSharedValue(0);
  const badge = useSharedValue(0);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const editable = state === 'idle' || state === 'error';

  // Only once per complete code. Without this guard a failed check that
  // leaves the digits in place would resubmit on every render.
  const submitted = useRef<string | null>(null);

  const accept = useCallback(
    (raw: string) => {
      if (!editable || holding.current) return;
      const digits = raw.replace(/\D/g, '').slice(0, length);
      const before = value.length;
      const added = Math.max(0, digits.length - before);
      // More than one new digit at once is a paste or an autofill: cascade it.
      const cascade = added > 1;
      setDelays((current) =>
        current.map((old, index) =>
          index >= before && index < digits.length
            ? cascade
              ? (index - before) * CASCADE_MS
              : 0
            : old,
        ),
      );
      onChange(digits);
      for (let k = 0; k < added; k += 1) later(tick, cascade ? k * CASCADE_MS : 0);

      if (digits.length === length && before < length && submitted.current !== digits) {
        submitted.current = digits;
        // Let the last digit land before the row dims to checking. The
        // keyboard goes first: the answer appears where it was.
        later(
          () => {
            Keyboard.dismiss();
            onComplete(digits);
          },
          (cascade ? (added - 1) * CASCADE_MS : 0) + 140,
        );
      }
    },
    [editable, length, value.length, onChange, onComplete, later],
  );

  useEffect(() => {
    if (value.length < length) submitted.current = null;
  }, [value, length]);

  useEffect(() => {
    if (!autoFocus) return;
    // A tick, so the sheet has finished rising before the keyboard comes up.
    const timer = setTimeout(() => field.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  // State transitions. Only the change matters; callbacks are read as it happens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the transition is the event
  useEffect(() => {
    if (state === 'checking') {
      dim.value = withTiming(1, { duration: 220 });
      return;
    }
    dim.value = withTiming(0, { duration: 180 });

    if (state === 'error') {
      buzz();
      // Three cycles, each smaller: a head shake, not a vibration.
      shake.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 70 }),
        withTiming(-7, { duration: 65 }),
        withTiming(7, { duration: 65 }),
        withTiming(-3, { duration: 60 }),
        withTiming(0, { duration: 60 }),
      );
      tint.value = withTiming(1, { duration: 120 });
      holding.current = true;
      later(() => {
        holding.current = false;
        tint.value = withTiming(0, { duration: 220 });
        submitted.current = null;
        onChange('');
        setDelays(Array.from({ length }, () => 0));
        field.current?.focus();
      }, ERROR_HOLD_MS);
    }

    if (state === 'success') {
      tap();
      field.current?.blur();
      collapse.value = withTiming(1, { duration: 260, easing: Easing.in(Easing.cubic) });
      // A timed back ease rather than a spring, so it is sure to finish
      // inside the hold. The back curve keeps the little overshoot.
      badge.value = withDelay(
        140,
        withTiming(1, { duration: 340, easing: Easing.out(Easing.back(1.7)) }),
      );
      check.value = withDelay(
        300,
        withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
      );
      later(() => onSuccessShown?.(), SUCCESS_HOLD_MS);
    }

    if (state === 'idle') {
      collapse.value = withTiming(0, { duration: 200 });
      badge.value = withTiming(0, { duration: 150 });
      check.value = 0;
    }
  }, [state]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: 0.4 + 0.6 * badge.value }],
  }));

  const deep = onSurface === 'deep';
  const wellColors: WellColors = deep
    ? {
        fill: 'rgba(255, 255, 240, 0.10)',
        fillActive: 'rgba(255, 255, 240, 0.18)',
        fillCritical: 'rgba(166, 60, 50, 0.45)',
        text: colors.onEspresso,
        critical: '#F3B7B2',
        caret: colors.onEspresso,
      }
    : {
        fill: colors.sunk,
        fillActive: scheme === 'dark' ? colors.surface : '#FFFFFF',
        fillCritical: scheme === 'dark' ? '#3A1C1F' : '#F6DFDC',
        text: colors.ink,
        critical: colors.critical,
        caret: colors.accent,
      };

  const wellWidth = width > 0 ? (width - GAP * (length - 1)) / length : 0;
  const active = Math.min(value.length, length - 1);

  const status =
    state === 'checking'
      ? 'Checking'
      : state === 'success'
        ? 'Verified'
        : state === 'error'
          ? (message ?? 'That code did not match')
          : '';
  const statusColor =
    state === 'error'
      ? wellColors.critical
      : state === 'success'
        ? deep
          ? colors.onEspresso
          : colors.primary
        : deep
          ? colors.onEspresso
          : colors.muted;

  return (
    <View style={{ width: '100%' }}>
      <Pressable onPress={() => field.current?.focus()} accessible={false}>
        <Animated.View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={[{ flexDirection: 'row', gap: GAP, height: WELL_HEIGHT }, rowStyle]}
        >
          {/*
            The real field, invisible, so a tap anywhere on the wells opens
            the keyboard. It is not `display: none`: a field that is not laid
            out cannot be focused and cannot receive an autofilled code.
          */}
          <TextInput
            ref={field}
            value={value}
            onChangeText={accept}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={editable}
            keyboardType="number-pad"
            inputMode="numeric"
            returnKeyType="done"
            maxLength={length}
            // What lets the phone offer the code from the message itself.
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            autoFocus={false}
            caretHidden
            accessibilityLabel={`Six digit code, ${value.length} of ${length} entered`}
            accessibilityState={{ disabled: !editable }}
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: 0,
                // Android ignores a zero height field for autofill, so it
                // keeps its size and hides behind the wells instead.
                color: 'transparent',
              },
              // The focus ring would show through the invisible field.
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
            ]}
          />

          {Array.from({ length }, (_, index) => (
            <Well
              // biome-ignore lint/suspicious/noArrayIndexKey: a well is its position, and nothing else tells them apart
              key={`well-${index}`}
              digit={value[index]}
              delay={delays[index] ?? 0}
              active={focused && editable && index === active && value.length < length}
              width={wellWidth}
              // Distance from this well's centre to the row's, for the collapse.
              toCentre={width / 2 - (index * (wellWidth + GAP) + wellWidth / 2)}
              dim={dim}
              tint={tint}
              collapse={collapse}
              colors={wellColors}
            />
          ))}

          {/* The tick the wells collapse into. */}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: width / 2 - WELL_HEIGHT / 2,
                top: 0,
                width: WELL_HEIGHT,
                height: WELL_HEIGHT,
                borderRadius: WELL_HEIGHT / 2,
                backgroundColor: deep ? colors.onEspresso : colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              },
              badgeStyle,
            ]}
          >
            <DrawnCheck progress={check} color={deep ? colors.espresso : colors.onPrimary} />
          </Animated.View>
        </Animated.View>
      </Pressable>

      <Caption
        accessibilityLiveRegion="polite"
        accessibilityRole={state === 'error' ? 'alert' : 'text'}
        align="center"
        style={{ minHeight: 18, marginTop: 12, color: statusColor }}
      >
        {status}
      </Caption>
    </View>
  );
}

interface WellColors {
  fill: string;
  fillActive: string;
  fillCritical: string;
  text: string;
  critical: string;
  caret: string;
}

function Well({
  digit,
  delay,
  active,
  width,
  toCentre,
  dim,
  tint,
  collapse,
  colors,
}: {
  digit: string | undefined;
  delay: number;
  active: boolean;
  width: number;
  toCentre: number;
  dim: SharedValue<number>;
  tint: SharedValue<number>;
  collapse: SharedValue<number>;
  colors: WellColors;
}) {
  const enter = useSharedValue(digit ? 1 : 0);
  const lift = useSharedValue(active ? 1 : 0);
  // What is shown, kept for a beat after a delete so it fades rather than vanishes.
  const [shown, setShown] = useState(digit);

  // `delay` is read at the moment the digit arrives, which is the point.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the digit arriving is the event
  useEffect(() => {
    if (digit) {
      setShown(digit);
      enter.value = 0;
      enter.value = withDelay(delay, withSpring(1, DIGIT_SPRING));
    } else {
      enter.value = withTiming(0, { duration: 90 });
    }
  }, [digit]);

  useEffect(() => {
    lift.value = withTiming(active ? 1 : 0, { duration: 160 });
  }, [active, lift]);

  const wellStyle = useAnimatedStyle(() => ({
    backgroundColor:
      tint.value > 0
        ? interpolateColor(tint.value, [0, 1], [colors.fill, colors.fillCritical])
        : interpolateColor(lift.value, [0, 1], [colors.fill, colors.fillActive]),
    opacity: 1 - collapse.value,
    transform: [{ translateX: collapse.value * toCentre }, { scale: 1 - 0.55 * collapse.value }],
  }));

  const digitStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (1 - 0.6 * dim.value),
    color: interpolateColor(tint.value, [0, 1], [colors.text, colors.critical]),
    transform: [{ translateY: 6 * (1 - enter.value) }, { scale: 0.9 + 0.1 * enter.value }],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: width || undefined,
          flex: width ? undefined : 1,
          height: WELL_HEIGHT,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
        },
        wellStyle,
      ]}
    >
      {digit || shown ? (
        <Animated.Text
          style={[
            {
              fontFamily: 'DMSans_600SemiBold',
              fontSize: 26,
              fontVariant: ['tabular-nums'],
              includeFontPadding: false,
            } as TextStyle,
            digitStyle,
          ]}
        >
          {digit ?? shown}
        </Animated.Text>
      ) : null}
      {active && !digit ? <Caret color={colors.caret} /> : null}
    </Animated.View>
  );
}

/** A slow, soft blink. A caret, not a focus ring. */
function Caret({ color }: { color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 120 }),
        withDelay(380, withTiming(0.15, { duration: 320, easing: Easing.inOut(Easing.quad) })),
        withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', width: 2, height: 26, borderRadius: 1, backgroundColor: color },
        style,
      ]}
    />
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** The two strokes, rounded up so no gap shows at the start. */
const CHECK_LENGTH = 36;

/** The tick draws itself: the dash offset runs from its full length to zero. */
function DrawnCheck({ progress, color }: { progress: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - progress.value) }));
  return (
    <Svg width={WELL_HEIGHT} height={WELL_HEIGHT} viewBox="0 0 60 60">
      <AnimatedPath
        d="M18 31 L26 39 L42 22"
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={CHECK_LENGTH}
        animatedProps={props}
      />
    </Svg>
  );
}
