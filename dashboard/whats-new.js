// What's new: the header key, lit while there are entries this browser hasn't seen, and the list it
// opens (changelog.js). Opening the list marks everything in it seen. Also marks a board whose
// firmware is older than the newest release the changelog names.
import { CHANGELOG, boardBehind, firmwareNote, latestFirmware, unseen } from "./changelog.js";

const $ = (id) => document.getElementById(id);
const SEEN_KEY = "whats-new-seen";

let getBoards = () => [];

function seenId() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markAllSeen() {
  try {
    localStorage.setItem(SEEN_KEY, CHANGELOG[0].id);
  } catch {
    /* storage blocked: the key stays lit for this browser */
  }
}

function renderKey() {
  const fresh = unseen(CHANGELOG, seenId()).length;
  $("whats-new-key").classList.toggle("unseen", fresh > 0);
  $("whats-new-key").title = fresh ? `What's new: ${fresh} change${fresh === 1 ? "" : "s"} since you last looked` : "What's new on this page and in the firmware";
}

function renderList() {
  const fresh = new Set(unseen(CHANGELOG, seenId()).map((entry) => entry.id));
  const versions = getBoards().filter((board) => board.connected).map((board) => board.firmwareVersion).filter(Boolean);
  $("whats-new-list").replaceChildren(...CHANGELOG.map((entry) => {
    const item = document.createElement("li");
    item.classList.toggle("fresh", fresh.has(entry.id));
    const head = document.createElement("h3");
    head.append(Object.assign(document.createElement("time"), { dateTime: entry.date, textContent: entry.date }), entry.title);
    const points = document.createElement("ul");
    points.append(...entry.items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    item.append(head, points);
    const note = firmwareNote(entry, versions);
    if (note) item.append(Object.assign(document.createElement("p"), { className: "fw-note", textContent: note }));
    return item;
  }));
}

export function initWhatsNew(options) {
  ({ getBoards } = options);
  $("whats-new").addEventListener("toggle", (event) => {
    if (event.newState !== "open") return;
    renderList(); // drawn before marking, so what's new still shows as new this time
    markAllSeen();
    renderKey();
  });
  renderKey();
}

/** The Boards list's firmware cell: the version, with an arrow and a hint if a newer release exists. */
export function firmwareMark(board) {
  const version = board.firmwareVersion;
  const latest = latestFirmware();
  if (!boardBehind(version, latest)) return { text: version || "–", title: version ? `Firmware v${version}` : "" };
  return { text: `${version} ↑`, title: `Firmware v${latest} is out: Settings › Firmware updates it over Bluetooth` };
}
