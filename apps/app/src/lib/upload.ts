/**
 * Getting a picked image into storage.
 *
 * Three screens upload a photo and each used to do it by hand. One of the
 * differences between them was the bug: the type sent with the bytes came
 * from the blob, and on a phone that blob often does not know what it is.
 * React Native then puts "application/octet-stream" on the request whatever
 * the headers say, and the server refused it.
 *
 * The type now comes from the picker, which does know, and is stamped onto
 * the blob itself so the request carries it.
 */

import type { ImagePickerAsset } from 'expo-image-picker';
import { api } from './api';

export type UploadPurpose = 'AVATAR' | 'USER_PHOTO' | 'WARDROBE_ITEM' | 'QUICK_TRY_ON';

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

function typeOf(asset: ImagePickerAsset, blob: Blob): ImageType {
  const hinted = (asset.mimeType ?? blob.type ?? '').toLowerCase();
  if (hinted === 'image/jpeg' || hinted === 'image/jpg') return 'image/jpeg';
  if (hinted === 'image/png' || hinted === 'image/webp' || hinted === 'image/heic') return hinted;
  if (hinted === 'image/heif') return 'image/heic';

  const name = (asset.fileName ?? asset.uri).toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';

  // The picker re-encodes to JPEG whenever it is asked for a quality.
  return 'image/jpeg';
}

/** Uploads the picture and returns where it now lives. Throws with a sentence a person can read. */
export async function uploadImage(
  asset: ImagePickerAsset,
  purpose: UploadPurpose,
): Promise<{ storageKey: string }> {
  const raw = await (await fetch(asset.uri)).blob();
  const contentType = typeOf(asset, raw);
  const body = raw.slice(0, raw.size, contentType);

  const ticket = await api.createUpload({ purpose, contentType, size: raw.size });

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { ...ticket.headers, 'Content-Type': contentType },
    body,
  });

  if (!put.ok) throw new Error(await explain(put));

  return { storageKey: ticket.storageKey };
}

async function explain(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not the API's error shape. The status will have to do.
  }
  return response.status === 413 ? 'That picture is too large' : 'That picture did not upload';
}
