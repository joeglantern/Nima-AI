# App Store Connect: what goes in each box

Copy for the iOS listing and TestFlight, kept here so the forms are filled the
same way every time and nobody improvises in the browser. Character limits
are Apple's. Everything is plain and true: no claims the app does not keep.

## App record

| Field | Value |
|---|---|
| Platform | iOS, iPhone only (`supportsTablet` is off, so no iPad screenshots or iPad review) |
| Name (30) | Nima AI (the record that already exists; the app's home screen name is Nima) |
| Primary language | English (U.S.) (set on the existing record; cannot change) |
| Bundle ID | ai.shopnima.app |
| SKU | nima_app_v1 |
| Apple ID | 6763051178 |
| Team | Nima AI Inc, XRG632J9HC |
| App Store Connect key | Nima EAS, key id 6K453F8TV8 (the .p8 lives only in `apps/app/credentials/`) |
| Signing | made through the App Store Connect API by `apps/app/scripts/apple-signing.mjs`; `credentials.json` is gitignored |
| User access | Full Access |

## App information

| Field | Value |
|---|---|
| Subtitle (30) | Outfits from Nairobi's shops |
| Primary category | Shopping |
| Secondary category | Lifestyle |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | 4+ (no mature themes; user generated content is moderated, with report and block) |
| Privacy policy URL | https://www.shopnima.ai/privacyPolicy (public today). Switch to the API's `/privacy` once the API has a real hostname; the marketing site's `/privacy`, `/terms` and `/help` redirect to a sign in page, which Apple rejects |
| Support URL | https://www.shopnima.ai/support |
| Marketing URL | https://www.shopnima.ai |
| Availability | Kenya only (set 7 Nov 2026). Widen it per country when deliveries exist there; staying out of the EU also keeps the Digital Services Act trader form out of the way |
| App privacy labels | Eight data types, all linked to identity, none for tracking: name, email, phone, photos, other user content, user ID, purchase history, product interaction. Mirrors `ios.privacyManifests` in app.json |
| Age rating | Questionnaire answered 7 Nov 2026: user content, social feed and messaging yes; no web browser, no mature content, no advertising. Apple computed 13+; overridden to 18+ to match the policy (19+ in Korea) |

## Version information

**Promotional text (170)**
Nairobi's independent shops hang their rails in Nima. Pull a piece forward,
check the size, pay by M-Pesa and collect near you.

**Description (4000)**
Nima is a fashion app for Kenya. Independent shops hang their pieces on a
rail, you pull one forward, turn it round, pick your size and pay by M-Pesa.

What you can do

- Browse outfits and flat lays from people and shops you like.
- Pull a piece off a shop's rail, see the front and the back, and check the
  sizes that are in stock.
- Put outfits together from several shops and save the ones you love.
- Ask Nima for ideas when you have an occasion and nothing to wear.
- Pay by M-Pesa, with an M-Pesa prompt on your phone, and collect from a
  pickup point near you.

For shops

- Open a shop in minutes and list from your phone.
- Turn an ordinary photo into a catalogue shot that hangs on your rail.
- Sell at events by letting people scan your booth's code and pay on the spot.

Nothing in the app is sold except the clothes.

Nima is built in Nairobi for people who dress well on a real budget.

**Keywords (100)**
fashion,outfits,thrift,nairobi,kenya,mpesa,clothes,shops,style,mitumba,boutique,dresses

**What's new (4000)** (first version)
The first release of Nima: the feed, shop rails, saved outfits and M-Pesa
checkout.

**Copyright**
2026 Nima AI Inc

## App Review information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| Demo account | Set `REVIEW_SIGN_IN_EMAIL` and `REVIEW_SIGN_IN_CODE` (six digits) in `.env.prod` and restart the API. Put that email in the Username box and the code in the Password box, and say in the notes: "Sign in with email, enter the address, then enter the code shown as the password. No email is sent." Create the account once yourself (sign in with it) so the reviewer lands on a profile with a few saved looks. Clear both variables after approval. |
| Contact | The account holder's name, the team phone (+254 796 205 375) and dev@shopnima.ai |
| Release | Manually release this version |
| Notes | Nima is a shopping app for Kenya. Independent shops list clothes, people see a piece on themselves with a photo, and pay by M-Pesa for physical clothing collected at a pickup point. iPhone only. / Sign in: tap Continue with email, enter the user name above, then enter the password above as the six digit code. No email is sent for this account. / Payments: the only thing sold is physical clothing, paid through M-Pesa (Safaricom mobile money), which needs a Kenyan number. This build points at the M-Pesa sandbox, so nothing is charged and the checkout can be walked through to the payment prompt. There is no digital content for sale, no in-app purchase and no credits to buy. / See it on me: this version does not include the photo try-on. The buttons are marked Soon and open a short notice saying it is coming in a later update; nothing else depends on them. The description does not mention it. / Safety: every look has Report this look, every profile has Block and Report, and Delete my account is in Settings. / The contact above reaches the team directly. |

**Why these notes.** The July 2026 rejection of 1.1.0 cited 3.1.1 (a credit
balance with no in app purchase) and 2.1(a) (an error after "Upload a photo"
on an iPad). The notes answer both, the screens no longer say credits, and
the iPad is out of the supported devices.

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
- Screenshots: 6.9" iPhone (1320 x 2868), at least three, taken from the live web app by `apps/app/scripts/store-shots.mjs` (puppeteer-core against the deployed address, viewport 440 x 956 at 3x). Run `node scripts/store-shots.mjs <https address> <out dir>` from `apps/app`.
- Try on must be switched on in production before review (the look screen says it is off in this preview otherwise), which needs the Gemini key in `.env.prod`.
- The Paid Apps agreement is not needed: there are no in-app purchases; M-Pesa payments for physical goods are outside Apple's IAP rules.

## How a build gets to Apple

1. `cd apps/app` and run `pnpm apple:signing <projectDir> <keyId> <issuerId> <p8> ai.shopnima.app` once per year, or when a certificate is revoked. It writes `credentials.json`.
2. `npx eas-cli build -p ios --profile production --non-interactive`. The `eas-build-post-install` hook builds `@nima/contracts` on the EAS machine; without it Metro cannot resolve the package.
3. `npx eas-cli submit -p ios --profile production --latest --non-interactive`. Apple processes the upload in five to ten minutes; `scripts` in the session scratchpad polled `GET /v1/builds` on the App Store Connect API until the state read VALID.
4. In App Store Connect, open the version, remove the old build from the Build table, Add Build, pick the new one, Save, then "Update Review" (a resubmission) or "Add for Review" (a first submission).

Done this way on 7 November 2026: build 1.2.0 (5) is attached to version 1.2.0, which reads "Prepare for Submission". TestFlight's internal group "Team (Expo)" already has the build.

## Try-on in this version

Decided 7 November 2026: ship with try-on off. The Gemini image models have
no free quota, so the feature needs prepaid billing on the Google project
before the flag goes on. In the app the See it on me buttons stay in place
with a Soon tag and open the coming soon sheet (`TryOnSoonSheet` in
`apps/app/src/components/try-on.tsx`); the try-on counters are hidden while
the flag is off. The listing does not mention try-on, because Apple does not
allow metadata to describe features that are not in the build. When billing
is on: set `GEMINI_API_KEY` in `.env.prod` (done), flip `features.tryOn` in
the `platform` row of `app_settings`, publish `nima:settings:changed`, put
the try-on bullet back in the description and reshoot the product and look
screenshots.

## Icon

The App Store icon is the mascot on white, as the earlier Nima app used,
made at 1024 px from `reference/Nima-Native/assets/clean-mascott.png`.

## Updates over the air

expo-updates is in the build from 1.2.0 (8) onwards, channel `production`,
runtime version policy `appVersion`. A JavaScript or asset change (copy, a
layout fix, a colour) ships without a new App Store build:

    cd apps/app
    npx eas-cli update --channel production --message "what changed"

Phones pick it up on the next cold start. Anything native (a new package
with native code, a permission, the icon, app.json native keys) still needs
`eas build` and a review. Keep `version` in app.json the same for an update
to land on the installed build; bump it only with a store build.

## Submissions

- 7 November 2026: version 1.2.0, build 8 (mascot icon, coming soon for try-on, centred header, expo-updates), resubmitted on the July submission with a reply to App Review summarising the fixes. Status Waiting for Review. Release is manual.
