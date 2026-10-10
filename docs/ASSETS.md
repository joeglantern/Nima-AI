# Artwork to generate

Prompts for the images the app needs, grouped so each batch can be pasted
into ChatGPT in one go. Every prompt already carries the brand colours and
the house style, so the results sit together rather than looking like a
collection.

**Palette to keep repeating in prompts**
- burgundy `#5C2A33` (primary)
- warm gold `#A67C52` (secondary)
- ivory `#FAF8F5` (background)
- deep brown ink `#2D2926`
- dark mode ground `#1A1614`

**House rules for every image**
- Warm, calm, editorial. Nothing neon, no purple to blue gradients, no glass.
- Flat or softly shaded. No photo-real 3D render clichés, no lens flare.
- Nothing that looks machine made: no uncanny hands, no gibberish text.
- Transparent background unless the prompt says otherwise.
- Square, 2048 by 2048, PNG.

Save results into `apps/app/assets/` with the file names given, then delete
`apps/app/scripts/make-placeholder-assets.mjs` and its placeholders.

---

## Batch 1: the mascot

The character on the splash screen. It appears again while Nima is thinking,
and in first run screens. Generate all five in one go so the character stays
consistent.

> Create five images of a single original mascot character for a Kenyan
> fashion app called Nima. The character is a soft rounded egg or bean shape,
> about one and a half times taller than wide, with no arms or legs. The top
> half is warm ivory `#FAF8F5`, the bottom half is warm gold `#A67C52`, with a
> soft diagonal edge where they meet. The face is minimal: two closed curved
> eyes shaped like gentle arcs and a small rounded smile, all in deep burgundy
> `#5C2A33`. Lighting is soft and warm, with a gentle shadow underneath. Flat
> illustration with subtle shading, no outlines, no texture, no text.
> Transparent background, square, 2048 by 2048 pixels.
>
> 1. Happy: eyes closed in a smile, small gold sparkles and tiny floating gold
>    spheres around it. This is the splash screen image.
> 2. Thinking: eyes looking up and to the side, one small gold sparkle above
>    its head, body tilted slightly.
> 3. Delighted: leaning forward, bigger smile, two gold sparkles.
> 4. Resting: eyes closed, calm, no sparkles. For quiet empty states.
> 5. Peeking: only the top two thirds visible as though rising from the bottom
>    edge of the frame, looking up.
>
> Keep the proportions, colours and face identical across all five. Only the
> expression and the sparkles change.

Save as `mascot.png` (image 1), `mascot-thinking.png`, `mascot-delighted.png`,
`mascot-resting.png`, `mascot-peeking.png`.

---

## Batch 2: app icon and store artwork

> Create four images for a fashion app called Nima, using a warm editorial
> palette: burgundy `#5C2A33`, warm gold `#A67C52`, ivory `#FAF8F5`.
>
> 1. App icon, 1024 by 1024, square with no rounded corners and no
>    transparency. A solid burgundy `#5C2A33` background with a single capital
>    letter N centred, in an elegant high contrast serif, in ivory `#FAF8F5`.
>    The letter fills about half the width. Nothing else: no border, no
>    gradient, no shadow, no mascot.
> 2. The same icon with the colours swapped: ivory background, burgundy
>    letter. 1024 by 1024.
> 3. Android adaptive icon foreground, 1024 by 1024, transparent background,
>    the burgundy letter N centred inside the middle 60 percent of the frame.
> 4. A feature graphic for app stores, 1024 by 500, ivory background, the
>    wordmark "Nima" in an elegant serif in burgundy on the left, and the egg
>    mascot from the previous batch on the right, with a few small gold
>    sparkles. Plenty of empty space.

Save as `icon.png`, `icon-light.png`, `adaptive-icon.png`, `store-feature.png`.

---

## Batch 3: empty state drawings

These already exist as inline line drawings in the app, so this batch is
optional. Generate it only if you want more character than a plain line.

> Create five minimal line drawings for an app's empty states. Single
> continuous line style, stroke weight even throughout, rounded line ends, no
> fill, no shading, no text. Drawn in deep brown `#2D2926` on a transparent
> background, square, 1024 by 1024, with the subject centred and occupying
> about 60 percent of the frame.
>
> 1. A clothes hanger, seen straight on.
> 2. An open book lying flat, pages fanned slightly.
> 3. A simple shopping basket.
> 4. A wardrobe with two doors, slightly open.
> 5. A four pointed sparkle beside a smaller one.

Save as `empty-hanger.png`, `empty-book.png`, `empty-basket.png`,
`empty-wardrobe.png`, `empty-sparkle.png`.

---

## Batch 4: style vibe tiles for the questionnaire

The questionnaire asks which styles someone reaches for. Tiles read faster
than words, and these are the eight the app asks about.

> Create eight square fashion mood tiles, 1024 by 1024, for a Kenyan style
> questionnaire. Each is a flat editorial collage: a simple warm background
> drawn from ivory `#FAF8F5`, warm gold `#A67C52` or burgundy `#5C2A33`, with
> one or two pieces of clothing drawn in a clean illustrative style, no faces,
> no people, no text, no logos. Soft shadows, confident shapes.
>
> 1. Smart casual: a crisp shirt and tailored trousers.
> 2. Streetwear: an oversized boxy tee and cargo trousers.
> 3. Heritage: a shirt with a bold Kenyan kitenge print panel.
> 4. Minimal: a plain knit and straight trousers in two close tones.
> 5. Elegant: a long wrap dress with a tie waist.
> 6. Sporty: a track jacket and trainers.
> 7. Bold colour: a bright jacket against a contrasting background.
> 8. Vintage: a worn denim jacket and a pleated skirt.
>
> Keep the illustration style, line weight and palette identical across all
> eight so they read as one set.

Save as `vibe-smart-casual.png`, `vibe-streetwear.png`, `vibe-heritage.png`,
`vibe-minimal.png`, `vibe-elegant.png`, `vibe-sporty.png`, `vibe-bold.png`,
`vibe-vintage.png`.

---

## Batch 5: placeholders and small pieces

> Create four images for a fashion app, warm palette of burgundy `#5C2A33`,
> gold `#A67C52` and ivory `#FAF8F5`, flat illustration, no text.
>
> 1. A product image placeholder, 1200 by 1600, ivory background with a faint
>    gold outline of a folded garment in the centre. Very low contrast: it
>    should recede, not compete with real photos beside it.
> 2. A shop logo placeholder, 512 by 512, a soft gold circle with a simple
>    burgundy storefront awning drawn inside it.
> 3. A notification icon, 96 by 96, transparent background, a solid white
>    silhouette of a four pointed sparkle. Android tints this, so it must be
>    pure white on transparent with no detail.
> 4. A wide banner for the credits screen, 1600 by 900, burgundy background,
>    a scatter of gold sparkles of three different sizes, denser at the top
>    left, empty space at the bottom right where text will sit.

Save as `placeholder-product.png`, `placeholder-store.png`,
`notification-icon.png`, `credits-banner.png`.

---

## What not to generate

- **Clothing photography.** Real products come from sellers. Generated clothes
  on generated people would be a lie in a shopping app.
- **Faces.** Nima shows real people in real clothes. Invented faces in the
  interface undercut that.
- **Icons for the interface.** Those are drawn in code so they take the theme
  colour and stay sharp at every size.

### Where the line actually falls

The first rule is about what a shopper sees, not about what a developer
looks at while building. A seeded shop of seven grey rectangles cannot be
judged: you cannot tell whether the masonry reads, whether a tile fights the
title under it, or whether a dress and a pair of shoes tell apart at a
glance.

So the seed uses the eight outfit drawings from Batch 4, and that is
allowed because every part of it is true:

- They are **drawings**, plainly. Nobody mistakes a flat illustration for a
  photograph of a real garment.
- They live behind a **`seed/` key** and the seed is the only thing that
  writes one.
- No drawing is ever attached to a real seller's listing.

Where there is no drawing for a category, sunglasses, a bag, a necklace,
the seed uses `placeholder-product.png`, the faint outline that means **no
photo yet**. That is the honest answer. Putting a jumper behind "Round frame
sunglasses" would be the thing this section is warning about, in miniature.

---

## Cutting the sheets up

An image model returns a contact sheet: several pieces laid out on one
square. `node scripts/extract-assets.mjs` cuts them into the files above.

It is worth reading before adding a batch, because three things make a bad
slice very easy and all three have already happened here:

- **A painted checkerboard is not transparency.** Two of the sheets came
  back with the grey and white squares that mean "transparent" in an editor
  drawn in as pixels. Cropping straight would bake a chessboard into the
  asset.
- **A halo is not a subject.** The mascot sheet carries a fringe of white
  speckle at alpha 1 out of 255: invisible in the file, and loud in a
  bounding box measured without thresholding first.
- **A sparkle is not part of the egg.** The mascot and the sparkles around
  it are separate islands of pixels, so taking the largest island alone
  slices the sparkles off at the edge of the character. Nearby pieces are
  grouped before anything is cut.

Nothing is stretched. Every piece is fitted inside its target size with its
own proportions kept.
