/**
 * Theme and layout context.
 *
 * Two things every screen needs: the palette for the current colour scheme,
 * and how wide the window is. Both change at runtime, so both live in one
 * hook rather than being read from the device in each component.
 */

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme, useWindowDimensions } from 'react-native';
import { breakpoint, dark, light, type Palette, radius, space, type } from './tokens';

export type Layout = 'phone' | 'tablet' | 'desktop';

interface Theme {
  colors: Palette;
  scheme: 'light' | 'dark';
  type: typeof type;
  radius: typeof radius;
  space: typeof space;
  layout: Layout;
  /** True on a phone sized window, whatever the device actually is. */
  isCompact: boolean;
  isWide: boolean;
  width: number;
  /** Side padding for the current width. */
  gutter: number;
  /** Columns for the shop grid at this width. */
  gridColumns: number;
  /**
   * How much room to leave at the bottom of a scrolling screen.
   *
   * The Ask Nima button floats over everything. Without this the last row of
   * a grid sits underneath it, which is the single most common way a mobile
   * layout looks unfinished.
   */
  floatingClearance: number;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { width } = useWindowDimensions();

  const value = useMemo<Theme>(() => {
    const layout: Layout =
      width >= breakpoint.desktop ? 'desktop' : width >= breakpoint.tablet ? 'tablet' : 'phone';

    return {
      colors: scheme === 'dark' ? dark : light,
      scheme,
      type,
      radius,
      space,
      layout,
      isCompact: layout === 'phone',
      isWide: layout !== 'phone',
      width,
      gutter: layout === 'phone' ? 16 : 24,
      gridColumns: layout === 'desktop' ? (width >= 1600 ? 5 : 4) : layout === 'tablet' ? 3 : 2,
      floatingClearance: 96,
    };
  }, [scheme, width]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}

export type { Palette };
export { breakpoint, dark, light, radius, space, type };
