// Who should be the radio clock source without being told: one board connected on its own is the
// source, and so the pointer, and two boards that each were alone meet with one source between
// them. Pure, so tests/dashboard/clock-roles.test.mjs runs it in Node.

/**
 * The role changes to make now, as [{ board, role }]. `boards`: the connected boards with clock
 * sync, earliest connected first. `isBusy(board)`: it's recording, so its role stays put.
 * `noneChosen`: the user picked no source. A listener already hearing a source (state "synced")
 * isn't alone, whatever the page has connected.
 */
export function clockRoleChanges(boards, { isBusy = () => false, noneChosen = false } = {}) {
  if (boards.some(isBusy)) return [];
  const sources = boards.filter((board) => board.clock.role === "source");
  if (sources.length > 1) return sources.slice(1).map((board) => ({ board, role: "listener" }));
  const [only] = boards;
  if (boards.length !== 1 || noneChosen || only.clock.role === "source" || only.clock.state === "synced") return [];
  return [{ board: only, role: "source" }];
}
