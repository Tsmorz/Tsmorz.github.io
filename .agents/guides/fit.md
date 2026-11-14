---
paths:
  - "fit.md"
  - "assets/js/fit.js"
  - "script/test-fit"
---

# The custom data page (`/controls/fit/`)

`fit.md` + `assets/js/fit.js`. The visitor uploads a CSV with a header row and exactly three kinds of column:
`t` (seconds), `x` or `x1, x2, ...` (states) and `u` or `u1, u2, ...` (inputs); other columns are ignored. There is no
column picker or unit setting, on purpose. `FitCore` resamples to a uniform time base: states are interpolated, and each
input (held between samples) is averaged over every interval. The page fits `x[k+1] = Ax + Bu` by **least squares only** (the
page no longer offers a sample-rate slider or Ho–Kalman; `fitHoKalman` and the `mult` argument of `prepare` stay in `FitCore`, tested
but unused by the page). `dlqr` solves the Riccati recursion on the model; `reachability` counts the directions the input can move
(rank of the controllability matrix, states scaled by their spread), and the page says when some states may not be reachable.
Once a model is found the bottom plot is a **live simulation** of it: stepped in real time under `u = u_ss r − K(x − x_ss r)` (steady state from
`steadyState`; one state is tracked, chosen in the panel), with a reference slider, a push button, a reset and a controller on/off switch. Weight
sliders keep the running sim; changing the tracked state restarts it. The page also plots data against one-step predictions and the z-plane poles.
The page opens on the built-in cart-pole example (`exampleCsv`), so it is never empty, and says so above the results. It is its own page, not a lab lesson, so it has a goal, an explanation and tasks but no predict or check cards. `script/test-fit`
(`task check:fit`, in `check:fast`) guards the parser, the resampling, both fits, the LQR, the tracking and reachability.
