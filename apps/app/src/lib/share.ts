/**
 * Sending a look to someone.
 *
 * Sharing uses whatever the person already uses, which here is almost
 * always WhatsApp, rather than a Nima only inbox. The message comes from the
 * server so the wording stays in one place.
 */

import { Platform, Share } from 'react-native';
import { api } from './api';

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
