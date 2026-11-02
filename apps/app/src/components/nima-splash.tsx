/**
 * The opening scene, on the phone.
 *
 * The native splash is a still picture. This takes over from it as soon as
 * JavaScript is running and plays one beat: a thread lowers a hanger with a
 * dress on it, the dress swings once and settles, and Nima peeks out from
 * behind it. See yourself in every outfit, in two seconds and no words.
 *
 * It stays, swaying gently, until the app says it is ready, and never leaves
 * before the beat has finished, so a fast phone still gets the whole thing.
 * The web has the same scene in public/index.html, drawn in CSS so it shows
 * before any JavaScript arrives.
 */

import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

/** The ground of the still splash picture, so the hand-over does not flash. */
const CREAM = '#F8F6F0';
const WINE = '#5C2A33';
const WOOD = '#A67C52';
const THREAD = '#D9CFC3';

/** How long the opening beat takes. The scene never leaves before this. */
const BEAT_MS = 2300;

/** Where the hook meets the thread, as a share of the scene's height. */
const PIVOT = 0.2;

export function NimaSplash({
  ready,
  fontsReady,
  onGone,
}: {
  /** The app can take over. */
  ready: boolean;
  /** Cormorant is loaded, so the wordmark can be set in it. */
  fontsReady: boolean;
  onGone: () => void;
}) {
  const { width } = useWindowDimensions();
  const sceneW = Math.min(Math.round(width * 0.56), 220);
  const sceneH = sceneW * 1.5;

  const drop = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;
  const peek = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(1)).current;
  const [beatDone, setBeatDone] = useState(false);
  const left = useRef(false);

  useEffect(() => {
    // We are drawing now, so the still picture can go.
    void SplashScreen.hideAsync();

    const settle = Animated.sequence([
      Animated.timing(swing, { toValue: -7, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(swing, { toValue: 0, friction: 3.2, tension: 40, useNativeDriver: true }),
    ]);
    const sway = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: 2, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const bobbing = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -5, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );

    const beat = Animated.sequence([
      Animated.timing(drop, { toValue: 1, duration: 900, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }),
      Animated.parallel([
        settle,
        Animated.sequence([
          Animated.delay(600),
          Animated.timing(peek, { toValue: 1, duration: 700, easing: Easing.bezier(0.34, 1.4, 0.64, 1), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(1100),
          Animated.timing(word, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    ]);

    beat.start(({ finished }) => {
      if (!finished) return;
      setBeatDone(true);
      sway.start();
      bobbing.start();
    });

    return () => {
      beat.stop();
      sway.stop();
      bobbing.stop();
    };
  }, [drop, swing, peek, bob, word]);

  useEffect(() => {
    if (!ready || !beatDone || left.current) return;
    left.current = true;
    Animated.timing(leave, {
      toValue: 0,
      duration: 350,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(onGone);
  }, [ready, beatDone, leave, onGone]);

  // Rotate about the hook rather than the middle of the scene.
  const pivot = sceneH * (0.5 - PIVOT);
  const hangerStyle = {
    transform: [
      { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-sceneH * 1.2, 0] }) },
      { translateY: -pivot },
      { rotate: swing.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
      { translateY: pivot },
    ],
  };

  const peekW = sceneW * 0.64;
  const peekStyle = {
    opacity: peek,
    transform: [
      { translateY: peek.interpolate({ inputRange: [0, 1], outputRange: [sceneW * 0.32, 0] }) },
      { translateY: bob },
    ],
  };

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root, { opacity: leave }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={{ width: sceneW, height: sceneH }}>
        <Animated.View
          style={[
            { position: 'absolute', right: -peekW * 0.5, bottom: -sceneW * 0.055, width: peekW, height: peekW },
            peekStyle,
          ]}
        >
          <Image source={require('../../assets/mascot-peek.webp')} style={{ width: '100%', height: '100%' }} contentFit="contain" />
        </Animated.View>

        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: sceneW, height: sceneH }, hangerStyle]}>
          <Svg width={sceneW} height={sceneH} viewBox="0 0 200 300">
            <Line x1={100} y1={0} x2={100} y2={58} stroke={THREAD} strokeWidth={1.2} />
            <Path d="M100 70 V60 C100 50 88 50 88 58" fill="none" stroke={WOOD} strokeWidth={3} strokeLinecap="round" />
            <Path d="M100 70 L38 104 Q34 108 40 110 L160 110 Q166 108 162 104 Z" fill={WOOD} />
            <Path d="M72 106 Q100 116 128 106 C130 124 124 140 120 150 C150 190 158 236 158 268 Q100 288 42 268 C42 236 50 190 80 150 C76 140 70 124 72 106 Z" fill={WINE} />
          </Svg>
        </Animated.View>
      </Animated.View>

      {fontsReady ? (
        <Animated.View
          style={{
            marginTop: 18,
            opacity: word,
            transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
          }}
        >
          <Text style={styles.word}>Nima</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  word: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -0.4,
    color: WINE,
  },
});
