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

  if (__DEV__ && Platform.OS !== 'web') {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    if (host) return `http://${host}:3333`;
  }

  return 'http://localhost:3333';
})();
