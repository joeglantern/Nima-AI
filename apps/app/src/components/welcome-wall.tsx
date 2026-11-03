/**
 * The wall behind the welcome screen.
 *
 * The product is the pitch. Instead of a character and a strapline, the
 * first screen shows what Nima is made of: the looks themselves, in
 * columns that drift upward slowly, the way Pinterest and the fashion
 * resale apps open. The wordmark and one line sit over it.
 *
 * It is decorative. Screen readers skip it, taps go through it, and it
 * holds still for anyone who has asked their phone for less motion.
 */

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { api } from '../lib/api';
import { sized } from '../lib/media';
import { useTheme } from '../theme/index';

const GAP = 6;
const RATIO = 5 / 4;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A soft fade from a colour to nothing, along one edge.
 *
 * The browser draws it as a real gradient. Native has no gradient view
 * without another package, so there it is stacked from thin bands whose
 * opacity follows the same curve; over a photograph at this size the
 * steps do not show.
 */
function Fade({
  edge,
  color,
  height,
  strength,
}: {
  edge: 'top' | 'bottom';
  color: string;
  height: `${number}%`;
  strength: number;
}) {
  const place = { position: 'absolute' as const, left: 0, right: 0, [edge]: 0, height };

  if (Platform.OS === 'web') {
    const towards = edge === 'top' ? 'bottom' : 'top';
    const backgroundImage = `linear-gradient(to ${towards}, ${rgba(color, strength)} 0%, ${rgba(color, strength * 0.55)} 40%, ${rgba(color, 0)} 100%)`;
    return <View style={[place, { backgroundImage } as object]} />;
  }

  const steps = 16;
  return (
    <View style={[place, { flexDirection: edge === 'top' ? 'column' : 'column-reverse' }]}>
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={{ flex: 1, backgroundColor: color, opacity: strength * (1 - i / steps) ** 1.5 }}
        />
      ))}
    </View>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduced(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

function Column({
  urls,
  width,
  index,
  still,
}: {
  urls: string[];
  width: number;
  index: number;
  still: boolean;
}) {
  const { colors } = useTheme();
  const tile = width * RATIO + GAP;
  const span = urls.length * tile;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still || span === 0) return;
    drift.setValue(0);
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        // Each column takes its own time, so they never read as one sheet.
        duration: 70_000 + index * 9_000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, index, span, still]);

  // Odd columns start half a tile lower, so the rows do not line up.
  const offset = index % 2 === 1 ? -tile * 0.45 : 0;
  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [offset, offset - span] });

  // Drawn twice, end to end, so the loop has something to scroll into.
  const sequence = [...urls, ...urls];

  return (
    <Animated.View style={{ width, transform: [{ translateY }] }}>
      {sequence.map((url, i) => (
        <View
          key={`${url}-${i}`}
          style={{
            width,
            height: width * RATIO,
            marginBottom: GAP,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: colors.espresso,
          }}
        >
          <Image
            // Small tiles on a phone get the small rendition; the wall is
            // a backdrop, not somewhere anyone inspects a hem.
            source={{ uri: sized(url, width <= 140 ? 240 : 480) }}
            contentFit="cover"
            transition={400}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      ))}
    </Animated.View>
  );
}

export function WelcomeWall({ hidden = false }: { hidden?: boolean }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();

  const feed = useQuery({
    queryKey: ['welcome-wall'],
    queryFn: () => api.feed({ surface: 'foryou', limit: 15 }),
    staleTime: 10 * 60_000,
  });

  const urls = useMemo(() => {
    const items = feed.data?.items ?? [];
    const out: string[] = [];
    for (const item of items) {
      if (item.kind === 'look' && item.look.image?.url) out.push(item.look.image.url);
    }
    return out;
  }, [feed.data]);

  const columns = Math.max(3, Math.min(6, Math.floor(width / 150)));
  const tileWidth = (width - GAP * (columns - 1)) / columns;

  // Deal the looks round the columns, then make sure each column is long
  // enough to cover the screen with room to drift.
  const dealt = useMemo(() => {
    const cols: string[][] = Array.from({ length: columns }, () => []);
    urls.forEach((url, i) => cols[i % columns]?.push(url));
    const need = Math.ceil(height / (tileWidth * RATIO + GAP)) + 1;
    return cols.map((col) => {
      if (col.length === 0) return col;
      const filled = [...col];
      while (filled.length < need) filled.push(...col);
      return filled;
    });
  }, [columns, height, tileWidth, urls]);

  if (hidden || urls.length === 0) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.espresso }]} />;
  }

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.espresso, overflow: 'hidden' }]}
    >
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {dealt.map((col, i) => (
          <Column key={i} urls={col} width={tileWidth} index={i} still={still} />
        ))}
      </View>

      {/*
        Three scrims. A light even tint over everything, so the photographs
        sit back and the cream type sits forward. Then a fade at the top for
        the wordmark, and a deeper one at the bottom that carries the photos
        down into the sheet, so the sheet rises out of the wall rather than
        being laid across it.
      */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.espresso, opacity: 0.3 }]} />
      <Fade edge="top" color={colors.espresso} height="32%" strength={0.78} />
      <Fade edge="bottom" color={colors.espresso} height="48%" strength={0.98} />
    </View>
  );
}
