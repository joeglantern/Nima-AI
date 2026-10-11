/**
 * How far someone has got with setting up.
 *
 * Nothing here is required. The list exists so a new person is shown, once
 * and then on request, the three things that make Nima work properly for
 * them: a name to be known by, some taste to go on, and a photo to dress.
 * The password is on the list because it is useful, not because it matters.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface SetupStep {
  key: 'profile' | 'style' | 'photo' | 'password';
  title: string;
  detail: string;
  href: '/profile?setup=1' | '/style' | '/photos' | '/password';
  done: boolean;
  /** The step that unlocks the most, drawn larger. */
  hero?: boolean;
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: number;
  complete: boolean;
  loading: boolean;
  /** False for a guest, who has nothing to set up yet. */
  applies: boolean;
}

export function useSetupProgress(): SetupProgress {
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const user = bootstrap.data?.user;
  const applies = Boolean(user && !user.isAnonymous);

  const profile = useQuery({ queryKey: ['profile'], queryFn: api.myProfile, enabled: applies });
  const photos = useQuery({ queryKey: ['photos'], queryFn: api.photos, enabled: applies });

  const steps: SetupStep[] = [
    {
      key: 'profile',
      title: 'Your name and handle',
      detail: 'How you appear on the looks you share',
      href: '/profile?setup=1',
      done: Boolean(user?.handle),
    },
    {
      key: 'style',
      title: 'Your style',
      detail: 'A few taps so the feed knows your taste',
      href: '/style',
      done: (user?.styleProfileCompletion ?? 0) > 0,
    },
    {
      key: 'photo',
      title: 'A photo of you',
      detail: 'The one Nima dresses. Full length, plain background, good light',
      href: '/photos',
      done: (photos.data?.items.length ?? 0) > 0,
      hero: true,
    },
    {
      key: 'password',
      title: 'A password',
      detail: 'Optional. Sign in without waiting for a code',
      href: '/password',
      done: profile.data?.hasPassword ?? false,
    },
  ];

  const done = steps.filter((step) => step.done).length;

  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    loading: applies && (profile.isLoading || photos.isLoading),
    applies,
  };
}
