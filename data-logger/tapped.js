// A phone held to a board's NFC tag opens this page as …/data-logger/?board=D892 (the firmware's
// src/nfc/nfc_tag.c writes the URL). The page then offers to connect to that board alone. Pure,
// so tests/dashboard/tapped.test.mjs runs it in Node.
//
// Boards keep the firmware they were last flashed with, so this has to read every URL format a
// release has ever put on a tag (tests/dashboard/nfc-tag-formats.mjs lists them): formats only
// ever gain parameters, unknown ones are ignored, and a change in meaning comes with a new `v`. A
// URL without `v` is version 1. Anything unreadable is no board, and the page offers plain Add
// board. No imports: `task release` loads the published copy of this file on its own.

export const BOARD_PARAM = "board";
export const VERSION_PARAM = "v";

/** Tag URL versions this page reads. */
const READABLE_VERSIONS = new Set(["1"]);

/** The board ID a tag opened the page for ("D892"), or null. Four hex digits today; eight would
 * be a widened ID (the board's name grows to match). */
export function tappedBoardId(search) {
  const params = new URLSearchParams(search);
  if (!READABLE_VERSIONS.has(params.get(VERSION_PARAM) ?? "1")) return null;
  const id = params.get(BOARD_PARAM);
  return id && /^([0-9A-Fa-f]{4}|[0-9A-Fa-f]{8})$/.test(id) ? id.toUpperCase() : null;
}

/** The page's own address without the tag's parameters, so a reload doesn't ask for the board
 * again. */
export function withoutTappedBoard(href) {
  const url = new URL(href);
  url.searchParams.delete(BOARD_PARAM);
  url.searchParams.delete(VERSION_PARAM);
  return url.href;
}

/** The Bluetooth name a board with this ID advertises (src/board_id/board_id.c). */
export const boardName = (id) => `nrf-controller-${id}`;
