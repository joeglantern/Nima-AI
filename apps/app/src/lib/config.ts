/**
 * Where the API lives.
 *
 * Its own module on purpose: both the API client and the auth client need
 * it, and importing one from the other made a cycle that broke the web
 * build.
 *
 * On a device, localhost means the phone itself, so development uses the
 * address of the machine running Metro, which Expo already knows.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const API_URL: string = (() => {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;

  /*
   * A phone can be pointed at the deployed backend while the browser on
   * this machine keeps the local one. The deployed one has no certificate
   * yet, and a browser will not keep a secure cookie over plain http to an
   * IP, so web sign in would break; the native client keeps cookies itself
   * and does not care.
   */
  const device = process.env.EXPO_PUBLIC_DEVICE_API_URL;
  if (device && Platform.OS !== 'web') return device;

  if (__DEV__ && Platform.OS !== 'web') {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    if (host) return `http://${host}:3333`;
  }

  return 'http://localhost:3333';
})();

/**
 * The API describes its pictures by where it can see them, and in
 * development that is localhost. True for the laptop and the browser on it.
 * On a phone, localhost is the phone, so every photograph, avatar and
 * try-on result failed to load and the screens fell back to their empty
 * states, while the same build looked finished in the browser.
 *
 * So on a device, any loopback address in a response is pointed at the
 * machine the API was actually reached on. The port is kept: it is the
 * same machine either way.
 */
const LOOPBACK = /^(https?:\/\/)(?:localhost|127\.0\.0\.1)(?=[:/]|$)/;

const apiHost = (() => {
  try {
    return new URL(API_URL).hostname;
  } catch {
    return 'localhost';
  }
})();

const needsRewrite = Platform.OS !== 'web' && apiHost !== 'localhost' && apiHost !== '127.0.0.1';

export function reachable<T>(value: T): T {
  if (!needsRewrite) return value;
  return rewrite(value) as T;
}

function rewrite(value: unknown): unknown {
  if (typeof value === 'string') {
    return LOOPBACK.test(value) ? value.replace(LOOPBACK, `$1${apiHost}`) : value;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = rewrite(inner);
    return out;
  }
  return value;
}
