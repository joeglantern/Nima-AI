/**
 * Has this person seen the welcome screen.
 *
 * Shown once. After that the app opens straight into For You, whether or not
 * they signed up, because Nima is meant to work without an account.
 */

import { sessionStorage } from './session-storage';

const KEY = 'nima.welcome-seen';

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await sessionStorage.getItemAsync(KEY)) === '1';
  } catch {
    // If storage is unavailable, do not trap anyone on the welcome screen.
    return true;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    await sessionStorage.setItemAsync(KEY, '1');
  } catch {
    // Nothing to do. It shows once more next time at worst.
  }
}
