# Working on Nima

Day to day notes for running, changing and debugging the backend.

---

## First run

```bash
pnpm install
cp .env.example .env
pnpm stack:up
```

### Garage storage, once per machine

The local S3 server needs a layout, a bucket and a key before it will accept
anything:

```bash
# the id printed here goes into the next command
docker exec nima-garage /garage status

docker exec nima-garage /garage layout assign <node-id> -z dc1 -c 5G
docker exec nima-garage /garage layout apply --version 1
docker exec nima-garage /garage bucket create nima-media
docker exec nima-garage /garage key create nima-dev
docker exec nima-garage /garage bucket allow --read --write --owner nima-media --key nima-dev

# development only, so seeded images can be fetched without signing
docker exec nima-garage /garage bucket website --allow nima-media
```

Put the printed key id and secret into `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY`.

### Database

```bash
pnpm db:migrate     # apply migrations
pnpm db:seed        # demo data
pnpm db:studio      # browse it
```

The seed is safe to run repeatedly. It keys everything on stable slugs and
handles.

---

## Running

```bash
pnpm dev                      # everything
pnpm --filter @nima/api dev   # just the API
pnpm --filter @nima/worker dev
```

The API logs are pretty printed in development and structured JSON in
production.

---

## Ports

Nima uses an unusual range on purpose, so several projects can run at once.

| Service | Port |
|---|---|
| API | 3333 |
| Postgres | 5460 |
| Valkey | 6460 |
| Garage S3 | 3960 |
| Garage admin | 3963 |
| Mailpit SMTP | 1060 |
| Mailpit web | 8060 |

---

## Signing in while developing

**Codes do not reach your real inbox.** Development sends through Mailpit on
this machine, so a code addressed to your Gmail is caught at
**http://localhost:8060** and goes no further. The API log says so on every
send, with the link. Nothing is broken; it is the point of Mailpit.

To get a code in a real inbox, run against the deployed backend with
`pnpm live`, which sends through the shared mailbox.


There are no passwords. Ask for a code, then read it from Mailpit:

```bash
curl -X POST localhost:3333/api/auth/email-otp/send-verification-otp \
  -H 'content-type: application/json' \
  -d '{"email":"wanjiru@example.com","type":"sign-in"}'

open http://localhost:8060
```

The seeded shopper is `wanjiru@example.com`. The two seeded stores are
`kanzu-collective@example.com` and `sote-street@example.com`.

To browse as a guest, which is what a first time visitor gets:

```bash
curl -X POST localhost:3333/api/auth/sign-in/anonymous \
  -H 'content-type: application/json' -H 'origin: http://localhost:3333' -d '{}'
```

---

## Changing the database

```bash
# edit packages/db/prisma/schema.prisma, then
pnpm db:migrate
```

Anything Prisma cannot express, such as vector indexes, partial indexes and
check constraints, goes in a hand written migration. There is one already:
`20261009210500_vector_indexes_and_constraints`. Copy its shape.

Never edit a migration that has been applied anywhere but your own machine.

---

## Adding an endpoint

1. Put the request and response shapes in `packages/contracts`. They are
   shared with the apps, so the client gets the types for free.
2. Add the route in `apps/api/src/modules/<area>/routes.ts`. Give it `tags`
   and a `summary`: the docs page is generated from these.
3. Pick a guard: `app.requireSession` for anything personal,
   `app.requireAccount` when a guest cannot do it, `app.requireAdmin` for
   staff. Leave it off only when guests genuinely should be able to call it.
4. Shape the response through a presenter in `lib/presenters.ts`. Do not
   return a database row.
5. Add it to the smoke test if it is part of a path a person actually walks.

---

## Adding a background job

1. Add the payload schema and queue name to `packages/jobs`.
2. Enqueue with `app.queues.<name>.add(...)` from the API.
3. Consume in `apps/worker/src/workers/`.
4. If the user is waiting, publish a WebSocket frame when it finishes. The
   frame types live in `packages/contracts/src/events.ts`.

Anything that costs money must charge credits in the same transaction that
creates the job. See `TryOnService.start`.

---

## Testing

```bash
pnpm test                              # unit tests
pnpm --filter @nima/api smoke          # end to end against a running API
pnpm --filter @nima/api test:checkout  # the money path, start to settled
pnpm --filter @nima/api test:closet    # wardrobe and lookbooks, and who can see them
pnpm --filter @nima/api test:mail      # every email, and what happens when sending fails
pnpm test:journey                      # the whole way in, through the real app
```

The **smoke test** is the quickest way to know the whole stack is healthy. It
covers guest browsing, the account gate, email sign in, uploads, the credit
charge, filling a basket and the privacy of public responses. It needs the
API and the stack running, and it is safe to run twice: it cancels try-ons
and empties the basket it left behind last time.

The **checkout test** builds its own API in process, with a stub standing in
for Fingo, so nothing leaves the machine. It is the one that proves the parts
that cost money if they are wrong: that a basket becomes one order per shop,
that stock moves when the order is placed and comes back if the payment
fails, that the seller ledger gets the sale and the fee and not the delivery,
that a replayed webhook pays nobody twice, that a forged one is recorded and
ignored, and that a settlement for the wrong amount buys nothing. Run it
after touching anything under `services/checkout.ts`, `services/payments/`
or `modules/webhooks/`.

The **journey test** is the only one that uses the app rather than the
API, and it has caught things none of the others could: a code field with
no way to submit, and a sign in that bounced you back to the screen you
signed in from. The API answered 200 throughout. It needs Metro running,
and it opens a throwaway browser profile each time so it always arrives as
a stranger.

### Turning checkout on locally

It is off by default, because `features.checkout` is false until Fingo
credentials exist. To walk the screens, flip the flag in `app_settings` and
set `FINGO_API_KEY` and `FINGO_WEBHOOK_SECRET` to anything. Without a real
provider no webhook will arrive, so orders sit at `PENDING_PAYMENT`, which is
the honest outcome: nothing was paid.

---

## Debugging

**The API will not start.** Check `pnpm stack:up` ran and the ports above are
free. Environment problems print a list of exactly what is wrong.

**Try-on jobs sit in the queue.** `GEMINI_API_KEY` is probably empty. The
worker says so at startup.

**Uploads fail with a checksum error.** The S3 client must be created with
`requestChecksumCalculation: 'WHEN_REQUIRED'`. Non-AWS S3 servers reject the
default checksum header on presigned uploads.

**A response is rejected by its own schema.** The error says
`response did not match schema` with the field. The presenter and the
contract have drifted apart; fix the presenter.

**Checkout answers 409 "Checkout is not open yet".** That is the feature
flag, not a bug. See above.

**A request with no body is rejected as empty JSON.** Fastify refuses a
request that sets `content-type: application/json` and sends nothing, which
is every bodiless DELETE. The API client only sets that header when there is
a body; a new caller must do the same.
