---
layout: page
title: Install the firmware
subtitle: Flash the swing-up controller onto the ESP32-S3 from your browser.
description: Flash the n-cartpole firmware onto an ESP32-S3 over USB from the browser (Web Serial), keeping the saved Wi-Fi network.
permalink: /swingup/real/
---
Plug the board into your computer over USB, click install and pick its serial port. This needs Chrome or Edge on a desktop.

<esp-web-install-button manifest="https://tsmorz.github.io/n-cartpole/manifest.json">
  <span slot="unsupported">This browser has no Web Serial. Use Chrome or Edge.</span>
  <span slot="not-allowed">Web Serial needs HTTPS.</span>
</esp-web-install-button>

- The saved Wi-Fi network and the rig's zero references are kept. Leave any erase option off: it also wipes the model.
- The firmware and the model are separate. After installing, open the board's dashboard and drag the `.ncpm` model onto it.
- If the board does not enter download mode by itself, hold **BOOT** while pressing **RESET**.
- A board that is already set up updates over Wi-Fi: drag the app image onto its dashboard.

<script type="module" src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"></script>
