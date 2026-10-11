/**
 * The feed's sample looks.
 *
 * One entry per photograph in seed-assets/looks, in file order. The copy is
 * written to the picture: what is actually being worn, and one line from
 * Nima about why it works. `slots` says which kinds of piece from the sample
 * shops are linked underneath as "shop the look"; they are pieces in the
 * same spirit, not the garments in the photograph, which belong to the
 * people wearing them.
 *
 * The photographs come from Wikimedia Commons under CC BY and CC BY-SA, and
 * their credits are in seed-assets/looks/manifest.json. The seed appends
 * the credit to every caption.
 */

export interface SeedLook {
  file: string;
  title: string;
  caption: string;
  nimaSays: string;
  slots: Array<'TOP' | 'BOTTOM' | 'FULL_BODY' | 'OUTERWEAR' | 'SHOES' | 'BAG' | 'JEWELLERY'>;
  likes: number;
  /** Where you would wear it. The circles across the top of For You. */
  occasions: string[];
}

export const SEED_LOOKS: SeedLook[] = [
  {
    file: 'look-00.jpg',
    title: 'Saffron on stage',
    caption: 'One colour, a lot of fabric, and the confidence to let it move.',
    nimaSays:
      'A single bold colour head to toe reads as tailoring, not costume. Keep the jewellery tiny.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 214,
    occasions: ['celebration', 'date night'],
  },
  {
    file: 'look-01.jpg',
    title: 'Print, sleeves, attitude',
    caption: 'A blue and white kitenge with drama in the sleeve.',
    nimaSays:
      'When the print is busy, let the silhouette be simple and put the volume in one place.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 132,
    occasions: ['celebration', 'weekend'],
  },
  {
    file: 'look-02.jpg',
    title: 'Wide leg, high shine',
    caption: 'Palazzo trousers in a loud print, with gold at the neck and wrist.',
    nimaSays: 'A black top under a print this strong gives the eye somewhere to rest.',
    slots: ['TOP', 'BOTTOM', 'JEWELLERY'],
    likes: 176,
    occasions: ['date night', 'celebration'],
  },
  {
    file: 'look-03.jpg',
    title: 'Beach-day maxi',
    caption: 'Striped kitenge maxi skirt with a yellow crop top.',
    nimaSays:
      'Horizontal stripes on a full skirt look best with something cropped and plain on top.',
    slots: ['TOP', 'BOTTOM', 'JEWELLERY'],
    likes: 98,
    occasions: ['holiday', 'weekend'],
  },
  {
    file: 'look-04.jpg',
    title: 'The print blazer',
    caption: 'An Ankara blazer over a white shirt and cream trousers.',
    nimaSays: 'One printed piece on a neutral base is the easiest way to wear print to the office.',
    slots: ['OUTERWEAR', 'TOP', 'BOTTOM'],
    likes: 241,
    occasions: ['office'],
  },
  {
    file: 'look-05.jpg',
    title: 'Fit and flare, after dark',
    caption: 'A violet print skater dress with dark heels.',
    nimaSays: 'A nipped waist and a skirt that stops at the knee flatters almost everyone.',
    slots: ['FULL_BODY', 'SHOES'],
    likes: 87,
    occasions: ['date night'],
  },
  {
    file: 'look-06.jpg',
    title: 'Mustard and a painted tee',
    caption: 'Wide yellow trousers, a graphic tee and a long open vest.',
    nimaSays:
      'Matching your trousers to one colour in the print on your top ties the whole thing together.',
    slots: ['TOP', 'BOTTOM', 'OUTERWEAR'],
    likes: 153,
    occasions: ['weekend'],
  },
  {
    file: 'look-07.jpg',
    title: 'Sunday best',
    caption: 'A golden print day dress, cinched with a wide black belt.',
    nimaSays: 'The belt is doing the work here. A full skirt needs a defined waist.',
    slots: ['FULL_BODY', 'BAG'],
    likes: 189,
    occasions: ['celebration', 'weekend'],
  },
  {
    file: 'look-08.jpg',
    title: 'Matching, not identical',
    caption: 'Two different prints in the same colours, for a couple who dress together.',
    nimaSays:
      'Coordinate the palette, not the pattern. It looks planned without looking like a uniform.',
    slots: ['TOP', 'FULL_BODY'],
    likes: 305,
    occasions: ['wedding', 'celebration'],
  },
  {
    file: 'look-09.jpg',
    title: 'Violet hour',
    caption: 'Purple check, a beaded collar and stacked bracelets.',
    nimaSays:
      'Statement beads and a strong colour belong together. Keep the hair and make-up clean.',
    slots: ['TOP', 'JEWELLERY'],
    likes: 121,
    occasions: ['celebration'],
  },
  {
    file: 'look-10.jpg',
    title: 'Purple and black, easy',
    caption: 'A purple top with a cut-out, a black pencil skirt and beaded sandals.',
    nimaSays: 'Two solid colours and one beaded detail. Simple enough to wear on a Tuesday.',
    slots: ['TOP', 'BOTTOM', 'SHOES'],
    likes: 94,
    occasions: ['office', 'weekend'],
  },
  {
    file: 'look-11.jpg',
    title: 'Guest of honour',
    caption: 'Fuchsia satin with a long train and a gele to match, for a family wedding.',
    nimaSays: 'At a wedding, one dramatic element is enough. Here it is the train.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 267,
    occasions: ['wedding'],
  },
  {
    file: 'look-12.jpg',
    title: 'Runway mermaid',
    caption: 'A floral mermaid gown from Lagos Fashion and Design Week.',
    nimaSays: 'A fitted mermaid cut makes a sweet floral print feel grown up.',
    slots: ['FULL_BODY'],
    likes: 198,
    occasions: ['wedding', 'celebration'],
  },
  {
    file: 'look-13.jpg',
    title: 'Sheer over print',
    caption: 'A sheer blue cape over a printed column dress, also from Lagos.',
    nimaSays: 'Layering something sheer over print softens it without hiding it.',
    slots: ['FULL_BODY', 'OUTERWEAR'],
    likes: 176,
    occasions: ['celebration', 'date night'],
  },
  {
    file: 'look-14.jpg',
    title: 'One shoulder, two pieces',
    caption: 'A red and gold print set with a one-shoulder top and a long skirt.',
    nimaSays: 'A two-piece in one print can be worn together, or split up with plain pieces.',
    slots: ['TOP', 'BOTTOM'],
    likes: 143,
    occasions: ['date night', 'holiday'],
  },
  {
    file: 'look-15.jpg',
    title: 'Monochrome print',
    caption: 'A black and white patterned dress with a fluted shoulder.',
    nimaSays:
      'Print in black and white is the quietest way to wear pattern. It goes with everything.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 112,
    occasions: ['office'],
  },
  {
    file: 'look-16.jpg',
    title: 'Market morning',
    caption: 'A long draped vest with print trim over a white tee.',
    nimaSays: 'A long open layer makes jeans and a tee look like a decision.',
    slots: ['OUTERWEAR', 'TOP', 'SHOES'],
    likes: 76,
    occasions: ['weekend'],
  },
  {
    file: 'look-17.jpg',
    title: 'Poet sleeves in the market',
    caption: 'A white puff-sleeve blouse with a long grey print skirt.',
    nimaSays: 'Big sleeves want a slim skirt. Volume in one place only.',
    slots: ['TOP', 'BOTTOM', 'JEWELLERY'],
    likes: 229,
    occasions: ['weekend', 'office'],
  },
  {
    file: 'look-18.jpg',
    title: 'Same blouse, new street',
    caption: 'The white puff-sleeve blouse again, with gold hoops and a stack of bangles.',
    nimaSays: 'A good white blouse earns its place by being worn three different ways.',
    slots: ['TOP', 'JEWELLERY'],
    likes: 184,
    occasions: ['weekend', 'date night'],
  },
  {
    file: 'look-19.jpg',
    title: 'Green kaftan by the sea',
    caption: 'A flowing green print kaftan with a white headwrap.',
    nimaSays: 'A kaftan is the most comfortable thing you can wear that still looks dressed.',
    slots: ['FULL_BODY'],
    likes: 89,
    occasions: ['holiday'],
  },
  {
    file: 'look-20.jpg',
    title: 'Yellow in the garden',
    caption: 'A pleated yellow skirt, white vest and a woven basket bag. Shot in Kenya.',
    nimaSays: 'A bright skirt with a white top is summer in two pieces. Add texture with the bag.',
    slots: ['TOP', 'BOTTOM', 'BAG'],
    likes: 312,
    occasions: ['weekend', 'holiday'],
  },
  {
    file: 'look-21.jpg',
    title: 'Made in Kenya, runway',
    caption: 'A patterned shift with a feathered headpiece, from a Kenyan designer show.',
    nimaSays: 'When the dress is a graphic, the shape can be as simple as a shift.',
    slots: ['FULL_BODY'],
    likes: 158,
    occasions: ['office', 'celebration'],
  },
  {
    file: 'look-22.jpg',
    title: 'Stripes on stage',
    caption: 'A pink and violet striped wrap worn over the shoulder.',
    nimaSays: 'A wrap worn on one shoulder gives you drape and a clean line on the other side.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 104,
    occasions: ['celebration'],
  },
  {
    file: 'look-23.jpg',
    title: 'Wine red, together',
    caption: 'A couple in wine agbada and a draped wrapper for their traditional wedding.',
    nimaSays: 'Deep red reads rich in photographs. Cream accents keep it from looking heavy.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 276,
    occasions: ['wedding'],
  },
  {
    file: 'look-24.jpg',
    title: 'Teal lace and a gele',
    caption: 'A teal lace peplum blouse with a gele in the same colour.',
    nimaSays: 'Matching the headwrap to the blouse makes a strong colour look effortless.',
    slots: ['TOP', 'JEWELLERY'],
    likes: 233,
    occasions: ['wedding'],
  },
  {
    file: 'look-25.jpg',
    title: 'Peach, soft and finished',
    caption: 'Peach lace with a sculpted gele and henna.',
    nimaSays: 'A soft colour still feels like an occasion when the texture is lace.',
    slots: ['TOP', 'JEWELLERY'],
    likes: 247,
    occasions: ['wedding'],
  },
  {
    file: 'look-26.jpg',
    title: 'Ribbon stripes',
    caption: 'A sage dress with rainbow ribbon trim, worn with sunglasses on a sunny afternoon.',
    nimaSays: 'Trim along the hem and sleeves gives a plain dress a lot of personality.',
    slots: ['FULL_BODY'],
    likes: 119,
    occasions: ['weekend', 'holiday'],
  },
  {
    file: 'look-27.jpg',
    title: 'Floral, up close',
    caption: 'A big lilac and teal floral print in a relaxed, wide-sleeved cut.',
    nimaSays: 'An oversized floral on a loose cut is the comfortable way to wear a big print.',
    slots: ['FULL_BODY', 'JEWELLERY'],
    likes: 137,
    occasions: ['weekend'],
  },
];
