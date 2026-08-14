// Shot-list recipes. A recipe is an ordered set of shots the app walks the user
// through, then stitches back together in recipe order (not recording order),
// trimming each clip to its target length so the edit gets its rhythm for free.
//
// The hotel recipe implements docs/hotel-video-playbook.md.

/** Recording headroom over the target — extra footage is trimmed at stitch time. */
export function maxMsForShot(shot) {
  return Math.max(2500, shot.targetMs + 1500);
}

export const HOTEL_RECIPE = {
  id: 'hotel-room',
  title: 'Hotel room video',
  subtitle: 'Faceless · 18 seconds · 11 shots',
  hookPlaceholder: '£58 a night. Lisbon.',
  hookHelp: 'A price, a room number, or a claim people can check. Not "hotel room tour".',
  shots: [
    {
      key: 'view-open',
      title: 'The view',
      direction: 'Window or balcony filling the frame. Hold the phone still.',
      why: 'Your best frame, spent first. Saving it for the end loses the scroll.',
      targetMs: 1500,
      guide: 'thirds',
    },
    {
      key: 'keycard',
      title: 'Keycard + door',
      direction: 'Hand taps the card, green light, handle turns. Get the sound.',
      why: 'Resets the story to the start — and the beep is your best audio.',
      targetMs: 1500,
      guide: 'none',
      duck: true,
    },
    {
      key: 'walk-in',
      title: 'Walk through the door',
      direction: 'Walk forward into the room. No panning, just move.',
      why: 'Puts the viewer in your body. This is the POV anchor.',
      targetMs: 1500,
      guide: 'center',
    },
    {
      key: 'bed',
      title: 'The bed, wide',
      direction: 'Whole bed, headboard to foot. Centred and level — check the guide.',
      why: 'The one shot people judge a hotel on. Crooked kills it.',
      targetMs: 1500,
      guide: 'center',
    },
    {
      key: 'detail-1',
      title: 'Detail close-up',
      direction: 'Robe, slippers, book, turndown chocolate. Get close.',
      why: 'Details are what make a room read as expensive.',
      targetMs: 1000,
      guide: 'none',
    },
    {
      key: 'curtain',
      title: 'The curtain pull',
      direction: 'Phone still, hand sweeps the curtain open. Let the light flood in.',
      why: 'The most reliable reveal beat in hotel content. Cut lands on the beat.',
      targetMs: 1500,
      guide: 'thirds',
      duck: true,
    },
    {
      key: 'view-wide',
      title: 'The view, wider',
      direction: 'Same view, but with the room in the foreground. Slow pan across.',
      why: 'Pays off shot 1 in context. This is the frame people screenshot.',
      targetMs: 1500,
      guide: 'thirds',
    },
    {
      key: 'bathroom',
      title: 'Bathroom, wide',
      direction: 'Shoot from the doorway, lights on. Angle the mirror so you are not in it.',
      why: 'Bathrooms decide bookings. Square it up.',
      targetMs: 1500,
      guide: 'center',
    },
    {
      key: 'detail-2',
      title: 'Water running',
      direction: 'Rainfall shower head on, or the amenity bottles. Close and still.',
      why: 'Water is texture and sound — the cheapest luxury signal you can film.',
      targetMs: 1000,
      guide: 'none',
    },
    {
      key: 'feet',
      title: 'Feet up',
      direction: 'Legs on the bed or feet on the balcony rail, view beyond. Low angle.',
      why: 'The only human shot. Reads as you, shows no face.',
      targetMs: 1500,
      guide: 'thirds',
    },
    {
      key: 'hold',
      title: 'Hold on the view',
      direction: 'Frame it exactly like shot 1 and hold. Do not move.',
      why: 'Gives the video an ending, and loops invisibly back to the start.',
      targetMs: 4000,
      guide: 'thirds',
    },
  ],
};

export const RECIPES = [HOTEL_RECIPE];

export function getRecipe(id) {
  return RECIPES.find((r) => r.id === id) || HOTEL_RECIPE;
}

/** Total runtime of a recipe in seconds, as planned. */
export function recipeSeconds(recipe) {
  return recipe.shots.reduce((sum, s) => sum + s.targetMs, 0) / 1000;
}
