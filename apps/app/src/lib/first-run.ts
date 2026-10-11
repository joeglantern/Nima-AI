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

/**
 * Has this account been shown the profile screen after signing up.
 *
 * Per account and per device, so a reload or a reinstall offers it again
 * once but moving around the app does not keep dragging people back to it.
 */
export async function hasBeenOfferedProfile(userId: string): Promise<boolean> {
  try {
    return (await sessionStorage.getItemAsync(`nima.profile-offered.${userId}`)) === '1';
  } catch {
    return true;
  }
}

export async function markProfileOffered(userId: string): Promise<void> {
  try {
    await sessionStorage.setItemAsync(`nima.profile-offered.${userId}`, '1');
  } catch {
    // Nothing to do.
  }
}
