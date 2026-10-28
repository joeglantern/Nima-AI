/**
 * A post in For You.
 *
 * The shape people already know how to read from Instagram: who posted it,
 * the photograph edge to edge, a row of actions, the count, the caption,
 * then the comments. What makes it Nima's is in the details: the stylist's
 * line in the serif under every look, "Shop the pieces" on the photograph
 * itself, and "Try it on" where a follow button would be.
 *
 * Love and save answer at once and settle with the server afterwards, so
 * the heart fills on the tap and not a round trip later. A double tap on
 * the photograph loves it, and never takes the love away.
 */

import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ApiError, api, type LookCardData } from '../lib/api';
import { compactCount, timeAgo } from '../lib/time';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Body, BodyStrong, Caption, Micro } from './text';
import { useTryOnAvailable } from './try-on';

const BLUR = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';
const DOUBLE_TAP_MS = 260;

/** Captions on seeded looks end with the photographer's credit. */
function splitCredit(caption: string | null): { text: string | null; credit: string | null } {
  if (!caption) return { text: null, credit: null };
  const at = caption.lastIndexOf('\n\nPhoto: ');
  if (at < 0) return { text: caption, credit: null };
  return { text: caption.slice(0, at).trim() || null, credit: caption.slice(at + 2).trim() };
}

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

function Icon({
  name,
  color,
  filled = false,
  size = 25,
}: {
  name: 'heart' | 'comment' | 'send' | 'bookmark' | 'bag' | 'badge' | 'sparkle' | 'hanger';
  color: string;
  filled?: boolean;
  size?: number;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: filled ? color : 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'heart' ? (
        <Path
          d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"
          {...stroke}
        />
      ) : name === 'comment' ? (
        <Path d="M20 12a7 7 0 0 1-9.9 6.4L5 20l1.6-4.6A7 7 0 1 1 20 12Z" {...stroke} fill="none" />
      ) : name === 'send' ? (
        <Path d="M21 4 3 11l7 2.5L21 4Zm0 0-7.5 16-3.5-6.5" {...stroke} fill="none" />
      ) : name === 'bookmark' ? (
        <Path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" {...stroke} />
      ) : name === 'bag' ? (
        <Path
          d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Zm3 0V6a3 3 0 0 1 6 0v2"
          {...stroke}
          fill="none"
        />
      ) : name === 'hanger' ? (
        <Path
          d="M12 7.5a2 2 0 1 1 2 2c-1.1 0-2 .6-2 1.7v.8m0 0-8.2 5.6c-.8.5-.5 1.4.4 1.4h15.6c.9 0 1.2-.9.4-1.4L12 12Z"
          {...stroke}
          fill="none"
          strokeWidth={2}
        />
      ) : name === 'sparkle' ? (
        <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill={color} />
      ) : (
        <>
          <Path
            d="M12 2l2.4 2.1 3.2-.3.7 3.1 2.8 1.6-1.3 2.9 1.3 2.9-2.8 1.6-.7 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.7-3.1-2.8-1.6L4.2 12 2.9 9.1l2.8-1.6.7-3.1 3.2.3z"
            fill={color}
          />
          <Path
            d="M8.5 12.2l2.3 2.3 4.7-4.8"
            stroke="#FFFFF0"
            strokeWidth={1.8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}

function IconButton({
  label,
  caption,
  active = false,
  onPress,
  children,
}: {
  label: string;
  /** The word under the icon. Without one it is a bare icon. */
  caption?: string;
  active?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        ...(caption ? { flex: 1, paddingVertical: 6, gap: 3 } : { width: 42, height: 42 }),
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      {children}
      {caption ? (
        <Micro
          numberOfLines={1}
          style={{
            fontSize: 12,
            lineHeight: 15,
            color: active ? colors.accent : colors.ink,
            fontFamily: active ? 'DMSans_600SemiBold' : 'DMSans_500Medium',
          }}
        >
          {caption}
        </Micro>
      ) : null}
    </Pressable>
  );
}

export interface FeedPostProps {
  look: LookCardData;
  onPieces: (lookId: string) => void;
  onComments: (lookId: string) => void;
  onTryOn: (lookId: string) => void;
  onSend: (lookId: string) => void;
  /** The look id currently being dressed, so its button can say so. */
  dressing?: boolean;
}

export const FeedPost = memo(function FeedPost({
  look,
  onPieces,
  onComments,
  onTryOn,
  onSend,
  dressing = false,
}: FeedPostProps) {
  const { colors, radius, isWide, scheme } = useTheme();
  const router = useRouter();
  const { requireAccount } = useAuthGate();
  const canTryOn = useTryOnAvailable();

  const [liked, setLiked] = useState(look.likedByMe);
  const [likes, setLikes] = useState(look.likeCount);
  const [saved, setSaved] = useState(look.savedByMe);
  const [expanded, setExpanded] = useState(false);

  // A refetch brings the server's view; take it.
  useEffect(() => {
    setLiked(look.likedByMe);
    setLikes(look.likeCount);
    setSaved(look.savedByMe);
  }, [look.likedByMe, look.likeCount, look.savedByMe]);

  const like = useMutation({
    mutationFn: () => api.likeLook(look.id),
    onSuccess: (result) => {
      setLiked(result.liked);
      setLikes(result.likeCount);
    },
    onError: (error) => {
      setLiked(look.likedByMe);
      setLikes(look.likeCount);
      if (error instanceof ApiError && error.needsAccount) {
        requireAccount('Create an account to save what you love');
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

  const toggleLike = () => {
    setLiked(!liked);
    setLikes(likes + (liked ? -1 : 1));
    like.mutate();
  };

  // The heart that blooms over the photograph on a double tap.
  const bloom = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (singleTap.current) clearTimeout(singleTap.current);
    },
    [],
  );

  const onPhotoPress = () => {
    const now = Date.now();

    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (singleTap.current) clearTimeout(singleTap.current);
      if (!liked) toggleLike();
      bloom.setValue(0);
      Animated.sequence([
        Animated.spring(bloom, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
        Animated.delay(350),
        Animated.timing(bloom, { toValue: 2, duration: 220, useNativeDriver: true }),
      ]).start();
      return;
    }

    lastTap.current = now;
    singleTap.current = setTimeout(() => {
      router.push({ pathname: '/look/[id]', params: { id: look.id } });
    }, DOUBLE_TAP_MS);
  };

  const curated = !look.author;
  const name = look.author?.displayName ?? 'Nima Edit';
  const { text, credit } = splitCredit(look.caption);
  const ratio = look.image?.width && look.image.height ? look.image.width / look.image.height : 0.8;

  const openAuthor = () => {
    if (look.author) {
      router.push({ pathname: '/u/[handle]', params: { handle: look.author.handle } });
    }
  };

  return (
    <View style={{ paddingBottom: 18 }}>
      {/* Who */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Pressable
          onPress={openAuthor}
          disabled={curated}
          accessibilityRole={curated ? undefined : 'link'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
        >
          <Avatar url={look.author?.avatar?.url} name={name} nima={curated} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <BodyStrong numberOfLines={1} style={{ fontSize: 14, lineHeight: 18, flexShrink: 1 }}>
                {name}
              </BodyStrong>
              {curated ? <Icon name="badge" color={colors.accent} size={14} /> : null}
            </View>
            <Caption numberOfLines={1} style={{ fontSize: 12, lineHeight: 16 }}>
              {curated ? 'Picked by your stylist' : `@${look.author?.handle}`}
            </Caption>
          </View>
        </Pressable>

        {look.canRecreate && canTryOn ? (
          <Pressable
            onPress={() => onTryOn(look.id)}
            disabled={dressing}
            accessibilityRole="button"
            accessibilityLabel={`Try ${look.title ?? 'this look'} on`}
            style={({ pressed }) => ({
              height: 32,
              paddingHorizontal: 13,
              borderRadius: radius.pill,
              backgroundColor: colors.primarySoft,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              opacity: pressed || dressing ? 0.7 : 1,
            })}
          >
            <Icon name="hanger" color={colors.primary} size={15} />
            <BodyStrong style={{ fontSize: 13, lineHeight: 17, color: colors.primary }}>
              {dressing ? 'Dressing you' : 'Try it on'}
            </BodyStrong>
          </Pressable>
        ) : null}
      </View>

      {/* The photograph */}
      <Pressable
        onPress={onPhotoPress}
        accessibilityLabel={look.title ?? 'A look on Nima'}
        accessibilityHint="Double tap to love it"
      >
        <View
          style={{
            width: '100%',
            aspectRatio: Math.min(1, Math.max(0.8, ratio)),
            backgroundColor: colors.sunk,
            borderRadius: isWide ? radius.image : 0,
            overflow: 'hidden',
          }}
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

          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: bloom.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
              transform: [
                {
                  scale: bloom.interpolate({ inputRange: [0, 1, 2], outputRange: [0.4, 1, 1.15] }),
                },
              ],
            }}
          >
            <Icon name="heart" color="#FFFFF0" filled size={96} />
          </Animated.View>

          {look.itemCount > 0 ? (
            <Pressable
              onPress={() => onPieces(look.id)}
              accessibilityRole="button"
              accessibilityLabel={`Shop the ${look.itemCount} pieces`}
              style={({ pressed }) => ({
                position: 'absolute',
                left: 12,
                bottom: 12,
                height: 34,
                paddingLeft: 10,
                paddingRight: 13,
                borderRadius: 999,
                backgroundColor: 'rgba(29, 22, 18, 0.62)',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Icon name="bag" color="#FFFFF0" size={16} />
              <BodyStrong style={{ fontSize: 13, lineHeight: 17, color: '#FFFFF0' }}>
                {`Shop ${look.itemCount} ${look.itemCount === 1 ? 'piece' : 'pieces'}`}
              </BodyStrong>
            </Pressable>
          ) : null}
        </View>
      </Pressable>

      {/* What you can do */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingHorizontal: 8,
          paddingTop: 6,
          paddingBottom: 4,
        }}
      >
        <IconButton
          label={liked ? 'Loved' : 'Love it'}
          caption={liked ? 'Loved' : 'Love it'}
          active={liked}
          onPress={toggleLike}
        >
          <Icon name="heart" color={liked ? colors.accent : colors.ink} filled={liked} size={25} />
        </IconButton>
        <IconButton label="Comments" caption="Comment" onPress={() => onComments(look.id)}>
          <Icon name="comment" color={colors.ink} size={24} />
        </IconButton>
        <IconButton label="Send to a friend" caption="Send" onPress={() => onSend(look.id)}>
          <Icon name="send" color={colors.ink} size={23} />
        </IconButton>
        <IconButton
          label={saved ? 'Saved' : 'Save'}
          caption={saved ? 'Saved' : 'Save'}
          active={saved}
          onPress={() => {
            setSaved(!saved);
            save.mutate();
          }}
        >
          <Icon
            name="bookmark"
            color={saved ? colors.accent : colors.ink}
            filled={saved}
            size={23}
          />
        </IconButton>
      </View>

      {/* What it is */}
      <View style={{ paddingHorizontal: 14, gap: 6 }}>
        {likes > 0 ? (
          <BodyStrong style={{ fontSize: 14, lineHeight: 18 }}>
            {`${compactCount(likes)} ${likes === 1 ? 'love' : 'loves'}`}
          </BodyStrong>
        ) : null}

        {look.title || text ? (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Show more'}
          >
            <Body numberOfLines={expanded ? undefined : 2} style={{ fontSize: 14, lineHeight: 20 }}>
              {look.title ? (
                <BodyStrong
                  style={{ fontSize: 14, lineHeight: 20 }}
                >{`${look.title}  `}</BodyStrong>
              ) : null}
              {text}
            </Body>
            {expanded && credit ? (
              <Caption style={{ fontSize: 12, marginTop: 4 }}>{credit}</Caption>
            ) : null}
          </Pressable>
        ) : null}

        {look.nimaSays ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 10,
              alignItems: 'flex-start',
              marginTop: 2,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 16,
              backgroundColor: colors.primarySoft,
            }}
          >
            <Avatar nima size={22} />
            <Body
              style={{
                flex: 1,
                fontFamily: 'CormorantGaramond_500Medium_Italic',
                fontSize: 18,
                lineHeight: 22,
                color: scheme === 'dark' ? colors.ink : colors.primary,
              }}
            >
              {look.nimaSays}
            </Body>
          </View>
        ) : null}

        <Pressable
          onPress={() => onComments(look.id)}
          accessibilityRole="button"
          style={{ paddingTop: 2 }}
        >
          <Caption style={{ fontSize: 14, lineHeight: 19 }}>
            {look.commentCount > 1
              ? `View all ${look.commentCount} comments`
              : look.commentCount === 1
                ? 'View 1 comment'
                : 'Add a comment'}
          </Caption>
        </Pressable>

        <Caption style={{ fontSize: 11.5, lineHeight: 15 }}>
          {timeAgo(look.createdAt, 'long')}
        </Caption>
      </View>
    </View>
  );
});
