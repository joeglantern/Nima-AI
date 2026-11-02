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
- Paystack is being added with transaction verification before any order is marked paid, and a reconcile job for payments whose webhook never arrives.

**Servers and code**
- Postgres, Valkey and the storage bucket listen on loopback only. The API and worker containers run as the unprivileged `node` user. Migrations run in a separate one shot container, so the API cannot change the schema.
- Secrets live only in `.env` files on the server. `.env*` is ignored by git, and `.env.example` holds names only.
- A pre-commit hook (`.githooks/pre-commit`) refuses commits that stage secret files or anything that looks like a key or token. Install it once per clone with `git config core.hooksPath .githooks`.
- Commit history was scanned for live keys, API keys, private key blocks and tokens. None were found.

## What the owner must do

1. **Make the GitHub repository private.** `joeglantern/Nima-AI` is public today. The history holds the brand book, the technical plan, event briefs and the server's address, none of which should be public. Settings, General, Danger zone, Change visibility.
2. **Turn on secret scanning and push protection.** Settings, Code security. Push protection blocks a leaked key before it lands.
3. **Two factor authentication** on GitHub, Expo, Apple, Google Play, Paystack and the domain registrar, with an app or a hardware key.
4. **A real domain** for the API and web app, with a certificate. Printed QR codes and Instagram links must never point at a temporary tunnel.
5. **Paystack:** keep the secret key only in `.env.prod` on the server. Use test keys until a real test payment has been made end to end.
6. **Dependency updates** when the current build settles: `sharp` to 0.35.5 or later, `nodemailer` to 10.0.6 or later, `zod` to 4.6.6 or later. These close published issues in image decoding, address parsing and oversized input. `tinypool` is a test only dependency and is not shipped.

## Not yet built

- Reporting a look, comment or person, and a place for staff to act on reports. Comments can already be hidden.
- Terms of service and a privacy policy, which the stores and Meta both require.
- Account deletion that also removes the person's photos from storage end to end. Check `services/deletion.ts` covers every key prefix before launch.
- Audit logging of staff actions, once there are staff.
