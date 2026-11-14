# Dyna-soar (`/glide-path/`)

`glide-path/` has its own look outside the site layouts (`layout: null` front matter renders `_data/glide.yml`):
`index.html` is markup, `glide.css` the styles, `glide-app.js` the page, `glide-plan.js` the pure plan/units/destination logic, `glide-core.js` the maths (no DOM) and
`glide-worker.js` the route search; `glide-3d.js` the 3D view (below). Pick a launch point and set glide ratio, airspeed, launch height, wind, a terrain margin,
the steepest slope you would land on and **how far away you can still see the glider**. It loads a 7 × 7 block of Terrarium
terrain tiles (AWS Terrain Tiles) round the launch and works out the reach two ways: 720 straight glides (`castRays`,
stopping where the glide path minus the margin meets the ground) and a route search on a half-resolution grid
(`reachGrid`: a max-height Dijkstra over 16 neighbours with wind, in the worker) that must stay within the sight distance,
so a glide can curve round a hill. Ground beyond the sight ring is shown as a faint wash ("reachable, but out of sight").
**A long glide gets coarser terrain, never a cut-off**: `chooseZoom` picks the most detailed zoom (13 down to 9) whose block
holds the furthest possible glide, and the page steps down a zoom if a glide still reaches the block's edge. For one launch
and one set of settings it only ever steps down (`zoomKey`): going back up could flip between two zooms for ever, redrawing
everything with nothing touched. **The ground at the launch always comes from zoom 13** (`groundAt13`, kept in `fineGround`),
whatever zoom the reach runs on: coarser terrain smooths a peak tens of metres lower, which used to lower the glider's start
and shrink the reach as the zoom changed. A route asked for is kept across a zoom change and worked out again. Long-press
(right-click) a spot for the best route there. The cross-section is drawn on the map too (white casing, solid while the
glider flies, dashed past where it lands, dots at the strip's distance marks; the route itself when one is shown), and the two
share one cursor: scrubbing the strip moves a probe on the map (panning it into view), and hovering the map within 18 px of
the trace moves the strip's cursor (`showCursor`; the strip is redrawn from a saved `ImageData`, not recomputed). A badge under
the layers button shows the wind: an arrow the way it blows, its speed and where it comes from (`windBadge`). `script/test-glide` (`task check:glide`, in `check:fast`) guards the core,
including the service worker in a mock.

**Base maps and contours**: Street, Topo, Satellite (Esri World Imagery, online only, never stored: it shows what the ground
is, a field or a forest, which slope alone can't) and the offline hillshade; the choice is kept as `base` (not when going
offline swaps in the hillshade). Over Satellite the map's colours switch to the imagery set (below). **Contour lines**
are an overlay drawn by the page from the same Terrarium tiles (`Contours` grid layer, `terrWindow`; `GlideCore.contours`:
3 × 3 smoothing, then marching squares, saddles split by the cell's mean), so they work offline and over any base: light with a
dark edge over imagery, brown over the light maps. Each tile contours a window with a 2 px margin, so lines meet across tile
edges; above zoom 13 it contours the part of the zoom-13 tile under it and draws it sharp. Spacing is `contourStep` (by zoom
and units; every 5th line thick), shown in the Key. They come on with Satellite the first time; after that `contours` keeps the
choice. Google's imagery is not an option: its terms forbid it beside a non-Google map and need a billed API key.

**3D** (the 3D | 2D button under the locate button; kept as `view3d`): the same map tilted, drawn by **MapLibre GL**, vendored
in `glide-path/lib/maplibre/` (5.24.0, source-map comment stripped, BSD licence kept) and loaded with `glide-3d.js` only the
first time 3D is opened. Its mountains are the same Terrarium tiles (raster-dem, `encoding: 'terrarium'`, maxzoom 13, true
scale), so the reach, which is the 2D overlay's own canvas as a `canvas` source (copied once per redraw: `play()` then
`pause()` after a render), lies on exactly the ground it was worked out on. The base follows the 2D layers menu; a MapLibre
hillshade goes over the light maps and is the whole base offline. Lines and points (outline, slope hits, sight ring, the
cross-section with its marks, the route, the probe) are read from the 2D map's Leaflet layers whenever the page calls
`mark3d()`, so the 2D map stays the one source of truth. The 3D map is a `.map3d` layer inside the Leaflet container (z 900:
over the panes, under the controls), so the Key, wind badge and layers menu stay; zoom, scale and attribution are hidden
(`.is-3d`), and its mouse, touch and wheel events are stopped there so the 2D map never pans or sets the launch from them.
In 3D a tap or dragging the pin moves the launch; long-press routes are 2D only. No WebGL: the button says so.
**Fly it** (beside the cross-section's title) follows the glide in 3D, the straight one or the long-press route, at its own
heights (the profile's `glide`): a chase camera 150 m behind and 80 m above the glider (`calculateCameraOptionsFromTo`, kept
25 m over the ground; the centre is unclamped from the ground while it flies), a readout with Stop, and the cross-section's
cursor following along. The whole glide takes 8 to 40 s; dragging the map ends it. **The glider** is a 2 m model sailplane,
`GlideCore.gliderMesh()` (no DOM; test 6b checks its size, symmetry and normals): a lofted fuselage with a painted canopy,
tapered polyhedral wings with a cambered airfoil, a T-tail, red tips. It is drawn with WebGL in a canvas at the middle of the
view (larger than life), lit by sun, sky and ground with a gloss highlight, from the chase camera's own angle, and flies:
it banks for a coordinated turn at the set airspeed (from the track's curvature, smoothed), noses down at the glide angle,
crabs into a crosswind, and rocks a little. `view3d.preview({ look, yaw, pitch, bank })` draws it alone, for checking the
model by eye.

**No height limit**: the glider starts at the launch height the visitor sets and is never capped on the way (the US / EU
rules switch was taken out); the note under the panel tells pilots to check their local rules. **Units** are metric or
imperial (`Units` in the core; `SPEC` in glide-plan.js gives each slider its range in both systems; `P` always holds metric values).

**Redraws stay cheap**: the reach is painted straight into a canvas that Leaflet positions like an image (`CanvasOverlay`,
no PNG encode), each grid cell's ray and distance are cached until the launch or the terrain changes (`geometry()`), and theme
colours are read once per theme change (`COL`).

Layout: controls on the left; the map with the cross-section strip under it on the right (on a phone, or any screen under
520 px tall: header, map, destination readout, collapsible cross-section and a bottom settings drawer). The header shows an "Offline" badge only when offline.
The panel's sections are `<details>` that remember being open (`open`); a folded one shows its settings in its title row
(`summaries()`). On a wide screen the top button on the map hides the whole left column (`setPanel`, kept as `panel`).
**Quick start** (`#guide`, the book in the header): three steps (where you launch, the glider and its launch height as
presets, reading the map), opened on load until "Show this when the page opens" (`guide`) is switched off; "I'll tap the
map" closes it and brings it back at step 2 after the tap. The glide ratio runs 1:1 to 30:1; a saved value outside a
slider's range stays available in the exact input. Unit switching only changes the display and never writes rounded slider values into `P`.
**Look**: the site's own tokens, type and accent (Inter for headings and controls, JetBrains Mono for numbers;
violet, never an orange accent), from Google Fonts (offline the system fonts stand in).
The map has its own locate button and a key that folds away on small maps (a `<details>` Leaflet control). Long-press is a
touch timer of its own (550 ms, held within 10 px), not just Leaflet's `contextmenu`, so it behaves the same on iOS and Android
and never also moves the launch. Inputs are 16 px so iOS doesn't zoom in on them; touch targets are at least 40 px. Colours are
the site's chart palette, checked with the dataviz skill's validator (`PAL` in glide-app.js): violet potential landing ground on a straight
glide, teal **plus hatching** potential landing ground only by curving, red where a straight glide hits steep ground, gold the long-press
route, grey too steep. `PAL.light` (`#5a4fd6`, `#12a599`, `#b8263a`, `#a58d12`) is for the light maps; over satellite imagery
`PAL.img` (`#8a7af7`, `#0fa593`, `#f2526c`, `#b08f10`, light lines on dark casings) takes over (`restyle()`, the Key's
`.on-img`), and the reach is drawn more solid. Every landable region has a solid outline (cells on its border, drawn opaque),
which is what keeps it readable on imagery. Keep identity off colour alone. Tokens are defined three times like main.css, and the page follows the site's `theme` in `localStorage` and
has its own light/dark switch.

Planning: the map defaults to **Inspect destination**; **Move launch** is a one-shot mode that returns to inspection after a tap, with Undo for the last 20 launch moves. The launch is a square L and the destination a circle. Dragging L always moves the launch; long-press always inspects. Selected destinations survive a launch move, a parameter change and an unreachable result. Their readout includes arrival AGL, flown distance, minimum grid clearance (including cells crossed between route vertices), slope and sight distance. A route maximizes predicted arrival height, not minimum distance. Potential landing ground only considers slope; it does not assess obstacles or land cover.

Each slider has an exact numeric input; wind and profile bearings also accept degrees. Named aircraft store glide ratio, airspeed and sight distance, leaving launch height and wind unchanged. Named plans store launch, all settings, destination and units in `glide-reach-plans`; aircraft use `glide-reach-aircraft`. Matching names update the saved item. Modified controls are marked against the loaded plan. **Copy plan link** serializes the same validated SI data into `#plan=`; a shared plan overrides local defaults on load. Malformed links report an error and retain local defaults. `tests/glide/browser.js` exercises these flows via `task shot -- /glide-path/ --eval-file tests/glide/browser.js` (also `--phone`), after `task build`.

Calculation states distinguish loading, updating (previous overlay explicitly labelled), ready, incomplete terrain and missing terrain. Old worker results never repaint an overlay for new settings. Offline areas report actual cached tile counts; Verify saved terrain also asks the active service worker to check its own complete shell file list. Coverage at the current launch counts all 277 required terrain tiles across zoom levels, rather than trusting a saved-area name.

It works offline. `sw.js` keeps the page and every terrain tile it has fetched (a capped `glide-terrain-runtime` cache), and
"Save this area" stores 9 × 9 zoom-13 tiles round the launch plus 7 × 7 at each of zooms 12 to 9 (277 tiles) in
`glide-terrain-saved`, which only the page deletes from (a tile shared by two saved areas stays until both are gone). Saved areas
are listed in `localStorage` (`glide-reach-areas`; every key keeps the old `glide-reach-` prefix so nothing saved is lost). **Street maps are never stored for offline use**: OpenStreetMap's tile policy
forbids "save area" features, so offline the page switches to a hillshade it draws from the saved terrain. Leaflet is vendored in
`glide-path/lib/leaflet/` (1.9.4, source-map comment stripped), and MapLibre in `lib/maplibre/`, so the page loads with no network; bump `VERSION` in `sw.js`
whenever `SHELL_FILES` changes (it lists every file of the page). The service worker also registers on `localhost`, so `script/serve` exercises it.

The page was **Glide Reach at `/glide-reach/`** until 2026-11-10. `glide-reach/index.html` redirects to `/glide-path/`
(keeping query and hash), and `glide-reach/sw.js` replaces the service worker browsers installed there: it unregisters
itself and moves open tabs to the new address, deleting no caches (the terrain caches are shared). Leave both in place.

### Dyna-soar ridge screen and local wind

The name is **Dyna-soar**; the URL remains `/glide-path/`, and existing `glide-reach-*` storage, shared plans and terrain caches are retained. The exact Dinosaur Park statue location (44.077964, −103.245844; Library of Congress survey) is the default when no launch or shared plan is saved. Its launch button never snaps to a neighbouring peak. Aircraft, branding, weather copy, screening explanations and landmark coordinates live in `_data/glide.yml`. `dyna-soar.png` is the generated cartoon; `glide-path/ARTWORK.md` records the reference and generation prompt.

`soaring-core.js` is pure geometry and weather parsing; `soaring-ui.js` owns ridge marks and the wind-aligned profile; `wind-ui.js` owns regional forecasts, the terrain-flow worker, map vectors and the separate vertical-flow overlay. A ridge needs a local crest, ≥15 m rise/drop over roughly 140 m along the wind, and ≥8° lee angle. These are explicit screening choices, not validated flight thresholds. Calm ≤0.5 m/s has no directional screen. Terrain cells >40 m are rejected. Missing terrain never forms a candidate. Six separated candidates are shown with **DS?** labels and dashed lee outlines, independent of the reach palette. Profiles run from upwind through the crest to the lee; there is no resolved separated shear layer or energy-gaining flight path. **Fly it** is hidden for this terrain-only view. Glide reach uses one selected fixed-AGL horizontal layer of the spatial wind field, with no credit for vertical air motion or soaring energy gain.

The existing worker keeps independent `screenGrid` terrain for `SoaringCore.scan`, tagged by terrain ID and a launch/wind/sight key. Its replies do not complete a route-search job. Screening retains zoom-13 terrain when reach steps to a coarser zoom; if necessary it loads a bounded local mosaic sized to the sight distance. Only the latest matching screen paints. Its markings and selected profile also work in 3D.

**Load local wind** requests a centre and eight surrounding Open-Meteo forecasts covering the loaded map, at 10 and (when available) 80 m. Forecast vectors, rather than compass angles, are interpolated; the UI reports distinct provider grid points and the valid time. Mean wind drives the plan; gust remains informational. Editing reference wind clears the regional scenario. An old-area forecast is labelled and is not extrapolated into another area. Failed, malformed, outdated or late responses do not overwrite edited wind. Manual/reference wind and cached snapshots still work offline; no snapshot is described as current observations.

`wind-core.js` implements a diagnostic finite-volume mass projection, `U = U₀ − ∇φ`, on a local 56 × 56 × 24 Cartesian fluid grid. Terrain cells have zero normal flux; the top and lateral boundaries are open (`φ = 0`). Red/black SOR solves the Poisson equation to a residual target; `diagnostics` records convergence, initial/final divergence and maximum speed. This solves mass conservation, not momentum, turbulence, atmospheric stability or separated lee eddies. The input terrain stays at zoom 13 even if glide calculations change zoom. Missing terrain yields regional wind only; it cannot generate local lift/sink. Resolution is reported in the panel.

`wind-worker.js` computes the volume independently of the route/screen worker. Only the newest matching key may apply. Wind at the selected 10–150 m AGL layer is compacted for reach. Regional vectors outside the local terrain solve are cached on a 33 × 33 grid, with exact regional interpolation beyond that grid. A logarithmic neutral profile and explicit roughness assumption supply heights not covered by the forecast. These assumptions are saved/shared as `windModel`, including the forecast samples; legacy plans without `windModel` retain uniform reference wind. Unit changes never alter SI inputs.

Straight glides integrate local along-track ground speed step by step and retain cumulative altitude profiles for destination interpolation. Curved paths use the same fixed-layer field, positive height loss only, and distinct first/second half-edge losses; intermediate terrain checks and `midAlt` retain the correct halfway altitude. `GlideCore.reachAltitude` and the cross-section share those integrated results. Changing wind, roughness or layer recomputes the whole envelope and all arrivals. Vertical velocity is never included in the ray or route height update.

Wind arrows are available in 2D and 3D. Optional teal upflow/red-hatched downflow shading is separate from reach classification. The ridge strip shows estimated flow paths projected into its vertical section, not a 3-D glider trajectory; its cursor reports horizontal wind, estimated vertical air and the 10–80 m vector difference. Neither these differences nor candidate marks confirm a flyable dynamic-soaring shear layer.

`task check:glide` includes asymmetric ridge fixtures, wind reversal/along-ridge rejection, missing terrain, screening separation, wind-aligned sections, forecast units/times and worker message checks. After `task build`, `task shot -- /glide-path/ --eval-file tests/glide/soaring.js --console` checks the actual Dinosaur Park terrain, mock forecasts, a full-map wind reversal, candidate selection, profile and weather failure/staleness. Repeat with `--phone`; the existing `tests/glide/browser.js` still checks saved plans, unit invariance and offline coverage.


Wind checks in `task check:glide` cover flat flow, ridge speed-up, windward lift/lee sink, wind reversal, mass residual reduction, missing data, vector interpolation across north, separate 80 m inputs, uniform-field parity, changing wind along a path, integrated arrival/profile agreement, positive-loss routing without vertical energy, and wind-model plan round trips. `tests/glide/soaring.js` checks regional requests, actual Dinosaur Park terrain, converged flow, whole-map reversal, assumed-height changes, independent shading and late forecast protection.
