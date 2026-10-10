# Nima

AI stylist, virtual try-on, social fashion discovery and a marketplace, built
for Kenya.

Nima is usable without an account. You can browse For You, open products and
look around before anything asks who you are. An account is only needed for
the things that need to be yours: try-on, your wardrobe, saving, messaging and
buying.

---

## Getting started

You need Node 22 or newer, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env          # then fill in the blanks, see below
pnpm stack:up                 # Postgres, Valkey, Garage, Mailpit
pnpm db:migrate               # create the schema
pnpm db:seed                  # two stores, seven products, a demo shopper
pnpm dev                      # the API on :3333, the worker alongside it
```

Then open:

| What | Where |
|---|---|
| API docs | http://localhost:3333/docs |
| Health | http://localhost:3333/health/ready |
| Email catcher | http://localhost:8060 |
| Database browser | `pnpm db:studio` |

Check it all works end to end:

```bash
pnpm --filter @nima/api smoke
```

That walks the real path: browse as a guest, get stopped at the try-on gate,
sign in with an email code, upload a photo, start a try-on, and confirm the
credit ledger moved by exactly one.

### Storage keys for local development

Garage needs a one time setup. The commands are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); they print an access key and
secret to paste into `.env`.

### The one key you need for images

`GEMINI_API_KEY` turns on try-on. Without it everything else still runs and
try-on jobs simply wait in the queue, which is useful while working on other
parts of the app.

---

## What is here

```
apps/
  api/        Fastify: REST, WebSockets, auth, webhooks
  worker/     Queue consumers: try-on, media, notifications
packages/
  db/         Prisma schema, migrations, seed
  config/     Environment validation and business settings
  contracts/  Zod schemas shared by the API and the apps
  jobs/       Queue names and job payloads
infra/        Local stack and deployment files
docs/         Plan, design system, decisions, audits of the old codebase
```

---

## How it fits together

The API never does slow work inside a request. Anything that takes time, such
as generating an image or removing a background, becomes a job. The worker
picks it up and pushes the result to the app over a WebSocket.

```
Expo app  ──HTTP──►  Fastify API  ──►  Postgres
    ▲                     │
    └──WebSocket──────────┤
                          ▼
                       Valkey  ──►  Worker  ──►  Gemini (images)
```

Everything is self hosted apart from image generation. There is no Supabase,
no Firebase and no paid backend service.

---

## Rules the code keeps

These come from auditing the previous codebase, where each one was broken at
least once. They are not style preferences.

1. **Identity comes from the session.** Never from anything the client sends.
2. **Every AI job charges credits through one function**, and refunds when it
   fails. There is no second path to the image model.
3. **Money is an integer number of cents.** Totals are computed on the server.
4. **Private data never reaches a public response.** Responses are built by
   presenters, not by returning database rows.
5. **Deleting means deleting**, including the stored files.
6. **Guests are first class.** If a feature cannot work for a guest, it says so
   with `account_required` and the app offers to sign them up.
7. **Stock is taken by the database, not by our code.** A conditional update
   settles who got the last one. Reading a number and trusting it a line
   later is how a shop sells the same dress twice.
8. **Only a signed webhook marks an order paid.** The request that starts a
   payment knows that a prompt was sent, nothing more.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run everything in watch mode |
| `pnpm build` | Build every package and app |
| `pnpm typecheck` | Types across the workspace |
| `pnpm test` | Unit tests |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Database |
| `pnpm stack:up` / `stack:down` / `stack:logs` | Local services |
| `pnpm --filter @nima/api smoke` | End to end against a running API |
| `pnpm --filter @nima/api test:checkout` | The money path, with a stub provider |

---

## Documentation

- [docs/PLAN.md](docs/PLAN.md), the full technical plan and the reasoning
- [docs/DESIGN.md](docs/DESIGN.md), colours, type and screen patterns from the
  brand book
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), setting up and working day to day
- [docs/DECISIONS.md](docs/DECISIONS.md), why things are the way they are
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), running it on the VPS it shares
  with other projects
- [docs/legacy/](docs/legacy/), audits of the three previous codebases
