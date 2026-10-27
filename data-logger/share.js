// Sharing a saved session through the system's share sheet (navigator.share), e.g. to mail it from
// a phone. Pure (Node test): app.js hands it what it saved and shares what this returns.

// Chrome shares only some file types; a session's CSVs and session.json are among them, its raw
// flash logs (.bin) aren't.
const SHAREABLE = /\.(csv|json|txt)$/;
// Most mail services refuse a message over about this much.
export const MAIL_LIMIT_BYTES = 25e6;

/**
 * The files of `session` among saved `entries` ([path, File], each path from the save folder down,
 * "/"- or "__"-separated as app.js's saveFile() writes them), each named by its path joined with
 * "__" (as the page's downloads are), so boards' same-named files stay apart:
 * "walk__D892__imu.csv". `makeFile(parts, name, options)` builds a renamed copy (the File
 * constructor in the page).
 */
export function sessionShareFiles(entries, session, makeFile) {
  const files = [];
  for (const [path, file] of entries) {
    const parts = path.split(/\/|__/);
    if (parts[0] !== session || !SHAREABLE.test(path)) continue;
    files.push(makeFile([file], parts.join("__"), { type: file.type }));
  }
  return files;
}

/** Their size in all, and whether that is too much to mail. */
export function shareSize(files) {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return { bytes, tooBigToMail: bytes > MAIL_LIMIT_BYTES };
}
