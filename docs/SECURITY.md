# Security

What protects people's photos, messages and money on Nima, what was checked, and what still needs doing. Reviewed 3 November 2026.

## What is in place

**Accounts and sessions**
- Sign in by email code, Google or Apple. Codes are six digits, expire in ten minutes and allow five attempts.
- Code requests are limited to three a minute per address, sign in attempts to five or six.
- Session cookies are marked Secure and HttpOnly on any https or non loopback address. Sessions last a month.
- Guest accounts exist so people can browse before signing in. A guest's data moves to their account when they sign in, and free credits are not granted twice.

**The API**
- Every route has a rate limit: 300 requests a minute per person or address overall, with tighter limits on sign in, media, following, messaging, sharing and blocking.
- Limits are stored in Valkey, so they hold across restarts.
- Request bodies are capped at 1 MB. Images never pass through the API; they go straight to storage with a short lived signed link.
- Under heavy load the server sheds requests with a calm message rather than falling over.
- CORS allows only the web origins in `WEB_ORIGINS`, the native app, and localhost in development.
- Standard hardening headers from Helmet. The web app also sends `frame-ancestors 'none'` so nobody can put Nima inside a frame, plus a report only content security policy. Enforce that policy once the browser console has run clean for a while.
- The API docs need a sign in in production.

**Media and privacy**
- The storage bucket is private. Only product photos, shop images, avatars and the covers of public looks are served openly.
- A person's own photos and try-ons stay private unless they publish them. A link to private media carries a signed, expiring claim for exactly that file.
- Follower counts are shown to nobody (see DECISIONS.md, 16).
- People can block each other. A blocked person cannot message or be messaged.

**Money**
- Payments go through one gateway interface. The webhook is the only thing that marks an order paid, every charge carries an idempotency key, and signatures are checked in constant time over the raw bytes.
- M-Pesa payments go straight to Nima's Till through Safaricom's API. The result callback is unsigned, so it is only a prompt: the STK query is read before any order is marked paid, a secret token in the callback URL drops anything that is not Safaricom's, and a reconcile job covers payments whose callback never arrives. PaySasa and Paystack stay as implementations behind it with the same rules.

**Servers and code**
- Postgres, Valkey and the storage bucket listen on loopback only. The API and worker containers run as the unprivileged `node` user. Migrations run in a separate one shot container, so the API cannot change the schema.
- Secrets live only in `.env` files on the server. `.env*` is ignored by git, and `.env.example` holds names only.
- A pre-commit hook (`.githooks/pre-commit`) refuses commits that stage secret files or anything that looks like a key or token. Install it once per clone with `git config core.hooksPath .githooks`.
- Commit history was scanned for live keys, API keys, private key blocks and tokens. None were found.

## What the owner must do

1. **Make the GitHub repository private.** `joeglantern/Nima-AI` is public today. The history holds the brand book, the technical plan, event briefs and the server's address, none of which should be public. Settings, General, Danger zone, Change visibility.
2. **Turn on secret scanning and push protection.** Settings, Code security. Push protection blocks a leaked key before it lands.
3. **Two factor authentication** on GitHub, Expo, Apple, Google Play, the Daraja developer portal, the M-Pesa business portal and the domain registrar, with an app or a hardware key.
4. **A real domain** for the API and web app, with a certificate. Printed QR codes and Instagram links must never point at a temporary tunnel.
5. **M-Pesa:** keep the consumer key, secret, passkey and callback token only in `.env.prod` on the server. Stay on the sandbox until a real KSh 10 payment has gone through end to end on production, then set `MPESA_ENV=production`. The sandbox is a real paybill and its prompt takes real money, so off production the gateway pushes KSh 1 whatever the order says (a test cost the owner KSh 1,700 on 7 November 2026 before this guard existed). Rotate the callback token with the key pair if either is ever suspected.
6. ~~Dependency updates~~ Done on 3 November 2026: `sharp` 0.35.5, `nodemailer` 10.3.1, `zod` 4.6.7. The remaining audit items are `tinypool` (test runner only, never shipped), `node-forge` and `decode-uri-component` (inside Expo's build tooling, not in the shipped app) and `deepmerge-ts` (inside Prisma's config loader). Re-check with `pnpm audit --prod` each month.

## Not yet built

- A place for staff to act on reports. People can report a look or a person from the app (the `reports` table); comments can be hidden. Nothing yet lists open reports for staff.
- Terms of service and a privacy policy, which the stores and Meta both require.
- Account deletion that also removes the person's photos from storage end to end. Check `services/deletion.ts` covers every key prefix before launch.
- Audit logging of staff actions, once there are staff.
