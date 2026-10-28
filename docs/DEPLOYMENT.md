# Deploying Nima

The backend runs on one VPS that it shares with several unrelated projects.
Everything here follows from that: Nima owns its own compose project, its own
network and its own volumes, and nothing it runs listens on a public
interface. The host's nginx is the only thing the internet talks to.

Current home: `liban@156.67.25.84`, in `/home/liban/nima-ai`.

---

## What runs

| Service | What it is | Published on |
|---|---|---|
| `api` | Fastify, the whole HTTP and WebSocket surface, and the web app | `127.0.0.1:3340` |
| `worker` | Try-ons, media, notifications | nothing |
| `postgres` | Postgres 17 with pgvector | `127.0.0.1:5462` |
| `valkey` | Queues, rate limits, socket fan out | nothing |
| `garage` | S3 compatible storage for photographs | `127.0.0.1:3962` |

The web app is built into the API image (the `web` stage of
`infra/Dockerfile` runs `expo export`). The API answers every GET that is not
an API path from that build, so the public address that serves the API also
serves the web app, and the app finds the API at whatever address it was
loaded from. A deploy that rebuilds `api` ships the web app too.

The published ports are loopback only so a human can reach them over an SSH
tunnel and nobody else can reach them at all.

Note the two sets of names. `API_PORT` is the port the API listens on inside
its container. `API_HOST_PORT` is where compose publishes it on the host.
They were one variable once, which is how the API ended up published
somewhere the nginx config was not looking.

---

## First deploy

```bash
ssh liban@156.67.25.84
git clone https://github.com/joeglantern/Nima-AI.git /home/liban/nima-ai
cd /home/liban/nima-ai
```

Write `.env.prod` from `.env.example`, with:

- generated secrets, `openssl rand -base64 32` for `BETTER_AUTH_SECRET` and
  `openssl rand -hex` for the database password and the Garage tokens
- `API_URL` and `BETTER_AUTH_URL` set to the public origin
- `WEB_ORIGINS` listing every origin the app is served from, plus `nima://`
  for the native build
- SMTP pointing at the mailbox the other projects on the host use, which is
  described below

Then:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
```

The `migrate` service runs `prisma migrate deploy` and exits before the API
starts, so the API never carries the ability to change the schema it reads.

### Storage

Garage needs to be told it is the whole cluster before it will serve
anything, and it needs the key the API already has in its environment rather
than one of its own:

```bash
g() { docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec -T garage /garage "$@"; }
g layout assign -z nima -c 50G "$(g node id -q | cut -d@ -f1)"
g layout apply --version 1
g bucket create nima-media
g key import --yes -n nima-api "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
g bucket allow --read --write --owner nima-media --key nima-api
```

### Seed

Only on a fresh database, and only while the catalogue is still make
believe:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod \
  run --rm --entrypoint "" -w /app/packages/db api pnpm exec tsx prisma/seed.ts
```

---

## Reaching it before there is a domain

There is no certificate yet, and the API is not published on a port. Putting
it on one over plain HTTP would send the sign in code and the session cookie
across the network in the clear, which is not worth the convenience.

So the server dials out instead. A Cloudflare quick tunnel runs as one more
container in the stack, terminates https on Cloudflare's edge and hands the
API a random `https://<words>.trycloudflare.com` address. Nothing listens on
a public port, nothing on the host changes, and the other projects on it are
not involved.

```bash
./scripts/live-url.sh          # start the tunnel, print the address
./scripts/live-url.sh --show   # the current address
```

The script writes the address into `.env.prod` everywhere the API needs to
know its own public URL (`API_URL`, `BETTER_AUTH_URL`, `S3_PUBLIC_URL`,
`WEB_ORIGINS`), switches media to `proxy` because the bucket is on loopback,
trusts Expo Go origins for testing, and recreates `api` and `worker`. The
address changes whenever the tunnel container restarts, which is why this
is a script and not an edit.

To point the app on a phone at it, in `apps/app/.env`:

```bash
EXPO_PUBLIC_DEVICE_API_URL=https://<words>.trycloudflare.com
```

The browser on the development machine keeps using the local API: a
browser will not hold a cookie across sites, and the phone keeps its own.

Quick tunnels are meant for exactly this and not for customers: Cloudflare
makes no promises about them. The day there is a domain, replace the
`tunnel` service with a named tunnel or a certificate on the host's nginx,
set the four variables to the real address, and switch `MEDIA_DELIVERY`
back to `redirect` once the bucket is behind a CDN.

For a browser on this machine against the real database there is still
`pnpm live`, which opens `ssh -L 3340:127.0.0.1:3340` and starts Expo
pointed down it.

---

## The front door

nginx on the host is shared with every other project, so this part needs
root and is the one step that is not in the compose file.

```bash
sudo cp infra/nginx/nima.conf /etc/nginx/sites-available/nima.afosihub.com
sudo ln -s /etc/nginx/sites-available/nima.afosihub.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d nima.afosihub.com
```

`certbot` writes the 443 block and the redirect into that file itself, the
same way every other site on the box is set up.

**DNS has to exist first.** certbot proves the domain over HTTP, so
`nima.afosihub.com` must already be an A record pointing at `156.67.25.84`.
Without it certbot fails and leaves the site on plain HTTP.

If you would rather not wait for DNS, `nima.156-67-25-84.sslip.io` resolves
to that address on its own, needs no record anywhere, and certbot will issue
for it. Three other services on this host already use that pattern. Put it
in `server_name` in place of the domain, and set `API_URL`,
`BETTER_AUTH_URL`, `S3_PUBLIC_URL` and `WEB_ORIGINS` to match.

The config forwards the upgrade headers, because the try-on progress socket
is the thing that stops the app looking stuck, and raises the read timeout to
180 seconds, because an image takes half a minute and the default leaves no
room.

---

## Email

Nima sends through the same mailbox as the other projects on this host:
`forms@leadedgeconsults.com` at `mail.leadedgeconsults.com:465`.

There is a local relay, `formrelay`, running under pm2 on the same box and
listening on `127.0.0.1:2525`. Nima does not use it, because it is bound to
loopback and a container cannot reach loopback on the host. Going straight to
the mailbox is what the CRM on this host does too.

The From address belongs to a different business. Move it to a Nima mailbox
before anyone outside the team sees one of these emails.

---

## Updating

```bash
cd /home/liban/nima-ai
git fetch origin && git reset --hard origin/main
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod build api worker
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
```

Migrations run on the way up. The API has a health check, so compose will
report it unhealthy rather than quietly serving errors.

---

## Checking it

```bash
curl -s http://127.0.0.1:3340/health
curl -s http://127.0.0.1:3340/v1/feed?surface=foryou | head -c 200
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod logs api --tail 50
```

SMTP, which is the part most likely to be wrong:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec -T api node -e "
const t = require('/app/node_modules/nodemailer').createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});
t.verify().then(() => console.log('ok')).catch((e) => console.log('failed:', e.message));
"
```

---

## What is not switched on yet

| Thing | Why | What it needs |
|---|---|---|
| Checkout | No payment provider | `FINGO_API_KEY`, `FINGO_WEBHOOK_SECRET`, then the `checkout` flag in `app_settings` |
| Try-on images | No image provider | `GEMINI_API_KEY`. Jobs queue and wait until there is one |
| Ask Nima, full | No language model | `LLM_BASE_URL`. It answers from the catalogue meanwhile |
| Google and Apple sign in | No OAuth credentials | The client id and secret pairs. Email codes work without them |

None of these stop the rest of the app. Each one is read at boot and the
feature reports itself unavailable rather than failing in a request.
