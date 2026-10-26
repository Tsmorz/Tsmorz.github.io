---
layout: page
title: Install the firmware
subtitle: Flash the swing-up controller onto the ESP32-S3 from your browser.
description: Flash the n-cartpole firmware onto an ESP32-S3 over USB from the browser (Web Serial), keeping the saved Wi-Fi network.
---
<p class="install-need"><strong>You need</strong> an ESP32-S3 board with 16&nbsp;MB flash and 8&nbsp;MB PSRAM (N16R8, such as the ESP32-S3-DevKitC-1), a USB cable that carries data, and Chrome or Edge on a desktop. The rig it drives is described in the <a href="https://github.com/Tsmorz/n-cartpole/blob/main/docs/hardware.md">hardware notes</a>.</p>

<ol class="install-steps">
  <li>
    <span class="step-title">Plug in the board</span>
    <p>Connect the ESP32-S3 to your computer with the USB cable, to the port marked <strong>UART</strong>.</p>
  </li>
  <li>
    <span class="step-title">Install the firmware</span>
    <p>Click the button, pick the board in the list your browser shows, then choose <strong>Install</strong> and confirm. It takes about a minute; keep this tab open and the board plugged in.</p>
    <div class="btn-row install-action">
      <esp-web-install-button manifest="manifest.json">
        <button slot="activate" class="btn btn-primary" type="button">Install firmware</button>
        <span slot="unsupported" class="install-note">This browser has no Web Serial. Use Chrome or Edge on a desktop.</span>
        <span slot="not-allowed" class="install-note">Web Serial needs HTTPS.</span>
      </esp-web-install-button>
      <span class="install-note" id="install-version"></span>
    </div>
    <p class="install-note">Board not in the list? Hold <strong>BOOT</strong>, tap <strong>RESET</strong>, release <strong>BOOT</strong>, and click again. Your saved Wi-Fi network is kept. Skip <em>Erase User Data</em> in the install window: it also wipes the model.</p>
  </li>
  <li>
    <span class="step-title">Install the model</span>
    <p>The firmware and the model are separate files, so install the model the same way: click, pick the board again (it restarted after step 2), then choose <strong>Install</strong>.</p>
    <div class="btn-row install-action">
      <esp-web-install-button manifest="manifest-model.json">
        <button slot="activate" class="btn btn-primary" type="button">Install model</button>
        <span slot="unsupported"></span>
        <span slot="not-allowed"></span>
      </esp-web-install-button>
      <span class="install-note" id="install-model"></span>
    </div>
    <p class="install-note">Prefer the board's dashboard? <a href="n-cartpole-model.ncpm" download>Download the model (.ncpm)</a> and drag it onto the dashboard instead.</p>
  </li>
  <li>
    <span class="step-title">Connect it to Wi-Fi</span>
    <p>A new board opens its own network, <strong>cartpole-XXXX</strong>. Join it, open <a href="http://192.168.4.1" target="_blank" rel="noopener"><code>http://192.168.4.1</code></a> and enter your 2.4&nbsp;GHz network. Then reconnect your computer to your own network and open <a href="http://cartpole.local" target="_blank" rel="noopener"><code>http://cartpole.local</code></a>.</p>
  </li>
</ol>

<p class="install-note">Already set up? Update over Wi-Fi instead: drag the app image onto the board's dashboard.</p>

<script>
  // Say which firmware and model this page installs, from the same manifest the installer reads.
  fetch("manifest.json").then(function (r) { return r.json(); }).then(function (m) {
    var v = document.getElementById("install-version");
    v.append("Firmware v" + m.version + " · ");
    var a = document.createElement("a");
    a.href = "https://github.com/Tsmorz/n-cartpole/releases/tag/fw-v" + encodeURIComponent(m.version);
    a.textContent = "release notes";
    v.append(a);
    var model = (m.n_cartpole || {}).model;
    if (model) {
      document.getElementById("install-model").textContent =
        model.label + " · " + model.dtype + " · " + Math.round(model.bytes / 1024) + " KB";
    }
  }).catch(function () {});
</script>
<script type="module" src="https://unpkg.com/esp-web-tools@10.4.0/dist/web/install-button.js?module"></script>
