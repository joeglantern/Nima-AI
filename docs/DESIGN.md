# Nima design system

The source of truth is `Nima's brand book.pdf` and the screens in `Design/`.
Nothing here is invented: every value is taken from one of those two.

---

## 1. Brand

**Nima** means radiance or brilliance: light, positivity.
Positioning: *Your personal shopper*. An AI shopping companion that lets people
**see, not guess**.

**Personality:** intelligent, refined, approachable. A trusted personal shopper,
calm and attentive.

**Voice:** confident, intelligent, approachable, polished, trustworthy. Polished
but conversational. Guides without pressure.

**Writing rules that follow from that voice**
- Short sentences. Say the thing.
- Never hype, never exclamation marks in interface copy.
- A control says what happens: "Try it on", then "Saved to your looks".
- Errors say what went wrong and what to do next. No apologies.
- Kenyan English, KSh for money, local terms where they are natural.
- Never em dashes. Use a comma, a full stop, or a colon.

---

## 2. Colour

Exactly as the brand book defines them.

### Light mode
| Role | Hex | RGB |
|---|---|---|
| Text | `#2D2926` | 45, 41, 38 |
| Primary | `#5C2A33` | 92, 42, 51 |
| Secondary | `#A67C52` | 166, 124, 82 |
| Background | `#FAF8F5` | 250, 248, 245 |

### Dark mode
| Role | Hex | RGB |
|---|---|---|
| Text | `#F5F0E8` | 245, 240, 232 |
| Primary | `#A66B73` | 166, 107, 115 |
| Secondary | `#C9A07A` | 201, 160, 122 |
| Background | `#1A1614` | 26, 22, 20 |

### Taken off the screens, not the brand book

The brand book names four colours. The screens use a handful more, and
leaving them out is what made the first build read as heavy and flat. Each of
these was sampled from a pixel in `Design/`, and the file is named so the
value can be checked.

| Role | Hex | Where it comes from |
|---|---|---|
| Accent | `BA635F` | The active navigation pill and the rings around profile highlights, `2.png` and `7.png` |
| Accent soft | `F3E8E5` | The fill behind the Love it action, `5.png` |
| Espresso | `4D2A13` | The sheet on the opening screen, `1.png` |
| Positive soft | `E4F6EC` | The field behind the credit balance, `7.png` |

**Usage**
- **Primary** is the brand colour: the main button, the selected tab on the
  profile, links, and the line Nima speaks.
- **Accent** is the lighter rose. It carries the active navigation pill, the
  active category chip and highlight rings. It is the one warm note against
  the burgundy, and without it the interface is a single dark colour repeated.
- **Secondary** is the warm sand: small flourishes, the Comments action, the
  mascot's lower half.
- **Espresso** is the deep brown behind the ways in on the opening screen.
  Nothing else uses it.
- Surfaces sit on top of the background: use white in light mode, and
  `#241D1A` in dark, both at the same radius as their siblings.
- Semantic colours are separate from the brand: success, warning and error must
  never be the primary or secondary colour. The credit balance is the one
  place green appears, because a balance is a quantity you hold rather than
  brand furniture, and the screens draw it that way.

---

## 3. Type

| Role | Family | Notes |
|---|---|---|
| Logo | **Le Jour Serif** | Wordmark only. Shipped as an asset, not a live font. |
| Headlines | **Cormorant Garamond** | Screen titles, the Nima wordmark in app, big numbers. |
| Body | **DM Sans** | Everything a person reads or taps. |
| Subheaders and paragraphs | **JetBrains Mono** | Labels, small caps, data, prices in tables. Used sparingly. |

Expo packages: `@expo-google-fonts/cormorant-garamond`,
`@expo-google-fonts/dm-sans`, `@expo-google-fonts/jetbrains-mono`. Le Jour Serif
is licensed separately and bundled as the logo asset.

**Scale** (from the screens: a phone at 1080 wide)
| Token | Size / line | Family | Used for |
|---|---|---|---|
| `display` | 48 / 52 | Cormorant Garamond 600 | Splash wordmark |
| `title` | 30 / 36 | Cormorant Garamond 600 | Screen titles, "Share an Item" |
| `heading` | 22 / 28 | DM Sans 600 | Section headers, sheet titles |
| `body` | 16 / 24 | DM Sans 400 | Everything else |
| `bodyStrong` | 16 / 24 | DM Sans 600 | Buttons, active tabs |
| `caption` | 13 / 18 | DM Sans 400 | Secondary text under cards |
| `micro` | 12 / 15 | DM Sans 500 | The word under an action icon: "Love it", "Saved" |
| `eyebrow` | 14 / 20 | DM Sans 600 | The line that introduces copy: "Nima Says" |
| `label` | 12 / 16, letter-spacing 0.14em, uppercase | JetBrains Mono 500 | "AI STYLIST" and nothing else |

**On the mono.** The brand book says JetBrains Mono is used sparingly, and the
screens prove it: there is no mono anywhere in the interface chrome. Small
labels are sentence case DM Sans. Setting them as tracked-out mono capitals,
which the first build did, is the single loudest tell that a screen was
generated rather than drawn, so `label` is now reserved for the wordmark's
"AI STYLIST" and for data in tables.

---

## 4. Shape and spacing

From the screens:
- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 56. Screen gutter is 16 on a
  phone, 24 from tablet width.
- **Radii:** cards 24, images 20, the small action squares under a look 14,
  buttons and pills 999 (fully round), bottom sheets 28 at the top corners
  only.
- **Cards** carry no border in light mode. They separate by background contrast
  and spacing, not outlines.
- **Shadows** are almost absent. The sheet over the feed is the one place with a
  soft shadow, and the feed behind it dims instead.

---

## 5. Components in the screens

| Screen | What it establishes |
|---|---|
| `1.png` splash + auth | Wordmark in Cormorant, `AI STYLIST` in mono caps, mascot, dark brown sheet with three full width white pill buttons: Apple, Google, email. |
| `2.png` Shop | Top pill navigation `Shop / For You / My Store`, active pill in the accent rose. Two column masonry, 20 radius, uneven heights. The heights are the point: a tile keeps the shape of its photograph, so the two columns never line up and the page does not read as a spreadsheet. |
| `3.png` Share sheet | "Share an Item", rounded search field, group icon, avatar grid with a check badge on the selected one, full width Send button in primary. |
| `4.png` auth over feed | The gate is a sheet over the content, never a separate screen. The feed stays visible behind it. |
| `5.png` For You | Full bleed look card, rounded, with Love it / Saved / Comments as small filled squares underneath, each tinted towards its own meaning, then "Nima Says" and one line of stylist copy tinted towards the burgundy. |
| `6.png` Share a look | Same sheet as 3, titled "Share an look" (fix the copy to "Share a look"). |
| `7.png` Profile | Avatar, name in Cormorant, email, credit pill in green on the mock but it must be the secondary colour, bio, style tags, link, highlight circles with primary rings, tab row `Looks / Lookbooks / Recreations / Orders`, empty state with a line drawing and one line of text. |
| `8.png` Lookbooks tab | Same header, tab row shifts to `Looks / Lookbooks / Wardrobe / Orders`, book line drawing empty state. |
| `9.png` Recreations tab | Text only empty state. |
| `10.png` Store view | "Clinton's Store" with the same header shape, a search field, orders empty state. |
| `11.png` Orders tab | Cart line drawing empty state. |

**Patterns to keep**
- Every empty state is a thin line drawing plus one calm sentence.
- Navigation is pills at the top, not a bottom tab bar, on the phone.
- Buttons are fully round and full width inside sheets.
- Avatars are circles with a primary ring when selected.

---

## 6. Icons and illustrations

- **Interface icons:** one line weight, rounded caps, 1.5px at 24px. Lucide
  matches this and is already in the previous codebase.
- **Empty state drawings:** a single heavy stroke, about a third of the width,
  drawn in the hairline colour. The screens give them real size. A small icon
  alone in the middle of a blank screen reads as an error rather than as
  nothing yet.
- **Mascot:** the egg character with the warm lower half. It appears on the
  splash, in the first run flow and when Nima is thinking. It never appears next
  to a price or in a seller screen.

---

## 7. Dark mode

The brand book defines dark mode, so the app ships both from the start. Every
colour is a token, and no component defines a hex value of its own. The
`ui` package exports the two palettes and a hook that picks one.

---

## 8. What "not AI looking" means here

- No purple to blue gradients, no glass panels, no glow.
- No emoji in the interface.
- No centred hero text on every screen: the screens are left aligned apart from
  the splash.
- Photography carries the colour. The interface stays warm and quiet so the
  clothes stand out.
- Copy is specific. "See yourself in every outfit" is the tone, not "Unlock your
  style journey".

---

## 9. Development imagery

Until sellers upload real photographs the seed makes its own, and what it
makes changes how the whole app reads. Two rules, both learned by putting the
grid next to `Design/2.png`:

- **No text inside the picture.** A tile that prints its own name reads as a
  mockup, and the title already sits underneath it.
- **Not every photograph is the same shape.** The seed cycles through six
  portrait shapes between 4:5 and 5:8 and records the real size on the row, so
  the masonry staggers and the layout can be judged honestly.

They are soft washes with a hanger drawn faintly over them: obviously a
stand-in, quiet enough to let the layout be the thing you look at. See
`packages/db/prisma/seed-media.ts`. The final artwork comes from the prompts
in `ASSETS.md`.
