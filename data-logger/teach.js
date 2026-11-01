// Teaching a board a phrase (docs/voice-commands.md): the choices the page makes from the board's
// enrollment status. Pure functions only, so tests/dashboard/teach.test.mjs runs them in Node.

export const ENROLLMENT_SLOTS = 4; // src/keyword/enrollment.h
export const MOST_TAKES = 8; // FEW_SHOT_MAX_SHOTS
const FEWEST_GOOD_TAKES = 3;
// The recorded phrases enrolled at 0.83-0.95 and 3.2-5.9; these mark takes well outside that.
const LOW_AGREEMENT = 0.7;
const LOW_DISTINCTION = 2;

/** The first slot holding no phrase, or -1 with all of them taken. */
export function firstFreeSlot(usedSlots) {
  for (let slot = 0; slot < ENROLLMENT_SLOTS; slot++) if (!(usedSlots & (1 << slot))) return slot;
  return -1;
}

/** The slot of the board's `index`th phrase: the vocabulary lists them in slot order, without gaps. */
export function slotOfPhrase(usedSlots, index) {
  let seen = -1;
  for (let slot = 0; slot < ENROLLMENT_SLOTS; slot++) {
    if (usedSlots & (1 << slot) && ++seen === index) return slot;
  }
  return -1;
}

/** What to tell the speaker after a take: { text, bad }. */
export function takeAdvice({ result, heardNothing, takes, agreement, distinction, outlier }) {
  if (heardNothing) return { text: "Nothing heard. Say it again, a little louder.", bad: true };
  if (result) return { text: `The board couldn't use that take (error ${result}).`, bad: true };
  if (takes === 0) return { text: "", bad: false };
  if (takes >= 2 && agreement < LOW_AGREEMENT) {
    return { text: `Take ${outlier + 1} doesn't match the others. Say it again the same way, or start over.`, bad: true };
  }
  if (takes < FEWEST_GOOD_TAKES) return { text: `${takes} of at least ${FEWEST_GOOD_TAKES} takes. Say it again.`, bad: false };
  if (distinction < LOW_DISTINCTION) {
    return { text: "It sounds close to everyday speech, so it may be missed or fire by accident. A longer phrase is safer.", bad: true };
  }
  return { text: `${takes} takes, and clear of everyday speech. Save it, or add more.`, bad: false };
}
