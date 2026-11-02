/**
 * A post in For You.
 *
 * The outfit comes first and whoever posted it is small print. The pieces
 * live on the photograph rather than in a list under it, so a whole post fits
 * on one phone screen: the tag opens a card on the photo with each piece's
 * picture, name and price.
 *
 * The four actions are their own objects, with the word curving along the top
 * edge: a heart, a speech bubble, a paper plane and a hanger. Love and hang
 * answer at once and settle with the server afterwards. Counts of loves stay
 * off the page, so nobody is judged by a number.
 */

import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import Svg, { Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { ApiError, api, type LookCardData } from '../lib/api';
import { useSignedIn } from '../lib/social';
import { timeAgo } from '../lib/time';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Button } from './button';
import { Body, BodyStrong, Caption, Price } from './text';

const BLUR = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';
const DOUBLE_TAP_MS = 260;

/** Wide enough to set the photo and its details side by side. */
const SPREAD_FROM = 860;

const tick = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync();
};

const shillings = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString('en-KE')}`;

const totalOf = (look: LookCardData) =>
  look.pieces.reduce((sum, piece) => sum + (piece.priceCents ?? 0), 0);

export function Avatar({
  url,
  name,
  size = 34,
  nima = false,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
  /** Nima's own monogram, for curated looks. */
  nima?: boolean;
}) {
  const { colors } = useTheme();

  if (url && !nima) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.sunk }}
        contentFit="cover"
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: nima ? colors.primary : colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Body
        style={{
          fontFamily: nima ? 'CormorantGaramond_600SemiBold' : 'DMSans_600SemiBold',
          fontSize: nima ? size * 0.6 : size * 0.42,
          lineHeight: size * 0.75,
          color: nima ? colors.onPrimary : colors.primary,
        }}
      >
        {nima ? 'N' : (name ?? '?').trim().charAt(0).toUpperCase()}
      </Body>
    </View>
  );
}

type MarkName = 'love' | 'ask' | 'send' | 'hang';

/**
 * The clips that play when an action is taken: an embroidered heart stitching
 * itself, a linen speech bubble inflating, a card tag folding into a paper
 * plane, a wooden hanger swinging. Each plays once over the drawn mark, then
 * the ones with a lasting state hold their last frame.
 */
const MOTION = {
  love: {
    clip: require('../../assets/motion/heart.webp'),
    still: require('../../assets/motion/heart-still.webp'),
    size: 52,
    top: 13,
  },
  ask: { clip: require('../../assets/motion/bubble.webp'), still: null, size: 56, top: 11 },
  send: { clip: require('../../assets/motion/plane.webp'), still: null, size: 58, top: 8 },
  hang: {
    clip: require('../../assets/motion/hanger.webp'),
    still: require('../../assets/motion/hanger-still.webp'),
    size: 62,
    top: 6,
  },
} as const;

/** A little longer than the clips, so the last frame is on screen before the swap. */
const CLIP_MS = 2700;

function Motion({
  name,
  playingSince,
  on,
}: {
  name: MarkName;
  /** When the clip was last started. A new value restarts it. */
  playingSince: number | null;
  /** Whether the lasting state holds once the clip has played. */
  on: boolean;
}) {
  const spec = MOTION[name];
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playingSince) return;
    setPlaying(true);
    const timer = setTimeout(() => setPlaying(false), CLIP_MS);
    return () => clearTimeout(timer);
  }, [playingSince]);

  const source = playing ? spec.clip : on ? spec.still : null;
  if (!source) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: spec.top,
        left: 36 - spec.size / 2,
        width: spec.size,
        height: spec.size,
      }}
    >
      <Image
        key={playing ? String(playingSince) : 'still'}
        source={source}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
      />
    </View>
  );
}

/** One word set along a curve. */
function Curved({ id, d, color, word }: { id: string; d: string; color: string; word: string }) {
  return (
    <>
      <Defs>
        <Path id={id} d={d} />
      </Defs>
      <SvgText fontFamily="DMSans_500Medium" fontSize={11} fill={color} textAnchor="middle">
        <TextPath href={`#${id}`} startOffset="50%">
          {word}
        </TextPath>
      </SvgText>
    </>
  );
}

function Mark({
  name,
  uid,
  color,
  on = false,
}: {
  name: MarkName;
  uid: string;
  color: string;
  on?: boolean;
}) {
  const line = { stroke: color, strokeWidth: 1.4, strokeLinejoin: 'round' as const };

  return (
    <Svg width={72} height={64} viewBox="0 0 72 64">
      {name === 'love' ? (
        <>
          <Path
            d="M36 30C32 21 20 20 18 31 16 42 30 49 36 57 42 49 56 42 54 31 52 20 40 21 36 30Z"
            {...line}
            fill={on ? color : 'none'}
          />
          <Curved id={`${uid}a`} d="M12 34C11 15 29 12 35 25" color={color} word="love" />
          <Curved id={`${uid}b`} d="M38 25C44 12 61 15 60 34" color={color} word="it" />
        </>
      ) : name === 'ask' ? (
        <>
          <Path
            d="M36 23C47 23 56 29 56 37 56 45 47 51 36 51 33 51 30 50.6 28 50L20 56 22 47C18 44 16 41 16 37 16 29 25 23 36 23Z"
            {...line}
            fill="none"
          />
          <Curved id={`${uid}a`} d="M13 36A23 19 0 0 1 59 36" color={color} word="ask" />
        </>
      ) : name === 'send' ? (
        <>
          <Path d="M12 37L60 17 46 56 35 41ZM35 41L60 17" {...line} fill="none" />
          <Curved id={`${uid}a`} d="M9 31L57 11" color={color} word="send" />
        </>
      ) : (
        <>
          <Path
            d="M36 31L11 50C8 53 9 55 13 55H59C63 55 64 53 61 50Z"
            {...line}
            fill={on ? color : 'none'}
          />
          <Path
            d="M36 31V25C36 22 41 21 41 16 41 12.5 38.8 10 36 10 33.2 10 31 12 31 15"
            {...line}
            strokeLinecap="round"
            fill="none"
          />
          <Curved id={`${uid}a`} d="M6 46L33 27" color={color} word="hang" />
          <Curved id={`${uid}b`} d="M39 27L66 46" color={color} word="it" />
        </>
      )}
    </Svg>
  );
}

function SmallHeart({ color, filled }: { color: string; filled: boolean }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}

/** A quick spring, for the moment something is chosen. */
function usePop() {
  const value = useRef(new Animated.Value(1)).current;
  const pop = () => {
    value.setValue(0.72);
    Animated.spring(value, {
      toValue: 1,
      friction: 3.5,
      tension: 180,
      useNativeDriver: true,
    }).start();
  };
  return [value, pop] as const;
}

/** Love and hang: answer at once, settle with the server afterwards. */
function useLookActions(look: LookCardData) {
  const { requireAccount } = useAuthGate();
  // A guest gets the sign in sheet straight away, with no failed request
  // and no heart that fills and empties again.
  const signedIn = useSignedIn();
  const [liked, setLiked] = useState(look.likedByMe);
  const [saved, setSaved] = useState(look.savedByMe);

  // A refetch brings the server's view; take it.
  useEffect(() => {
    setLiked(look.likedByMe);
    setSaved(look.savedByMe);
  }, [look.likedByMe, look.savedByMe]);

  const like = useMutation({
    mutationFn: () => api.likeLook(look.id),
    onSuccess: (result) => setLiked(result.liked),
    onError: (error) => {
      setLiked(look.likedByMe);
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to keep what you love');
      }
    },
  });

  const save = useMutation({
    mutationFn: () => api.saveLook(look.id),
    onSuccess: (result) => setSaved(result.saved),
    onError: (error) => {
      setSaved(look.savedByMe);
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to keep your looks');
      }
    },
  });

  return {
    liked,
    saved,
    signedIn,
    toggleLike: () => {
      if (!signedIn) {
        requireAccount('Create an account to keep what you love');
        return;
      }
      tick();
      setLiked(!liked);
      like.mutate();
    },
    toggleSave: () => {
      if (!signedIn) {
        requireAccount('Create an account to keep your looks');
        return;
      }
      tick();
      setSaved(!saved);
      save.mutate();
    },
  };
}

/** The photograph, whole. One tap opens the look, two love it. */
function Plate({
  look,
  liked,
  toggleLike,
  children,
}: {
  look: LookCardData;
  liked: boolean;
  toggleLike: () => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const lastTap = useRef(0);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (singleTap.current) clearTimeout(singleTap.current);
    },
    [],
  );

  const onPress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (singleTap.current) clearTimeout(singleTap.current);
      if (!liked) toggleLike();
      return;
    }
    lastTap.current = now;
    singleTap.current = setTimeout(() => {
      router.push({ pathname: '/look/[id]', params: { id: look.id } });
    }, DOUBLE_TAP_MS);
  };

  return (
    <View
      style={{
        width: '100%',
        aspectRatio: 0.8,
        backgroundColor: colors.sunk,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityLabel={look.title ?? 'A look on Nima'}
        accessibilityHint="Double tap to love it"
        style={{ width: '100%', height: '100%' }}
      >
        {look.image ? (
          <Image
            source={{ uri: look.image.url }}
            placeholder={{ blurhash: look.image.blurhash ?? BLUR }}
            contentFit="cover"
            transition={200}
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
      </Pressable>
      {children}
    </View>
  );
}

/** The pieces, one at a time, on the photograph itself. */
function PieceCard({
  look,
  index,
  onNext,
  onClose,
}: {
  look: LookCardData;
  index: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const { requireAccount } = useAuthGate();
  const signedIn = useSignedIn();
  const piece = look.pieces[index];
  const [loved, setLoved] = useState<Record<string, boolean>>({});
  const [scale, pop] = usePop();

  const love = useMutation({
    mutationFn: (productId: string) => api.lovePiece(productId),
    onError: (error) => {
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to keep the pieces you love');
      }
    },
  });

  if (!piece) return null;

  const isLoved = loved[piece.id] ?? piece.lovedByMe;
  const productId = piece.productId;

  return (
    <View
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        padding: 6,
        borderRadius: 12,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Pressable
        disabled={!productId}
        onPress={() => {
          if (productId) router.push({ pathname: '/product/[id]', params: { id: productId } });
        }}
        accessibilityRole="link"
        accessibilityLabel={piece.title}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        {piece.image ? (
          <Image
            source={{ uri: piece.image.url }}
            style={{ width: 44, height: 54, borderRadius: 8, backgroundColor: colors.sunk }}
            contentFit="cover"
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <BodyStrong numberOfLines={1} style={{ fontSize: 14, lineHeight: 19 }}>
            {piece.title}
          </BodyStrong>
          {piece.priceCents ? (
            <Price
              cents={piece.priceCents}
              style={{ fontSize: 13, lineHeight: 18, fontFamily: 'DMSans_400Regular' }}
            />
          ) : null}
        </View>
      </Pressable>

      {productId ? (
        <Pressable
          onPress={() => {
            if (!signedIn) {
              requireAccount('Create an account to keep the pieces you love');
              return;
            }
            tick();
            if (!isLoved) pop();
            setLoved({ ...loved, [piece.id]: !isLoved });
            love.mutate(productId);
          }}
          accessibilityRole="button"
          accessibilityLabel={isLoved ? `Stop loving ${piece.title}` : `Love ${piece.title}`}
          style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Animated.View style={{ transform: [{ scale }] }}>
            <SmallHeart color={isLoved ? colors.accent : colors.muted} filled={isLoved} />
          </Animated.View>
        </Pressable>
      ) : null}

      <Pressable
        onPress={index === look.pieces.length - 1 ? onClose : onNext}
        accessibilityRole="button"
        accessibilityLabel={index === look.pieces.length - 1 ? 'Close' : 'Next piece'}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Caption style={{ fontSize: 11, lineHeight: 14 }}>
          {index === look.pieces.length - 1 ? 'Done' : 'Next'}
        </Caption>
        <Caption style={{ fontSize: 11, lineHeight: 14 }}>
          {`${index + 1} of ${look.pieces.length}`}
        </Caption>
      </Pressable>
    </View>
  );
}

export interface FeedPostProps {
  look: LookCardData;
  onPieces: (lookId: string) => void;
  onComments: (lookId: string) => void;
  onTryOn: (lookId: string) => void;
  onSend: (lookId: string) => void;
  /** True while this look is being dressed. */
  dressing?: boolean;
}

export const FeedPost = memo(function FeedPost({
  look,
  onPieces,
  onComments,
  onSend,
}: FeedPostProps) {
  const { colors, width } = useTheme();
  const router = useRouter();
  const { liked, saved, signedIn, toggleLike, toggleSave } = useLookActions(look);
  const [piece, setPiece] = useState<number | null>(null);
  const [heartScale, popHeart] = usePop();

  // Which clips are playing, by when they started.
  const [motion, setMotion] = useState<Partial<Record<MarkName, number>>>({});
  const play = (name: MarkName) => setMotion((current) => ({ ...current, [name]: Date.now() }));

  // The hanger swings on its hook when you hang something on it.
  const sway = useRef(new Animated.Value(0)).current;
  const swing = () => {
    sway.setValue(1);
    Animated.spring(sway, {
      toValue: 0,
      friction: 2.2,
      tension: 90,
      useNativeDriver: true,
    }).start();
  };

  const curated = !look.author;
  const name = look.author?.store?.name ?? look.author?.displayName ?? 'Nima Edit';
  const total = totalOf(look);
  const spread = width >= SPREAD_FROM;

  const plate = (
    <Plate look={look} liked={liked} toggleLike={toggleLike}>
      {piece === null && look.pieces.length > 0 ? (
        <Pressable
          onPress={() => setPiece(0)}
          accessibilityRole="button"
          accessibilityLabel={`See the ${look.pieces.length} pieces`}
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 16,
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <BodyStrong style={{ fontSize: 12.5, lineHeight: 17 }}>
            {`${look.pieces.length} ${look.pieces.length === 1 ? 'piece' : 'pieces'}`}
          </BodyStrong>
        </Pressable>
      ) : null}
      {piece !== null ? (
        <PieceCard
          look={look}
          index={piece}
          onNext={() => setPiece(piece + 1)}
          onClose={() => setPiece(null)}
        />
      ) : null}
    </Plate>
  );

  const details = (
    <View style={{ flex: spread ? 1 : undefined, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body
            numberOfLines={spread ? 2 : 1}
            style={{
              fontFamily: 'CormorantGaramond_500Medium',
              fontSize: spread ? 44 : 24,
              lineHeight: spread ? 46 : 28,
            }}
          >
            {look.title ?? 'A look'}
          </Body>
          <Pressable
            disabled={curated}
            onPress={() => {
              if (look.author) {
                router.push({ pathname: '/u/[handle]', params: { handle: look.author.handle } });
              }
            }}
          >
            <Caption numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 17 }}>
              {`${name}, ${timeAgo(look.createdAt)}`}
            </Caption>
          </Pressable>
        </View>
        {!spread && look.itemCount > 0 ? (
          <Button
            full={false}
            label={total > 0 ? `Shop, ${shillings(total)}` : 'See pieces'}
            onPress={() => onPieces(look.id)}
            style={{ height: 44, paddingHorizontal: 18 }}
          />
        ) : null}
      </View>

      {spread && look.itemCount > 0 ? (
        <Button
          full={false}
          label={total > 0 ? `Shop ${look.itemCount} pieces, ${shillings(total)}` : 'See pieces'}
          onPress={() => onPieces(look.id)}
          style={{ marginTop: 24, alignSelf: 'flex-start' }}
        />
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: spread ? 'flex-start' : 'space-around',
          gap: spread ? 16 : 0,
          marginTop: spread ? 20 : 6,
        }}
      >
        <Pressable
          onPress={() => {
            if (!liked) {
              popHeart();
              if (signedIn) play('love');
            }
            toggleLike();
          }}
          accessibilityRole="button"
          accessibilityLabel={liked ? 'Loved' : 'Love it'}
          accessibilityState={{ selected: liked }}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Mark name="love" uid={`l${look.id}`} color={liked ? colors.accent : colors.ink} />
            <Motion name="love" playingSince={motion.love ?? null} on={liked} />
          </Animated.View>
        </Pressable>
        <Pressable
          onPress={() => {
            play('ask');
            onComments(look.id);
          }}
          accessibilityRole="button"
          accessibilityLabel="Ask about this look"
        >
          <View>
            <Mark name="ask" uid={`a${look.id}`} color={colors.ink} />
            <Motion name="ask" playingSince={motion.ask ?? null} on={false} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            play('send');
            onSend(look.id);
          }}
          accessibilityRole="button"
          accessibilityLabel="Send to a friend"
        >
          <View>
            <Mark name="send" uid={`s${look.id}`} color={colors.ink} />
            <Motion name="send" playingSince={motion.send ?? null} on={false} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!saved) {
              swing();
              if (signedIn) play('hang');
            }
            toggleSave();
          }}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Hung up' : 'Hang it'}
          accessibilityState={{ selected: saved }}
        >
          <Animated.View
            style={{
              transform: [
                { translateY: -18 },
                { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-14deg'] }) },
                { translateY: 18 },
              ],
            }}
          >
            <Mark name="hang" uid={`h${look.id}`} color={saved ? colors.primary : colors.ink} />
            <Motion name="hang" playingSince={motion.hang ?? null} on={saved} />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingBottom: 28,
        flexDirection: spread ? 'row' : 'column',
        alignItems: spread ? 'center' : 'stretch',
        gap: spread ? 56 : 12,
      }}
    >
      <View style={spread ? { width: '50%' } : undefined}>{plate}</View>
      {details}
    </View>
  );
});

/** The smaller page. Two of these share a row, for the pace of a magazine. */
export const FeedTile = memo(function FeedTile({ look }: { look: LookCardData }) {
  const { colors } = useTheme();
  const { liked, toggleLike } = useLookActions(look);
  const [scale, pop] = usePop();
  const total = totalOf(look);

  return (
    <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
      <Plate look={look} liked={liked} toggleLike={toggleLike}>
        <Pressable
          onPress={() => {
            if (!liked) pop();
            toggleLike();
          }}
          accessibilityRole="button"
          accessibilityLabel={liked ? 'Loved' : 'Love it'}
          accessibilityState={{ selected: liked }}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 4,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: liked ? colors.accent : colors.surface,
            }}
          >
            <Animated.View style={{ transform: [{ scale }] }}>
              <SmallHeart color={liked ? colors.onAccent : colors.ink} filled={liked} />
            </Animated.View>
          </View>
        </Pressable>
      </Plate>

      <View style={{ paddingHorizontal: 2 }}>
        {look.title ? (
          <Body
            numberOfLines={2}
            style={{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 19, lineHeight: 22 }}
          >
            {look.title}
          </Body>
        ) : null}
        {look.itemCount > 0 ? (
          <Caption numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 17 }}>
            {`${look.itemCount} ${look.itemCount === 1 ? 'piece' : 'pieces'}${
              total > 0 ? `, ${shillings(total)}` : ''
            }`}
          </Caption>
        ) : null}
      </View>
    </View>
  );
});
