/**
 * Transactional email.
 *
 * Development points at Mailpit (http://localhost:8060), so nothing leaves the
 * machine. Production points at a real SMTP host.
 *
 * The copy lives here rather than in a template service because there are
 * only a handful of messages and they need to read like a person wrote them.
 *
 * **Every send is logged, and a refusal is loud.** A sign in code is the
 * only way into an account, so "we sent it" has to mean the server took it,
 * not that the call returned. Nodemailer reports which recipients were
 * accepted and which were rejected, and a rejection is not an error as far
 * as the protocol goes, so it has to be checked rather than assumed.
 */

import type { Env } from '@nima/config';
import { createTransport, type Transporter } from 'nodemailer';

/** Enough to find the person in a support thread, without a log full of addresses. */
function maskEmail(address: string): string {
  const [name = '', domain = ''] = address.split('@');
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

export interface MailLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export class MailNotSentError extends Error {
  constructor(
    message: string,
    readonly to: string,
  ) {
    super(message);
    this.name = 'MailNotSentError';
  }
}

/** Better Auth also emits 'change-email' when someone updates their address. */
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

export interface SendOtpInput {
  to: string;
  code: string;
  purpose: OtpPurpose;
}

export interface Mailer {
  sendOtp(input: SendOtpInput): Promise<void>;
  sendMagicLink(input: { to: string; url: string }): Promise<void>;
  sendRaw(input: { to: string; subject: string; text: string; html?: string }): Promise<void>;
  verify(): Promise<boolean>;
}

const WRAPPER = (body: string) => `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#FAF8F3;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#2B1D12">
  <div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #E4DCCF;border-radius:16px;padding:28px">
    <div style="font-size:22px;font-weight:600;color:#4A2A12;margin-bottom:18px">Nima</div>
    ${body}
    <p style="margin-top:26px;font-size:12px;color:#76665A">If you did not ask for this, you can ignore it.</p>
  </div>
</body></html>`;

export function createMailer(env: Env, log?: MailLogger): Mailer {
  const transporter: Transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    // A code nobody is waiting on is worthless, and a hung connection
    // holding the request open is worse than a clear failure.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  async function send(
    to: string,
    subject: string,
    text: string,
    html: string,
    kind: string,
  ): Promise<void> {
    const started = Date.now();

    try {
      const result = await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });

      // A server can accept the conversation and still refuse the
      // recipient. That is a successful call and a message nobody receives.
      if (result.rejected.length > 0 || result.accepted.length === 0) {
        log?.error(
          { kind, to: maskEmail(to), rejected: result.rejected, response: result.response },
          'The mail server refused the recipient',
        );
        throw new MailNotSentError('That address was refused by the mail server', to);
      }

      log?.info(
        {
          kind,
          to: maskEmail(to),
          messageId: result.messageId,
          ms: Date.now() - started,
        },
        'Email accepted by the mail server',
      );
    } catch (error) {
      if (error instanceof MailNotSentError) throw error;

      log?.error(
        {
          kind,
          to: maskEmail(to),
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          ms: Date.now() - started,
          err: error,
        },
        'Could not send an email',
      );

      throw new MailNotSentError('We could not send that email. Try again in a moment.', to);
    }
  }

  return {
    async sendOtp({ to, code, purpose }) {
      const heading =
        purpose === 'sign-in'
          ? 'Your sign in code'
          : purpose === 'email-verification'
            ? 'Confirm your email'
            : purpose === 'change-email'
              ? 'Confirm your new email'
              : 'Your verification code';

      const text = `${heading}: ${code}\n\nIt expires in 10 minutes.`;
      const html = WRAPPER(`
        <p style="margin:0 0 14px;font-size:15px">${heading}</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:600;color:#4A2A12">${code}</div>
        <p style="margin:16px 0 0;font-size:13px;color:#76665A">It expires in 10 minutes.</p>`);

      await send(to, `${code} is your Nima code`, text, html, `otp:${purpose}`);
    },

    async sendMagicLink({ to, url }) {
      const text = `Tap to sign in to Nima:\n${url}\n\nThe link works once and expires in 10 minutes.`;
      const html = WRAPPER(`
        <p style="margin:0 0 18px;font-size:15px">Tap the button to sign in.</p>
        <a href="${url}" style="display:inline-block;background:#4A2A12;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px">Sign in to Nima</a>
        <p style="margin:18px 0 0;font-size:13px;color:#76665A">The link works once and expires in 10 minutes.</p>`);

      await send(to, 'Sign in to Nima', text, html, 'magic-link');
    },

    async sendRaw({ to, subject, text, html }) {
      await send(
        to,
        subject,
        text,
        html ?? WRAPPER(`<p style="font-size:15px">${text}</p>`),
        'raw',
      );
    },

    async verify() {
      try {
        await transporter.verify();
        return true;
      } catch (error) {
        log?.error(
          { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, err: error },
          'The mail server would not accept a connection, so no code can reach anybody',
        );
        return false;
      }
    },
  };
}
