---
paths:
  - "assets/js/cat.js"
---

# The footer cat (`assets/js/cat.js`)

30 s after load an orange tabby walks in along the footer line, washes, yawns and curls up above the copyright
with its tail wrapped round its front, and sleeps. `NAP` (10 min, wall clock from when it fell asleep, kept across pages as `nap`)
later the page calls `wake()`, but only while the footer is on screen and not while it is stroked or purring: it uncurls, yawns and
walks off the left end (`leave()`, ending in a `gone` act); the page then removes the lane and starts over with the 30 s `DELAY`. Hover gives
content `^` eyes, a click a slow blink and a heart, and stroking (the pointer back and forth over it) kneading paws (`KNEAD`).
It purrs only after a click, for `PURR` seconds: the canvas buzzes by one screen pixel (a CSS transform, finer than an art
pixel). On its way in, a click stops it to look round at you (`lookAct`) and stroking sits it down to knead (`petAct`); both
`interrupt` the timeline, and a walk then carries on to where it was going. The sprite acts are `busy` and ignore it. The hit box follows the drawn pixels. It is pixel art (2 px per art pixel, a 48 px lane) drawn from a **rig** (body, head, two-bone IK legs, a tail
chain) posed by a timeline of acts; each frame is drawn 4x fine on an offscreen canvas and every art pixel takes the
majority palette color of its block, so it stays crisp. Eye (a dark pupil with a greenish-yellow `--eye` iris behind it) and nose are stamped as exact pixels, and the forehead stripes stay clear of the eye so they never read as a second one; curling up and sleeping
are hand-drawn letter-grid sprites (`CURL1`, `CURL2`, `SLEEP_IN`, `SLEEP_OUT`). It draws at 15 fps and its clock only runs
while the footer is on screen; reduced motion shows it asleep for good. It carries on across pages: the clock and the wait so far are
kept in `localStorage` (`footer-cat`) on `pagehide`, for 30 minutes, and the next page jumps the timeline to that clock. Coat colors are CSS variables on `.cat-lane` in main.css. A page can give it a hat: `cat_hat: baker` in its front matter puts `data-cat-hat` on `<body>` and cat.js
stamps that glyph from `HATS` on its head, rig and sleeping sprite alike (/recipes/ wears a baker's toque, /controls/ a mortarboard, `grad`; `--hat`, `--hat-shade`, `--hat-edge`, `--hat-tassel`, re-pointed per hat in main.css).
