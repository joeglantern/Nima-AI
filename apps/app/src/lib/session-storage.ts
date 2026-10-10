/**
 * Where the session is kept.
 *
 * On a phone it belongs in the keychain, which is what expo-secure-store
 * gives us. On the web that module does not exist, so the browser's own
 * storage is used instead. Same three methods either way, so the auth client
 * does not need to care.
 *
 * Reads and writes are wrapped: private browsing, a cleared site and a locked
 * keychain all throw, and none of them should crash the app. A missing
 * session just means signing in again.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SessionStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
  /** The auth client reads the session synchronously while booting. */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const webStorage: SessionStorage = {
  async getItemAsync(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItemAsync(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage is blocked. The session lasts for this tab only.
    }
  },
  async deleteItemAsync(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage is blocked.
    }
  },
};

const nativeStorage: SessionStorage = {
  async getItemAsync(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async setItemAsync(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // The keychain can refuse while the device is locked.
    }
  },
  async deleteItemAsync(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Nothing to do.
    }
  },
  getItem(key) {
    try {
      return SecureStore.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      SecureStore.setItem(key, value);
    } catch {
      // The keychain can refuse while the device is locked.
    }
  },
};

export const sessionStorage: SessionStorage = Platform.OS === 'web' ? webStorage : nativeStorage;
