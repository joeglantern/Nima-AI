/**
 * Sending a look to someone.
 *
 * Sharing uses whatever the person already uses, which here is almost
 * always WhatsApp, rather than a Nima only inbox. The message comes from the
 * server so the wording stays in one place.
 */

import { Platform, Share } from 'react-native';
import { api } from './api';
import { API_URL } from './config';

export async function shareLook(lookId: string): Promise<void> {
  const link = await api.shareLink(lookId);

  if (Platform.OS === 'web') {
    const navigatorWithShare = globalThis.navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };

    if (navigatorWithShare?.share) {
      await navigatorWithShare.share({ title: 'Nima', text: link.message, url: link.url });
    } else {
      await globalThis.navigator?.clipboard?.writeText(link.url);
    }
    return;
  }

  await Share.share({ message: link.message, url: link.url });
}

/** The same for a person: their page on the web, which opens the app when it is installed. */
export async function shareProfile(handle: string, name: string): Promise<void> {
  const url = `${API_URL}/u/${handle}`;
  const message = `${name} on Nima`;

  if (Platform.OS === 'web') {
    const navigatorWithShare = globalThis.navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (navigatorWithShare?.share) {
      await navigatorWithShare.share({ title: 'Nima', text: message, url });
    } else {
      await globalThis.navigator?.clipboard?.writeText(url);
    }
    return;
  }

  await Share.share({ message: `${message} ${url}`, url });
}
