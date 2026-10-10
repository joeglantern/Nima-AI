/**
 * The two cards the app is mostly made of.
 *
 * ProductCard fills the shop grid. LookCard is the full bleed card in For
 * You, with the three actions underneath and the line of stylist copy, as in
 * the screens.
 */

import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { FeedItem, ProductCard as ProductCardData } from '../lib/api';
import { useTheme } from '../theme/index';
import { Body, Caption, Eyebrow, Micro, Price } from './text';

type LookCardData = Extract<FeedItem, { kind: 'look' }>['look'];

/** A soft placeholder while the photo loads, in the brand ground colour. */
const BLUR = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';

/**
 * The shop grid in `Design/2.png` is a masonry: tiles share a width and keep
 * their own height, so a long coat is taller than a pair of sunglasses and
 * the two columns never line up. The shape comes from the photograph itself
 * when the uploader gave us its size, clamped so one odd crop cannot leave a
 * column metres taller than its neighbour.
 */
const TALLEST = 0.62; // 5:8
const WIDEST = 0.9; // close to square

function tileRatio(image: { width: number | null; height: number | null } | null): number {
  if (image?.width && image.height) {
    return Math.min(WIDEST, Math.max(TALLEST, image.width / image.height));
  }
  return 3 / 4;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const { colors, radius } = useTheme();

  return (
    <Link href={{ pathname: '/product/[id]', params: { id: product.id } }} asChild>
      <Pressable style={{ gap: 8 }} accessibilityRole="link">
        <View
          style={{
            borderRadius: radius.image,
            overflow: 'hidden',
            backgroundColor: colors.sunk,
            aspectRatio: tileRatio(product.image),
          }}
        >
          {product.image ? (
            <Image
              source={{ uri: product.image.url }}
              placeholder={{ blurhash: BLUR }}
              contentFit="cover"
              transition={180}
              style={{ width: '100%', height: '100%' }}
              accessibilityLabel={product.title}
            />
          ) : null}

          {product.promoted ? (
            <View
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                backgroundColor: colors.ground,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: radius.pill,
              }}
            >
              <Micro>Promoted</Micro>
            </View>
          ) : null}
        </View>

        <View style={{ gap: 2 }}>
          <Body numberOfLines={1}>{product.title}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Price cents={product.priceFromCents} />
            {!product.inStock ? <Caption tone="critical">Sold out</Caption> : null}
          </View>
          <Caption numberOfLines={1}>{product.store.name}</Caption>
        </View>
      </Pressable>
    </Link>
  );
}

function ActionIcon({
  name,
  filled,
  color,
}: {
  name: 'heart' | 'bookmark' | 'comment';
  filled: boolean;
  color: string;
}) {
  const common = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: filled ? color : 'none',
  };

  if (name === 'heart') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path
          d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"
          {...common}
        />
      </Svg>
    );
  }

  if (name === 'bookmark') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" {...common} />
      </Svg>
    );
  }

  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M20 12a7 7 0 0 1-9.9 6.4L5 20l1.6-4.6A7 7 0 1 1 20 12Z" {...common} fill="none" />
    </Svg>
  );
}

export interface LookCardProps {
  look: LookCardData;
  onLike?: () => void;
  onSave?: () => void;
  onComment?: () => void;
  /** Full bleed in the feed, contained in a grid. */
  variant?: 'feed' | 'grid';
}

export function LookCard({ look, onLike, onSave, onComment, variant = 'feed' }: LookCardProps) {
  const { colors, radius, isWide, scheme } = useTheme();
  const feed = variant === 'feed';

  return (
    <View style={{ gap: 14 }}>
      <Link href={{ pathname: '/look/[id]', params: { id: look.id } }} asChild>
        <Pressable accessibilityRole="link">
          <View
            style={{
              borderRadius: radius.image,
              overflow: 'hidden',
              backgroundColor: colors.sunk,
              aspectRatio: feed ? 4 / 5 : 3 / 4,
              maxHeight: feed && isWide ? 620 : undefined,
            }}
          >
            {look.image ? (
              <Image
                source={{ uri: look.image.url }}
                placeholder={{ blurhash: BLUR }}
                contentFit="cover"
                transition={200}
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel={look.title ?? 'A look on Nima'}
              />
            ) : null}
          </View>
        </Pressable>
      </Link>

      {feed ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
            <ActionChip
              label={look.likedByMe ? 'Loved' : 'Love it'}
              tint="love"
              icon={<ActionIcon name="heart" filled={look.likedByMe} color={colors.accent} />}
              onPress={onLike}
            />
            <ActionChip
              label={look.savedByMe ? 'Saved' : 'Save'}
              tint="save"
              icon={<ActionIcon name="bookmark" filled={look.savedByMe} color={colors.primary} />}
              onPress={onSave}
            />
            <ActionChip
              label="Comments"
              tint="comment"
              icon={<ActionIcon name="comment" filled={false} color={colors.secondary} />}
              onPress={onComment}
            />
          </View>

          {look.nimaSays ? (
            <View style={{ gap: 2 }}>
              <Eyebrow>Nima Says</Eyebrow>
              {/*
                The screens tint the stylist's line towards the burgundy so
                it reads as Nima speaking. In dark mode the burgundy is
                already a light rose, and tinting the paragraph too would
                leave it floating, so there it stays as ordinary text.
              */}
              <Body style={{ color: scheme === 'dark' ? colors.ink : colors.primary }}>
                {look.nimaSays}
              </Body>
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 2 }}>
          {look.title ? <Body numberOfLines={1}>{look.title}</Body> : null}
          <Caption>{`${look.itemCount} ${look.itemCount === 1 ? 'piece' : 'pieces'}`}</Caption>
        </View>
      )}
    </View>
  );
}

/**
 * One of the three actions under a look.
 *
 * `Design/5.png` draws them as small rounded squares with a soft fill rather
 * than outlines, each tinted towards its own meaning: rose for love, a warm
 * neutral for saved, sand for comments.
 */
function ActionChip({
  label,
  icon,
  tint,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  tint: 'love' | 'save' | 'comment';
  onPress?: () => void;
}) {
  const { colors, radius } = useTheme();

  const fill =
    tint === 'love' ? colors.accentSoft : tint === 'save' ? colors.sunk : colors.secondarySoft;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: radius.chip,
        backgroundColor: fill,
        opacity: pressed ? 0.75 : 1,
        minWidth: 84,
      })}
    >
      {icon}
      <Micro tone="ink">{label}</Micro>
    </Pressable>
  );
}
