/**
 * Kenyan phone numbers as people type them and as the screen shows them.
 *
 * The server accepts anything with the right digits in it, so the app's job
 * is only to show the number the way it reads on a SIM pack: +254 7XX XXX XXX.
 * Formatting happens as the person types, which is how banks and airlines do
 * it, so a number never looks wrong until it is wrong.
 */

/** The digits only, as the country sees them: 254 then nine digits. */
export function phoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('254')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

/** +254 7XX XXX XXX, built up as far as the digits go. */
export function formatPhone(input: string): string {
  const digits = phoneDigits(input);
  if (digits.length === 0) return '';
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  return `+254 ${parts.join(' ')}`;
}

/** A complete Safaricom, Airtel or Telkom mobile number. */
export function isPhoneComplete(input: string): boolean {
  return /^[17]\d{8}$/.test(phoneDigits(input));
}

/** What the API wants: 2547XXXXXXXX. */
export function phoneForApi(input: string): string {
  return `254${phoneDigits(input)}`;
}
