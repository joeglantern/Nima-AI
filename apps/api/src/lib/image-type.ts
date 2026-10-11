/**
 * What an image actually is, from its first bytes.
 *
 * A Content-Type header is a claim made by whoever sent the request, and a
 * phone is not careful about it: React Native puts its blob's type on the
 * request, which is often empty and becomes "application/octet-stream".
 * The bytes do not lie, so uploads are judged by these instead.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniffImageType(bytes: Buffer): ImageType | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(PNG)) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && HEIC_BRANDS.has(bytes.toString('ascii', 8, 12))) {
    return 'image/heic';
  }

  return null;
}
