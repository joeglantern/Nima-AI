# App Store Connect: what goes in each box

Copy for the iOS listing and TestFlight, kept here so the forms are filled the
same way every time and nobody improvises in the browser. Character limits
are Apple's. Everything is plain and true: no claims the app does not keep.

## App record

| Field | Value |
|---|---|
| Platform | iOS |
| Name (30) | Nima |
| Fallback names if "Nima" is taken | `Nima: Outfits and Shops`, `Nima Style` |
| Primary language | English (U.K.) |
| Bundle ID | app.nima.client |
| SKU | nima-ios |
| User access | Full Access |

## App information

| Field | Value |
|---|---|
| Subtitle (30) | Outfits, shops, try it on |
| Primary category | Shopping |
| Secondary category | Lifestyle |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | 4+ (no mature themes; user generated content is moderated, with report and block) |
| Privacy policy URL | https://marion-min-carrying-nickname.trycloudflare.com/privacy (replace with the real domain) |
| Support URL | https://marion-min-carrying-nickname.trycloudflare.com/help (replace with the real domain) |
| Marketing URL | leave empty until the domain exists |

## Version information

**Promotional text (170)**
See how a piece looks on you before you buy it. Nima is where Nairobi's
independent shops hang their rails.

**Description (4000)**
Nima is a fashion app for Kenya. Independent shops hang their pieces on a
rail, you pull one forward, turn it round, pick your size and see it on
yourself before you buy.

What you can do

- Browse outfits and flat lays from people and shops you like.
- Pull a piece off a shop's rail, see the front and the back, and check the
  sizes that are in stock.
- Try it on: put a photo of yourself in, and Nima shows the piece on you.
  It is a picture to help you decide, not a fitting.
- Put outfits together from several shops and save the ones you love.
- Ask Nima for ideas when you have an occasion and nothing to wear.
- Pay by M-Pesa, with an M-Pesa prompt on your phone, and collect from a
  pickup point near you.

For shops

- Open a shop in minutes and list from your phone.
- Turn an ordinary photo into a catalogue shot that hangs on your rail.
- Sell at events by letting people scan your booth's code and pay on the spot.

Nima is built in Nairobi for people who dress well on a real budget.

**Keywords (100)**
fashion,outfits,thrift,nairobi,kenya,mpesa,try on,clothes,shops,style,mitumba,boutique

**What's new (4000)** (first version)
The first release of Nima: the feed, shop rails, try on, saved outfits and
M-Pesa checkout.

**Copyright**
2026 Nima

## App Review information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| Demo account | Set `REVIEW_SIGN_IN_EMAIL` and `REVIEW_SIGN_IN_CODE` (six digits) in `.env.prod` and restart the API. Put that email in the Username box and the code in the Password box, and say in the notes: "Sign in with email, enter the address, then enter the code shown as the password. No email is sent." Create the account once yourself (sign in with it) so the reviewer lands on a profile with a few saved looks. Clear both variables after approval. |
| Contact | Owner's name, phone and email |
| Notes | Payments go through M-Pesa, which needs a Kenyan Safaricom number; the checkout can be seen up to the prompt without one. Try on sends the user's photo to an image model and keeps it private to the user. |

## App privacy (the questionnaire)

Data collected, all linked to the user, none used for tracking:

- Contact info: email address (account), phone number (M-Pesa and delivery).
- User content: photos (try on and wardrobe, private to the user), other
  user content (posts, comments).
- Identifiers: user ID.
- Purchases: purchase history (orders).
- Usage data: product interaction (which posts and pieces were opened, for
  the feed). Not used for tracking across apps or sites.

Not collected: location, contacts, health, financial account numbers (M-Pesa
handles the payment), browsing history, search history outside the app.

## TestFlight

**Test information**

| Field | Value |
|---|---|
| Beta app description | Nima, the fashion app for Kenya: shop rails, try on, saved outfits and M-Pesa checkout. This build points at the staging server, so payments are sandbox prompts and nothing is charged. |
| Feedback email | the owner's email |
| Marketing URL | empty |
| Privacy policy URL | same as above |
| Beta app review notes | Internal testing only for now. Sign in with an email code or with Apple. M-Pesa is in sandbox; use any Safaricom number and the prompt is simulated. |

**What to test (first build)**

1. Sign in with Apple, then sign out and sign in with an email code.
2. Open For You, open a post, tap a piece tag, save a piece.
3. Open a shop (Kanzu Collective), pull a piece forward on the rail, turn it round, pick a size.
4. Try it on with a photo of yourself. The result should arrive in under a minute.
5. Add to basket, check out, enter your number, see the waiting screen resolve.
6. Open a shop you own, add a piece from a photo, request a ghost shot.

**Internal testers**: the owner's Apple ID and up to 100 App Store Connect users, no review needed.

## Before the first external build or review

- A real domain, with /privacy, /terms and /help pages served by the API.
- A demo account for reviewers whose sign-in code lands somewhere the reviewer can read.
- Screenshots: 6.9" iPhone (1320 x 2868) and 6.5" (1284 x 2778), at least three each, taken from the live app, no mockup frames needed.
- The Paid Apps agreement is not needed: there are no in-app purchases; M-Pesa payments for physical goods are outside Apple's IAP rules.
