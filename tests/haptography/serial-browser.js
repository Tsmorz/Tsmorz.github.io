// Exercises the actual recorder and studio controls with Web Serial streams from a synthetic peer.
(async () => {
  const $ = id => document.getElementById(id);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (f, name, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (!f()) { if (Date.now() > end) throw new Error(`${name}: ${$('actuator-status').textContent}`); await sleep(50); }
  };
  await wait(() => $('signal-summary').textContent, 'studio startup');
  const W = await import('/haptography/wire.js');
  const { Simulator } = await import('/haptography/simulate.js');
  const sim = new Simulator({ seed: 71 });
  const originalInfo = sim.info.bind(sim);
  sim.info = t => ({ ...originalInfo(t), flags: 15, haptic_rate_hz: 16000, erm_step_us: 10000, clip_max_samples: 96000, clip_max_erm: 0 });
  const commands = [], parser = new W.StreamReader(); parser.synced = true;
  let input, timer, clipSamples = 0, chooserCalls = 0;
  const emit = (type, body) => input.enqueue(W.encodePacket(type, sim.number++ & 65535, body));
  const port = {
    getInfo: () => ({ usbVendorId: 0x2886, usbProductId: 0x0068 }),
    async open() {
      this.readable = new ReadableStream({ start: controller => { input = controller; input.enqueue(new Uint8Array([0])); }, cancel: () => clearInterval(timer) });
      this.writable = new WritableStream({ write(bytes) {
        for (const p of parser.feed(bytes)) {
          commands.push(p.type);
          const v = new DataView(p.body.buffer, p.body.byteOffset, p.body.byteLength);
          if (p.type === 0x41) { clipSamples = v.getUint32(0, true); assert(v.getUint32(4, true) === 0, 'Drake-only upload'); }
          emit(W.ACK, W.encodeAck({ command_type: p.type, command_number: p.number, status: 0 }));
          if (p.type === 0x43) {
            const id = v.getUint16(0, true), start_us = sim.startUs + sim.now;
            setTimeout(() => emit(W.PLAYBACK, W.encodePlayback({ kind: 2, id, level_percent: 100, outcome: 0, frames: clipSamples, start_us, end_us: start_us + clipSamples / 16000 * 1e6 })), clipSamples / 16);
          }
        }
      } });
      timer = setInterval(() => input.enqueue(sim.next(20)), 20);
    },
    async close() { clearInterval(timer); }
  };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: {
    getPorts: async () => [port], requestPort: async () => { chooserCalls++; return port; }
  } });
  // Refresh Web Serial availability after installing the fake API in this isolated test profile.
  $('connect').disabled = false;
  $('connect').click();
  await wait(() => $('s-tach').classList.contains('on'), 'protocol 5 info');
  $('rec-dataset').value = 'Serial fixture'; $('rec-label').value = 'Synthetic stream';
  $('record').click(); await sleep(1300); $('record').click();
  await wait(() => !$('after-record').hidden, 'serial recording saved');
  assert($('takes').querySelectorAll('.take').length === 1, 'recording reaches library');
  $('tab-tune').click(); $('signal-kind').value = 'sine'; $('signal-kind').dispatchEvent(new Event('change', { bubbles: true }));
  $('signal-seconds').value = '0.3'; $('signal-seconds').dispatchEvent(new Event('change', { bubbles: true }));
  $('signal-strength').value = '20'; $('signal-strength').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => !$('play-actuators').disabled, 'protocol 5 playback enabled');
  $('play-actuators').click();
  await wait(() => $('variants').querySelectorAll('li').length === 1 && $('stop-actuators').disabled, 'serial upload, playback and board-clock measurement');
  assert(commands.includes(0x41) && commands.includes(0x42) && commands.includes(0x43), 'clip upload and playback commands');
  assert(commands.at(-1) === 0x46, 'playback finishes with STOP');
  assert(!commands.includes(0x45) && !commands.includes(0x47), 'no ERM effect or pulse');
  $('tab-collect').click(); $('connect').click(); await sleep(150);
  $('connect').click(); await wait(() => $('link-lamp').textContent === 'Connected', 'reconnect');
  assert(chooserCalls === 0, 'reconnect reuses authorized XIAO');
  $('connect').click(); await sleep(150);
  return { result: 'PASS', recorded: 1, replayed: 1, protocol: 5, chooserCalls };
})()
