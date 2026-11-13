---
paths:
  - "assets/js/swingup.js"
  - "assets/js/statebox.js"
  - "assets/models/**"
  - "controls/swingup/**"
  - "script/test-swingup"
---

# The swing-up demo

`/controls/swingup/` runs the goal-conditioned TQC policy from
[n-cartpole](https://github.com/Tsmorz/n-cartpole) in the browser: pick a target pose (UU, UD, DU, DD, or
Random) and one network drives there. The JSON's `goals` block switches that on. The policy only works on the
plant it was trained on, so **`swingup.js` hard-codes no physical constants**: everything comes from
`assets/models/swingup-tqc.json`. The one exception is `RAIL_HALF`, which widens the rail to ±1 m on the page.
The dynamics are a line-for-line port of `n_cartpole/env/dynamics.py`. The page opens with the network on (button "AI") and Random targets cycling, so the ~2 MB weights download on load; Manual
is a click away. `script/test-swingup` guards the port (JS vs torch actions, JS vs Python trajectory,
closed-loop runs of every transition); if it fails after a re-export, the port has drifted.
