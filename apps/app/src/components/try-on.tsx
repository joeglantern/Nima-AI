/**
 * Trying something on, wherever it starts.
 *
 * A product, a look, and the pieces sheet in For You all start the same job
 * and show the same three states: working, the result, or what went wrong.
 * The result arrives on the socket rather than from polling, and the fit
 * notice always sits under it. Nima promises a picture, not a fit.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, api } from '../lib/api';
import { useServerFrame } from '../lib/realtime';
import { useTheme } from '../theme/index';
import { useAuthGate } from './auth-gate';
import { Button } from './button';
import { Sheet } from './sheet';
import { Caption, Eyebrow } from './text';

type StartBody = Parameters<typeof api.startTryOn>[0];

/** A job that has said nothing for this long is not coming back on this screen. */
const GIVE_UP_AFTER = 4 * 60_000;

/**
 * Whether try-ons can run right now. Off while no image provider is set up,
 * so nobody pays for a job that cannot finish. An older server that does
 * not send the flag is treated as on.
 */
export function useTryOnAvailable(): boolean {
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  return bootstrap.data?.features.tryOn !== false;
}

export interface TryOn {
  start: (body: StartBody) => void;
  /** True from the tap until the picture arrives. */
  busy: boolean;
  progress: string | null;
  problem: string | null;
  resultUrl: string | null;
  savedLookId: string | null;
  saving: boolean;
  keep: () => void;
  /** Close the result and get ready for another go. */
  reset: () => void;
}

export function useTryOn(accountReason = 'Create an account to try this on yourself'): TryOn {
  const queryClient = useQueryClient();
  const { requireAccount } = useAuthGate();

  const [jobId, setJobId] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [savedLookId, setSavedLookId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useServerFrame('tryon.progress', (frame) => {
    if (frame.jobId === jobId) setProgress(frame.note ?? 'Working on it');
  });

  useServerFrame('tryon.done', (frame) => {
    if (frame.jobId !== jobId) return;
    setResultUrl(frame.imageUrl);
    setSavedLookId(null);
    setProgress(null);
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
    void queryClient.invalidateQueries({ queryKey: ['tryons'] });
  });

  useServerFrame('tryon.failed', (frame) => {
    if (frame.jobId !== jobId) return;
    setJobId(null);
    setProgress(null);
    setProblem(frame.reason);
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  });

  // Stop the spinner rather than leave someone watching it for ever. The
  // job carries on, and a finished one still lands in My Store.
  useEffect(() => {
    if (!jobId || resultUrl) return;
    const timer = setTimeout(() => {
      setJobId(null);
      setProgress(null);
      setProblem(
        'This is taking longer than it should. It will appear in My Store when it is ready.',
      );
    }, GIVE_UP_AFTER);
    return () => clearTimeout(timer);
  }, [jobId, resultUrl]);

  const start = useMutation({
    mutationFn: (body: StartBody) => api.startTryOn(body),
    onMutate: () => {
      setProblem(null);
      setResultUrl(null);
    },
    onSuccess: (response) => {
      setJobId(response.job.id);
      setProgress('Nima is dressing you');
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setProblem('Something went wrong. Try again.');
      } else if (error.needsAccount) {
        requireAccount(accountReason);
      } else if (error.needsPhoto) {
        setProblem('Add a photo of yourself first, then try again.');
      } else {
        setProblem(error.message);
      }
    },
  });

  // Keeping the picture makes it a private look, with the pieces in it.
  const keep = useMutation({
    mutationFn: () => {
      if (!jobId) throw new Error('There is nothing to save yet');
      return api.publishTryOn(jobId, { visibility: 'PRIVATE' });
    },
    onSuccess: (result) => {
      setSavedLookId(result.lookId);
      void queryClient.invalidateQueries({ queryKey: ['tryons'] });
    },
    onError: (error) => {
      setProblem(error instanceof Error ? error.message : 'That did not save');
    },
  });

  return {
    start: (body) => start.mutate(body),
    busy: start.isPending || Boolean(jobId && !resultUrl),
    progress,
    problem,
    resultUrl,
    savedLookId,
    saving: keep.isPending,
    keep: () => keep.mutate(),
    reset: () => {
      // Both, or the button stays stuck on "Nima is dressing you".
      setResultUrl(null);
      setJobId(null);
      setSavedLookId(null);
    },
  };
}

/** The picture, the fit notice, and keeping it. */
export function TryOnResultSheet({ tryOn, label }: { tryOn: TryOn; label: string }) {
  const { colors, radius } = useTheme();
  const router = useRouter();
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

  return (
    <Sheet open={Boolean(tryOn.resultUrl)} onClose={tryOn.reset} title="Here you are">
      {tryOn.resultUrl ? (
        <Image
          source={{ uri: tryOn.resultUrl }}
          style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.image }}
          contentFit="cover"
          accessibilityLabel={`You wearing ${label}`}
        />
      ) : null}

      <View
        style={{
          backgroundColor: colors.secondarySoft,
          borderRadius: radius.image,
          padding: 14,
          gap: 4,
          marginTop: 8,
        }}
      >
        <Eyebrow tone="secondary">{bootstrap.data?.fitNotice.title ?? 'About the fit'}</Eyebrow>
        <Caption tone="ink">
          {bootstrap.data?.fitNotice.body ??
            "Nima shows you how something looks, not how it will fit. Check the seller's size guide."}
        </Caption>
      </View>

      {tryOn.savedLookId ? (
        <Button
          label="Open it in my looks"
          onPress={() => {
            const lookId = tryOn.savedLookId ?? '';
            tryOn.reset();
            router.push({ pathname: '/look/[id]', params: { id: lookId } });
          }}
        />
      ) : (
        <Button label="Save to my looks" loading={tryOn.saving} onPress={tryOn.keep} />
      )}
      <Button
        label={tryOn.savedLookId ? 'Done' : 'Try something else'}
        variant="quiet"
        onPress={tryOn.reset}
      />
    </Sheet>
  );
}
