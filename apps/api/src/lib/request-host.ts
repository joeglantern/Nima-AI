/**
 * The host a request arrived on.
 *
 * In development the API and the bucket are configured as localhost, and
 * every media URL the API hands out says so. That is right for the browser
 * on the laptop and wrong for a phone on the same Wi-Fi, which reaches the
 * laptop by its LAN address: to the phone, localhost is the phone. Photos
 * failed to load, uploads went nowhere, and the app looked unfinished on a
 * device while looking finished in the browser.
 *
 * A signed URL cannot be fixed afterwards, because the host is part of
 * what is signed. So storage asks here which host the caller used and signs
 * for that one. Outside a request, or when the request itself came in on
 * localhost, nothing changes.
 *
 * An AsyncLocalStorage rather than a parameter because presenters build
 * URLs several calls away from anything that holds the request.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

/** Run the rest of a request knowing the host it came in on. */
export function runWithRequestHost(hostname: string, next: () => void): void {
  storage.run(hostname, next);
}

/**
 * The host to put in a URL in place of a configured loopback one, or null
 * to leave the URL as configured.
 */
export function substituteHost(configured: URL): string | null {
  if (!isLoopbackHost(configured.hostname)) return null;

  const caller = storage.getStore();
  if (!caller || isLoopbackHost(caller)) return null;

  return caller;
}

/** `configured` with its loopback host swapped for the caller's, if needed. */
export function reachableUrl(configured: string): string {
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return configured;
  }

  const host = substituteHost(url);
  if (!host) return configured;

  url.hostname = host;
  // URL keeps a trailing slash on a bare origin; the caller's string did not
  // necessarily have one.
  return configured.endsWith('/') ? url.toString() : url.toString().replace(/\/$/, '');
}
