/**
 * Did the email for this request actually get sent.
 *
 * Better Auth sends sign in codes through `runInBackgroundOrAwait`, which
 * wraps the call in a try/catch, logs whatever comes out and carries on.
 * The endpoint answers `{ success: true }` whether the mail server took the
 * message or refused the connection. For most background work that is the
 * right trade, but a sign in code is the only way into an account: a person
 * told "we sent it" who never receives one has nothing to retry and no
 * reason to.
 *
 * So the send records its own outcome here, against the request that caused
 * it, and the route that wraps Better Auth reads it afterwards and turns a
 * false success into an honest failure.
 *
 * An AsyncLocalStorage rather than a field on the request because nothing
 * in between hands the request down to the mailer, and threading one
 * through Better Auth's options is not possible.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface MailOutcome {
  attempted: boolean;
  failure: string | null;
}

const storage = new AsyncLocalStorage<MailOutcome>();

/** Run a request with somewhere for the mailer to report back to. */
export function withMailOutcome<T>(run: (outcome: MailOutcome) => Promise<T>): Promise<T> {
  const outcome: MailOutcome = { attempted: false, failure: null };
  return storage.run(outcome, () => run(outcome));
}

export function recordMailAttempt(): void {
  const outcome = storage.getStore();
  if (outcome) outcome.attempted = true;
}

export function recordMailFailure(message: string): void {
  const outcome = storage.getStore();
  if (outcome) outcome.failure = message;
}
