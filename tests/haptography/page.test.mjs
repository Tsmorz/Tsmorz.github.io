// The page itself: every element app.js looks up exists, every module it imports is there, and
// nothing outside the folder is referenced (it is published on its own to the personal site).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./fixture.mjs";

const DIR = join(ROOT, "haptography");
let html = readFileSync(join(DIR, "index.html"), "utf8");
// The signal controls are generated from the site's data by Liquid.
const controls = readFileSync(join(ROOT, "_data/haptography.yml"), "utf8");
for (const [, id] of controls.matchAll(/id: (\w+), name:/g)) html += ` id="signal-${id}" id="range-${id}"`;
const scripts = readdirSync(DIR).filter((f) => f.endsWith(".js"));

test("every id app.js uses is in index.html", () => {
  const app = readFileSync(join(DIR, "app.js"), "utf8");
  const ids = new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
  for (const m of app.matchAll(/\["([\w-]+)", "(?:[\w-]+)"\]/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("imports resolve inside the folder", () => {
  for (const file of scripts) {
    const src = readFileSync(join(DIR, file), "utf8");
    for (const m of src.matchAll(/from "(\.[^"]+)"/g)) {
      assert.ok(m[1].startsWith("./"), `${file} imports ${m[1]} from outside the folder`);
      assert.ok(existsSync(join(DIR, m[1])), `${file} imports missing ${m[1]}`);
    }
  }
});

test("local files the page loads exist; external ones are only Google Fonts", () => {
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = m[1].split("?")[0];
    if (/^https?:/.test(url)) assert.match(url, /^https:\/\/fonts\.(googleapis|gstatic)\.com/);
    else assert.ok(existsSync(join(DIR, url)), `index.html loads missing ${url}`);
  }
});

test("popover keys have their popovers", () => {
  for (const m of html.matchAll(/popovertarget="([\w-]+)"/g)) assert.ok(html.includes(`id="${m[1]}" popover`), m[1]);
});
