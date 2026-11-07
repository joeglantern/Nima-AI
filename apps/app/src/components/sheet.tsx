/**
 * Sheet.
 *
 * On a phone this rises from the bottom on a spring, exactly as the screens
 * show. On a wide window it becomes a centred dialog, because a full width
 * sheet on a desktop looks like a mistake.
 *
 * The content behind it stays visible either way. That is the point of the
 * sign in gate: you can see what you are being asked to sign up for. So the
 * backdrop darkens and softens the page rather than greying it out: a touch
 * of blur where the platform can draw one, and a warm dark tint everywhere.
 *
 * Dismissal is a tap outside, a drag down past the threshold, Escape or the
 * browser's Back button. The sheet leaves the way it came, which is what
 * tells a person it was a sheet and not a page.
 */

import { BlurView } from 'expo-blur';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation } from '../theme/elevation';
import { useTheme } from '../theme/index';
import { Title } from './text';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Stops a casual tap outside from closing it. */
  dismissable?: boolean;
}

const RISE = { damping: 22, stiffness: 240, mass: 0.9 };
const LEAVE_MS = 220;
/** How far down a drag has to go, or how fast, before the sheet lets go. */
const DRAG_CLOSE_DISTANCE = 96;
const DRAG_CLOSE_VELOCITY = 0.9;

export function Sheet({ open, onClose, title, children, dismissable = true }: SheetProps) {
  const { colors, radius, isCompact, gutter, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  /*
   * The modal stays mounted for the leaving animation. `open` is the
   * intent; `mounted` is what is on screen.
   */
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      drag.value = 0;
      progress.value = isCompact
        ? withSpring(1, RISE)
        : withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setMounted)(false);
      },
    );
  }, [open, isCompact, progress, drag]);

  // Escape closes it on the web, which people expect from a dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) onClose();
    };

    globalThis.addEventListener?.('keydown', handler);
    return () => globalThis.removeEventListener?.('keydown', handler);
  }, [open, dismissable, onClose]);

  /*
   * The browser's Back button closes it rather than leaving the app. An
   * open sheet puts one entry on the history; Back pops it and we close;
   * closing any other way pops it ourselves. The flag keeps the two from
   * popping twice, which would step out of the page.
   */
  const pushed = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (open && !pushed.current) {
      window.history.pushState({ nimaSheet: true }, '');
      pushed.current = true;
    }

    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!open && pushed.current) {
        pushed.current = false;
        if (window.history.state?.nimaSheet) window.history.back();
      }
    };
  }, [open, onClose]);

  /*
   * Drag down to dismiss, from the handle and the title. The sheet follows
   * the finger, lets go past the threshold, and springs back otherwise.
   * Upward drags are damped so the sheet never leaves the bottom edge.
   */
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        dismissable && Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        drag.value = gesture.dy > 0 ? gesture.dy : gesture.dy / 6;
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DRAG_CLOSE_DISTANCE || gesture.vy > DRAG_CLOSE_VELOCITY) {
          onClose();
        } else {
          drag.value = withSpring(0, RISE);
        }
      },
      onPanResponderTerminate: () => {
        drag.value = withSpring(0, RISE);
      },
    }),
  ).current;

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() =>
    isCompact
      ? { transform: [{ translateY: (1 - progress.value) * height + drag.value }] }
      : { opacity: progress.value, transform: [{ scale: 0.98 + 0.02 * progress.value }] },
  );

  const dark = scheme === 'dark';
  const blurs = Platform.OS === 'ios' || Platform.OS === 'web';

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/*
        The backdrop. Blur where the platform draws one (iOS, the web), a
        plain tint on Android, and the same warm dark wash on both so the
        photograph behind keeps its colour instead of turning grey.
      */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} pointerEvents="none">
        {blurs ? (
          <BlurView intensity={dark ? 18 : 22} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      </Animated.View>

      {/*
        The sheet moves up with the keyboard. Without this it sits where it
        was and the keyboard covers whatever was being typed into, along
        with the button underneath.
      */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          onPress={dismissable ? onClose : undefined}
          style={{
            flex: 1,
            justifyContent: isCompact ? 'flex-end' : 'center',
            alignItems: isCompact ? 'stretch' : 'center',
          }}
          accessibilityLabel="Close"
        >
          <Animated.View
            style={[
              {
                backgroundColor: colors.ground,
                borderTopLeftRadius: radius.sheet,
                borderTopRightRadius: radius.sheet,
                borderBottomLeftRadius: isCompact ? 0 : radius.sheet,
                borderBottomRightRadius: isCompact ? 0 : radius.sheet,
                // A hairline of light on the top edge in the dark, where a
                // sheet would otherwise merge with the dark page behind it.
                borderTopWidth: dark ? 1 : 0,
                borderTopColor: 'rgba(255, 255, 255, 0.08)',
                width: isCompact ? '100%' : 460,
                maxHeight: height * 0.9,
                ...elevation('sheet', { up: true, colour: dark ? '#000000' : colors.ink }),
              },
              panelStyle,
            ]}
          >
            {/* Stops a tap inside the sheet from closing it. */}
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={{
                paddingBottom: isCompact ? Math.max(insets.bottom, 16) + 8 : 28,
                paddingHorizontal: isCompact ? gutter + 4 : 28,
              }}
            >
              {/* The handle. Phone only: a dialog does not get dragged. */}
              {isCompact ? (
                <View
                  {...pan.panHandlers}
                  style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 14 }}
                  accessibilityRole="button"
                  accessibilityLabel="Drag down to close"
                >
                  <View
                    style={{
                      width: 36,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: dark ? 'rgba(255, 255, 255, 0.22)' : colors.line,
                    }}
                  />
                </View>
              ) : (
                <View style={{ height: 24 }} />
              )}

              {title ? (
                <View {...(isCompact ? pan.panHandlers : {})} style={{ marginBottom: 16 }}>
                  <Title>{title}</Title>
                </View>
              ) : null}

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                // The keyboard stays put while a field inside is tapped.
                keyboardDismissMode="none"
                contentContainerStyle={{ gap: 12 }}
              >
                {children}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
