# Decisions

Short records of choices that are expensive to reverse, and why they were
made. Written when the decision is taken, not afterwards.

---

## 1. Postgres with Prisma, self hosted

**Why:** the whole platform runs on one VPS, and every managed option either
costs money per month or locks the data somewhere else. Postgres covers the
relational data, full text search and, through pgvector, the recommendation
vectors, so there is one database to run and back up rather than three.

**Cost:** Prisma has no vector type yet, so those queries are raw SQL. They
are kept in `packages/db/src/vector.ts` so they can be reviewed together.

---

## 2. Better Auth, no passwords, no SMS

**Why:** Lucia is deprecated and the Auth.js team joined Better Auth, so it is
where the ecosystem went. It also ships the three things Nima actually needs:
anonymous accounts, social sign in and email codes.

Passwords are not offered. They add reset flows, breach risk and support load,
and nobody wants one. SMS is not offered either: every message costs money,
and email codes plus Apple and Google cover everyone.

**Consequence:** a person with no email address cannot sign up. Acceptable for
now; if it turns out to matter, WhatsApp is the route to add, not SMS.

---

## 3. Guests get a real user row

**Why:** the brief is firm that Nima works without an account. Keeping guest
state in the client would lose it at sign up, which punishes exactly the
people who decided to commit.

So every visitor gets an anonymous `User`. Their likes, cart, views and
session personalisation hang off it, and `onLinkAccount` moves everything
across in one transaction.

**Cost:** a table of abandoned guest rows. A weekly job removes anonymous
accounts older than 30 days that never did anything.

---

## 4. Gemini for images, behind an interface

**Why:** the previous team shipped try-on on Gemini and it worked on real
Kenyan outfits. Every open model that could replace it either forbids
commercial use or needs a GPU that costs more per month than the API costs per
image.

Two things changed from their version. There is no second model writing the
prompt: GPT-4o used to be called first, which cost money and added seconds,
and the item data already describes the garment. And the cheaper, faster model
is the default, with the better one reserved for full outfits.

**Reversibility:** `ImageProvider` in `apps/worker/src/providers` is a small
interface. Swapping in a different service, or a self hosted model once one is
properly licensed, is one file.

---

## 5. One credit ledger, charged before the work

**Why:** the old codebase had four ways to generate an image for free, because
charging happened in whichever handler remembered to do it.

Here, credits are an append only ledger. The balance is a cached sum, written
in the same transaction as the entry that explains it, and a database
constraint stops it going negative. `TryOnService.start` is the only path to
the image queue, and it charges and enqueues in one transaction.

**Consequence:** a failed job must refund. The worker does it on the final
attempt, the refund is idempotent per job, and a refund that fails is logged
loudly rather than swallowed.

---

## 6. Images never pass through the API

**Why:** a photo upload through the API ties up a Node process for the length
of a mobile upload on a slow connection.

Clients ask for a presigned URL, upload straight to storage, then tell the API
the key. The API checks the key belongs to the caller before accepting it.

---

## 7. WebSockets over polling, fanned out through Valkey

**Why:** try-on takes tens of seconds, and polling from a phone on mobile data
is wasteful and slow to feel. The jobs also finish in the worker, a different
process from the API, so the result has to cross a process boundary anyway.

Valkey pub/sub does that crossing. It also means a second API node can be
added without changing anything.

---

## 8. Credits on iOS go through Apple

**Why:** Apple rejected the previous app for selling credits with M-Pesa
inside the iPhone app. Digital goods must use in app purchase.

So iPhone buys credits through Apple, Android and web use M-Pesa through
Fingo, and physical products use M-Pesa everywhere, which Apple permits.

**Cost:** Apple keeps 15 to 30 percent, so iOS pack prices may differ. The
packs carry a separate iOS price for exactly this reason.

---

## 9. Feed version one is rules, not vectors

**Why:** a recommender with no behaviour to learn from is worse than a good
heuristic, and the vector columns are already in the schema for when there is
data.

Scoring is freshness, engagement, follows and a match against the stated style
profile, minus anything dismissed or already seen, with no two cards in a row
from the same person. Each card carries the reason it was chosen, which is
logged, so the eventual learned ranker has a baseline to beat.

---

## 10. Settings live in the database

**Why:** credit costs, the free weekly grant, the platform fee and the feature
flags all change with the business, not with the deployment. Shipping a
release to change a number is how numbers stop being tuned.

They sit in `app_settings`, are read through a cached accessor, and are
validated against the same schema that defines the defaults.

---

## 11. One basket becomes one order per shop

**Why:** Nima is a marketplace, not a shop. Each seller packs, posts and is
paid separately, so an order that spans two of them is two orders wearing one
coat. Pretending otherwise means a single status, a single cancellation and a
single refund across people who have nothing to do with each other.

The buyer sees the split in the basket, before they commit, so two delivery
messages are not a surprise. The payment stays whole: one M-Pesa prompt for
the lot, held as a `CheckoutGroup` that the orders hang off. Delivery is
charged once for the basket and apportioned across the orders by subtotal,
with the rounding remainder on the largest, so the orders add up to exactly
what was charged.

---

## 12. Stock is taken when the order is placed, not when it is paid

**Why:** an M-Pesa prompt can sit on a phone for minutes. Holding nothing
during that window means two people can both be told they bought the last
dress, and one of them gets a refund and never comes back.

The decrement is a conditional update, `WHERE stock >= quantity`, so the
database settles the race rather than our code reading a number and trusting
it a line later. If the payment fails or the prompt cannot be sent, every
unit goes back and the order is cancelled with a reason the buyer can read.
The cost of this choice is stock held by abandoned checkouts, which is the
cheaper mistake: it corrects itself, overselling does not.

---

## 13. Only the webhook marks an order paid

**Why:** the request that starts a payment knows one thing, that a prompt was
sent. Treating that as a sale is how a shop posts goods against money that
never arrived.

`POST /v1/checkout` returns `PROCESSING`. The order becomes `PAID`, and the
seller's ledger is credited, in one place: the signed webhook. Three rules
around it, all from reading how the previous code handled this:

- **Signature over the raw bytes.** The route keeps the body as a string and
  checks an HMAC in constant time. Re-serialising parsed JSON changes
  whitespace and the signature stops matching.
- **Every delivery is recorded before it is acted on**, valid or not. When a
  buyer says they paid and the order disagrees, the stored payload is the
  only useful thing in the room.
- **Always answer 200 once it is stored.** A provider that gets an error
  retries for days. Our failure to process is ours to fix from the row.

A settlement for the wrong amount is never treated as a payment. It unwinds
the order and shouts in the log.

---

## 14. Checkout is behind a flag, and the sandbox gateway refuses production

**Why:** a basket you cannot pay for is worse than no basket. `features.
checkout` is false until Fingo credentials exist, and the API refuses to boot
in production without them rather than falling back to a gateway that takes
orders nobody can pay.

---

## 15. No NativeWind. Styles live in JavaScript, from one theme

**Why:** it made the phone and the browser render differently, and the app
was not using it for anything.

NativeWind was set up at the start and then never used: not one class name
was written, because the theme hook turned out to be a better fit for a
palette that has to answer to a brand book. What it was still doing was
replacing the JSX runtime through Babel, and that wrapper did not pass
through a `style` given as a function.

React Native Web resolved those on its own, so the browser looked right.
On a phone every `Pressable` with a `style={({ pressed }) => ...}` lost its
styling completely: no background, no padding, no corner radius, no
centring. That is most of the controls in the app. The opening screen's
three sign in buttons rendered as three lines of dark text on a dark sheet.

Two lessons, both paid for:

- **A dependency that is configured but unused is not free.** This one was
  invisible in the source and decisive in the output.
- **The browser is not the phone.** Every screen in this project had been
  reviewed in a browser and none on a device, so a whole class of bug had
  nowhere to show up. Check both.

Styling is plain React Native objects from `src/theme`, which both
platforms read the same way. `global.css` stays as plain CSS for the one
thing that only exists on the web: the page around the app shell.


---

## 16. No follower numbers, anywhere, for anyone

People follow people, and the button says Follow because everyone already
knows what it means. What Nima drops is the number. A count on a profile turns
a person into a score, and on a style app that score is read as how good your
taste is, which is exactly the feeling that stops people posting.

So there are no follower or following totals in any response, public or
private, including on your own profile. In their place:

- **Your circle**: the faces of the people you follow, on My Store and as a
  list. Who follows you arrives in Activity, one person at a time.
- **Followed by people you know**: someone's page names up to two people you
  follow who also follow them, plus how many more of *your* people do. It
  says you have friends in common, not where they rank.

Shops are the exception, and only behind the counter: a seller sees how many
people follow their shop on their own dashboard, because that is a business
number they need. It is never shown to customers.

## 17. For You is built around the outfit, not the poster

Posts are flat lays and clothes on doors, so the photograph comes first and the poster is small print under the title. Pieces live on the photograph: a small tag opens a card with each piece's picture, price and heart, so a whole post fits on one phone screen. The feed paces one big post then two smaller ones side by side. The four actions are drawn as their own objects with the word set along the top edge: a heart for love, a speech bubble for ask, a paper plane for send, a hanger for hang. Love counts are never shown. (3 November 2026)

## 18. White ground, not cream

The brand book names cream as the background. The owner found cream made the app feel homely rather than sharp, so the app's ground is white, with a near white for sunk areas. Printed and event material may still use cream; the two sit together without clashing.

## 19. Payments go through Paystack (superseded by 21)

Fingo Pay is dropped before it ever took a live payment. Paystack handles M-Pesa and cards in KES. The gateway interface stays, so the rest of the system never learns the provider's name. Nothing is marked paid until the webhook is signature checked and the transaction is verified with Paystack.

## 21. Payments go through PaySasa (superseded by 22)

PaySasa (paysasa.com, by Airsoko) replaces Paystack before either took a live payment. It is Kenyan, settles to a PaySasa wallet and out to M-Pesa, and its API is a checkout session: name a session for an amount, push the M-Pesa prompt to a phone, read the session back. Nima keeps the same rules as before: nothing is marked paid until the session is read back from PaySasa and agrees on amount and currency, webhooks are only a prompt to look, and the reconcile timer closes or confirms whatever never got a webhook. Two things are different. The session is named before any money is asked for, so the payment row is given PaySasa's id between those two calls and a timeout on the prompt can still be matched. And PaySasa has no refund API, so a refund is recorded, logged loudly, sent by a person from the PaySasa dashboard and then marked done. Paystack stays in the code as the second implementation, used only when PaySasa is not configured. (4 November 2026)

## 22. Payments go straight to Nima's M-Pesa Till

Nima is getting its own Till, so the money goes to Safaricom directly through the Daraja API and no aggregator sits in between. The same rules hold: an STK push is only "we asked", the result callback is unsigned and treated as a prompt to look, and nothing is marked paid until the STK query says ResultCode 0. Three things are particular to Safaricom. The callback URL carries a long secret token because Safaricom signs nothing. The query does not state the amount, so the amount is held to the push itself (a CheckoutRequestID is bound to the amount it was pushed with) and checked against the callback's amount whenever one came. And a push that times out has no id to query, so that checkout is unwound and the buyer is told not to enter a PIN; money that lands anyway is logged under an unknown id for a refund by hand. Reversals through the API need an initiator and a security credential that Nima does not have yet, so refunds are recorded as BY_HAND and sent from the M-Pesa business portal. PaySasa and Paystack stay in the code as complete implementations behind it. (4 November 2026)

## 20. Booth sales are their own channel

A sale made by scanning a shop's QR at an event is an order with channel BOOTH and delivery AT_BOOTH: no delivery fee, no courier, handed over on the spot once the seller sees the payment. Vendor reports for an event group on this channel. Printed boards point at the configured public address, never at a temporary link.
