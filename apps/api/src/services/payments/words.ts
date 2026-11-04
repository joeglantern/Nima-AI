/**
 * The words around a payment that every provider shares.
 *
 * What a buyer reads when M-Pesa says no, and what is kept out of the logs
 * and the stored payloads. Provider files import from here so the house
 * voice is one voice whichever aggregator is behind it.
 */

/**
 * Turns whatever the provider or the network said into something a buyer can act
 * on. The exact M-Pesa wording is not documented, so this reads the gateway
 * response code first (documented for cards) and falls back to the words.
 */
export function describeFailure(...texts: Array<string | null | undefined>): string {
  const said = texts.filter(Boolean).join(' ').toLowerCase();

  if (/insufficient|not enough|balance/.test(said)) {
    return 'There was not enough in that M-Pesa account. Top up or use another number, then try again.';
  }
  if (/pin/.test(said)) {
    return 'The M-Pesa PIN was not accepted. Try again and enter your PIN carefully.';
  }
  if (/time ?out|timed out|expired|too late|abandon|no response|did not respond/.test(said)) {
    return 'The M-Pesa prompt timed out before a PIN was entered. Try again and keep your phone close.';
  }
  if (/cancel/.test(said)) {
    return 'The M-Pesa prompt was cancelled. Try again when you are ready.';
  }
  if (/lock subscriber|already in process|in progress|busy/.test(said)) {
    return 'Your phone is still busy with another M-Pesa request. Finish it or wait a minute, then try again.';
  }
  if (/invalid phone|phone number|unreachable|not registered|subscriber/.test(said)) {
    return 'That number could not get an M-Pesa prompt. Check the number is on M-Pesa and try again.';
  }
  if (/limit|declin|not permitted|restricted/.test(said)) {
    return 'M-Pesa declined this payment. Check your M-Pesa limits or use another number, then try again.';
  }
  return 'That M-Pesa payment did not go through. Try again, or use another number.';
}

/** 2547XXXXXXXX with the middle hidden, for logs. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 4)}${'*'.repeat(digits.length - 6)}${digits.slice(-2)}`;
}

/**
 * A copy of a webhook payload that is safe to keep: phone numbers masked and
 * reusable card tokens dropped. The amounts, references and statuses that a
 * support question needs are left as they were.
 */
export function redactPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\+?254\d{9}\b|\b0[17]\d{8}\b/g, (match) => maskPhone(match) ?? '***');
  }
  // Safaricom sends the payer's number as a number, not a string.
  if (typeof value === 'number' && /^254[17]\d{8}$/.test(String(value))) {
    return maskPhone(String(value));
  }
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'authorization_code' || key === 'signature') continue;
      out[key] = redactPayload(entry);
    }
    return out;
  }
  return value;
}
