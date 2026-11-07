/**
 * Reporting a look or a person.
 *
 * One sheet, three states: pick a reason, sending, done. The reasons are
 * whole-row targets so a thumb lands on them. Nothing asks for a note: the
 * reason is what staff act on, and a person reporting something is not in
 * the mood to write. Done says what happens next in one line and closes
 * itself on Done.
 */

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, type ReportReason } from '../lib/api';
import { useTheme } from '../theme/index';
import { Button } from './button';
import { Sheet } from './sheet';
import { Body, BodyStrong, Caption } from './text';

const REASONS: Array<{ reason: ReportReason; label: string; hint: string }> = [
  { reason: 'SPAM', label: 'Spam', hint: 'Adverts, repeats, nothing to do with fashion' },
  { reason: 'NUDITY', label: 'Nudity or sexual content', hint: 'Or anyone who looks under 18' },
  { reason: 'HATE', label: 'Hate or harassment', hint: 'Abuse aimed at a person or a group' },
  { reason: 'SCAM', label: 'Scam or fake goods', hint: 'Counterfeits, off app payments, fraud' },
  { reason: 'OTHER', label: 'Something else', hint: 'Stolen photos, impersonation, anything else' },
];

export type ReportTarget = { kind: 'look'; id: string } | { kind: 'person'; handle: string };

export interface ReportSheetProps {
  /** What is being reported. Null closes the sheet. */
  target: ReportTarget | null;
  onClose: () => void;
}

export function ReportSheet({ target, onClose }: ReportSheetProps) {
  const { colors, radius } = useTheme();
  const [done, setDone] = useState(false);

  const send = useMutation({
    mutationFn: (reason: ReportReason) =>
      target?.kind === 'look'
        ? api.reportLook(target.id, { reason })
        : api.reportPerson(target?.handle ?? '', { reason }),
    onSuccess: () => setDone(true),
  });

  // Fresh each time it opens. reset is stable across renders.
  const { reset } = send;
  useEffect(() => {
    if (target) {
      setDone(false);
      reset();
    }
  }, [target, reset]);

  const what = target?.kind === 'look' ? 'this look' : 'this person';

  return (
    <Sheet open={target !== null} onClose={onClose} title={done ? undefined : `Report ${what}`}>
      {done ? (
        <View style={{ gap: 6 }}>
          <BodyStrong>Thanks. Nima will look at this.</BodyStrong>
          <Caption>
            {target?.kind === 'look'
              ? 'It is gone from your feed. They are not told who reported it.'
              : 'They are not told who reported them. You can also block them from their profile.'}
          </Caption>
          <Button label="Done" onPress={onClose} style={{ marginTop: 10 }} />
        </View>
      ) : (
        <View style={{ gap: 4 }}>
          <Caption>What is wrong with it?</Caption>
          {REASONS.map((row) => (
            <Pressable
              key={row.reason}
              disabled={send.isPending}
              onPress={() => send.mutate(row.reason)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 56,
                justifyContent: 'center',
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: radius.card,
                backgroundColor: pressed ? colors.sunk : colors.surface,
                opacity: send.isPending && send.variables !== row.reason ? 0.5 : 1,
              })}
            >
              <Body>{row.label}</Body>
              <Caption>{row.hint}</Caption>
            </Pressable>
          ))}
          {send.isPending ? <Caption align="center">Sending</Caption> : null}
          {send.isError ? (
            <Body tone="critical" align="center">
              That did not send. Try again.
            </Body>
          ) : null}
          <Button label="Cancel" variant="quiet" onPress={onClose} />
        </View>
      )}
    </Sheet>
  );
}
