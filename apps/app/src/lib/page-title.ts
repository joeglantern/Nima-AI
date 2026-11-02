/**
 * The browser tab's title, per screen.
 *
 * Shared links and open tabs should say what they are: "Dinner at eight,
 * Nima" rather than the same words for every page. Native has no tab, so
 * this does nothing there.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';

const SUFFIX = 'Nima';

/** The same thing as an element, for screens that only know the title once data has loaded. */
export function PageTitle({ title }: { title?: string | null }): null {
  usePageTitle(title);
  return null;
}

export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const clean = title?.trim();
    document.title = clean && clean !== SUFFIX ? `${clean}, ${SUFFIX}` : 'Nima, your stylist';
  }, [title]);
}
