# Haptography (`/haptography/`)

**Edited here now**, no longer a copy published from nrf-controller. That repo still has `task publish-haptography`, which
replaces this whole folder with its `tools/haptography/`: don't run it until it is removed or changed to match.

The recording and TacHammer editor has four task workspaces: Record, Inspect, Waveform and Compare.
`index.html` has front matter only to render `_data/haptography.yml`; it uses its own `studio.css`,
no site layout. `app.js` owns the serial connection, raw takes, recovery spool, live scope and
collection quality. `studio.js` owns the waveform editor, response profiles, experiments and A/B.
Its design is a compact desktop signal editor: neutral surfaces, a single toolbar, blue signal
traces, and flat parameter controls. No display headings, slogans, decorative cards or tinted
page backgrounds. Desktop panels scroll independently within the window; narrow screens put
the signal plots before the parameter controls. Keep canvas sizes in CSS. Short wide windows
must retain desktop panels; do not select the phone layout by height alone.
`haptics-core.js` is hardware-free signal processing (1600 Hz analysis grid; g for acceleration,
fractions of full scale for drive), mirroring the model format and inverse/correction approach in
`../nrf-controller/recording/haptics/`. `device.js` sends CRC/COBS commands on the recorder's port,
matches ACKs by type and sequence number, uploads chunks at sample offsets, and aligns measured IMU
samples to the device's PLAYBACK timestamp. Playback capacity and rates come from INFO, not the UI.
The firmware's TacHammer-ready flag only says I²S started; it cannot detect a connected actuator.
The ERM has been removed. Protocol 3 still carries `erm_step_us` and `clip_max_erm` (both zero);
retain those fields when decoding recordings, but upload only PCM track 0 and a zero second-track
count. `isTacHammer` prevents old mixed-output experiments from being replayed or silently
relabelled; keep their saved data available for JSON export.

Raw recordings are never trimmed or overwritten by editing. Excluded spans are `bad` labels and
do not contribute strokes to dataset coverage. Simulated takes/profiles/measurements are labelled;
simulated actuator profiles never compensate physical playback. IndexedDB v2 adds a `studio` store
without replacing the existing takes/raw/spool stores. Experiments preserve the raw selected target,
settings, profile, drive, measurement, trial raw bytes and assessments. JSON exports round-trip;
folder exports also contain 16 kHz `drive.wav` and trial `raw.bin` files.

`task check:haptography` (in `check:fast` and `task ci`) tests the DSP against known signals, response
identification and correction, protocol retries and offsets, measurement coverage and exports.
After `task build`, `task shot -- /haptography/ --eval-file tests/haptography/browser.js --full`
exercises collection, exclusion/undo, target selection, simulated identification, matching, correction,
variants, A/B cancellation and IndexedDB storage. Repeat with `--phone` for the narrow layout.
`tests/haptography/layout.js` checks window bounds, plot sizing and controls with `task shot`;
include `--size 1280x560` to catch short laptop regressions, plus the phone viewport.
These checks use a simulated TacHammer; real response and timing still require a board.
