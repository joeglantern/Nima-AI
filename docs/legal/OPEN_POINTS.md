# Open points for the privacy policy and terms

What the owner and the lawyer must still supply before the two documents
come into force. Everything the code could answer has been written into
`privacy.md` and `terms.md` on 7 November 2026; this is what remains.
Both documents still carry the "draft for a lawyer" line until this list is
empty.

## The owner must supply

1. **The legal entity.** Registered company name, registration number and
   registered address. Both documents currently say "Nima AI, Nairobi,
   Kenya" and promise the rest once the company is registered.
2. **ODPC registration.** The registration number with the Office of the
   Data Protection Commissioner, or the lawyer's advice that registration
   is not yet required.
3. **A data protection contact.** Today both documents send data requests
   to `SUPPORT_EMAIL` with "Data protection" in the subject. If a named
   officer or a separate inbox is wanted, add it.
4. **The support inbox.** `SUPPORT_EMAIL` in `.env.prod`. It must be an
   inbox a person reads, because the help page promises a reply within two
   working days and the App Store listing points at it.
5. **Refund and return policy.** Who decides, time limits, who pays for
   returns, and what happens when an order is not collected. The terms
   have a placeholder sentence under "Returns, refunds and problems".
6. **Platform fee and payout hold.** The code defaults to a 7% fee and a
   3 day hold (`app_settings`). The terms point sellers at their shop
   settings and promise the figures here; confirm them.
7. **Credit terms.** Refunds of bought credits, expiry, and whether credits
   are sold through Apple and Google on the phone (the settings carry iOS
   product ids). If they are, Apple's and Google's refund routes apply and
   the Credits section needs them.
8. **Email and hosting providers.** The privacy policy names them only as
   "our email service" and "our hosting provider". Name them, and say
   where they process data, once the production SMTP host and the server
   location are settled. If Cloudflare stays in front of the site, add it.
9. **Retention periods.** Accounting records are described as kept "for as
   long as the law requires". Give a number of years once the accountant
   confirms it.
10. **Guest cleanup.** The policy says unused guest records will be cleared
    after 30 days once that job runs. There is no such job in the code yet;
    either build it or change the sentence.

## The lawyer must advise on

1. **Sensitive data.** Whether gender and try-on photos count as sensitive
   personal data under the Act, and whether try-on needs an explicit
   consent step recorded in the app.
2. **Impact assessment.** Whether AI processing of photos requires a data
   protection impact assessment.
3. **Transfers.** The safeguard relied on for Google (try-on images are
   processed outside Kenya) and for the email and hosting providers.
4. **Liability cap.** Whether to set an amount in "When things go wrong".
5. **Courts.** The choice of Kenyan courts and the governing law wording.
6. **Access and portability.** There is no data export route in the API;
   copies of data are handled by hand. Confirm that is acceptable for now.

## Already answered by the code (for reference)

- Try-on images are made by Google through its Gemini API; the photo goes
  with the outfit description only.
- Pickup orders go through Pick Up Mtaani, which gets the recipient name
  and phone number.
- Sellers see the buyer's display name, the order lines, the delivery
  method and progress; not the phone number or email.
- Account deletion: signed out everywhere at once, 14 day grace, then the
  hourly sweep in `apps/api/src/services/deletion.ts` erases what the
  policy lists and keeps orders, payments, the credit ledger, reviews and
  the shop.
- Web cookies all start with `nima`: the session token, a short lived
  session cache, and the OAuth state cookie during a Google or Apple sign
  in.
- Reporting looks and people exists in the app; comments can be hidden by
  staff.
