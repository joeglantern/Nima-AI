/**
 * Empty states.
 *
 * The screens establish the pattern: one thin line drawing, one calm
 * sentence, no exclamation marks. The drawings are inline SVG rather than
 * image files so they take the text colour in both themes.
 */

import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/index';
import { Body } from './text';

export type EmptyArt = 'hanger' | 'book' | 'cart' | 'sparkle' | 'wardrobe';

function Art({ kind, color, size }: { kind: EmptyArt; color: string; size: number }) {
  const common = {
    stroke: color,
    // The drawings in the screens are a heavy single stroke, not a hairline.
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  switch (kind) {
    case 'hanger':
      return (
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Path d="M48 30a7 7 0 1 1 7 7c-4 0-7 2-7 6v3" {...common} />
          <Path d="M48 46 16 68c-3 2-2 6 2 6h60c4 0 5-4 2-6L48 46Z" {...common} />
        </Svg>
      );
    case 'book':
      return (
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Path
            d="M48 30c-7-5-17-7-28-6v44c11-1 21 1 28 6 7-5 17-7 28-6V24c-11-1-21 1-28 6Z"
            {...common}
          />
          <Path d="M48 30v44" {...common} />
        </Svg>
      );
    case 'cart':
      return (
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Path d="M18 22h8l8 36h36l8-26H30" {...common} />
          <Circle cx={38} cy={72} r={5} {...common} />
          <Circle cx={66} cy={72} r={5} {...common} />
        </Svg>
      );
    case 'wardrobe':
      return (
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Rect x={22} y={16} width={52} height={64} rx={6} {...common} />
          <Path d="M48 16v64M41 44v6M55 44v6" {...common} />
        </Svg>
      );
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 96 96">
          <Path d="M48 24l5 14 14 5-14 5-5 14-5-14-14-5 14-5 5-14Z" {...common} />
          <Path d="M72 56l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" {...common} />
        </Svg>
      );
  }
}

export interface EmptyStateProps {
  art?: EmptyArt;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ art = 'sparkle', message, action }: EmptyStateProps) {
  const { colors, isCompact } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        alignSelf: 'stretch',
        paddingVertical: 72,
        paddingHorizontal: 32,
        gap: 28,
      }}
    >
      {/*
        The screens give the drawing roughly a third of the width and let it
        sit pale against the background. A small icon in the middle of an
        otherwise blank screen reads as an error.
      */}
      <Art kind={art} color={colors.line} size={isCompact ? 150 : 180} />
      <Body tone="muted" align="center" style={{ maxWidth: 420 }}>
        {message}
      </Body>
      {action}
    </View>
  );
}
