// Run with task shot -- /haptography/ --size 1280x560 --eval-file tests/haptography/layout.js
(async () => {
  const $ = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  while (!$('signal-summary').textContent) await new Promise(resolve => setTimeout(resolve, 50));
  $('demo').click();
  const desktop = innerWidth > 720;
  for (const workspace of ['collect', 'inspect', 'tune', 'compare']) {
    $('tab-' + workspace).click();
    await frame();
    assert(document.documentElement.scrollWidth <= innerWidth, workspace + ': no page width overflow');
    if (desktop) {
      assert(document.documentElement.scrollHeight <= innerHeight, workspace + ': panels stay inside the window');
      const stop = $('stop-actuators').getBoundingClientRect();
      assert(stop.top >= 0 && stop.right <= innerWidth, 'Stop stays in the toolbar');
    }
    if (workspace !== 'tune' && workspace !== 'compare') continue;
    const editor = document.querySelector('.studio-main');
    const parameters = document.querySelector(workspace === 'tune' ? '.signal-controls' : '.variant-panel');
    assert(parameters.scrollWidth <= parameters.clientWidth, workspace + ': parameter panel does not clip horizontally');
    if (desktop && innerWidth >= 1024 && innerHeight >= 560) {
      assert(editor.scrollHeight <= editor.clientHeight + 1, workspace + ': plots and comparison actions fit without scrolling');
      assert(parameters.getBoundingClientRect().left >= editor.getBoundingClientRect().right, 'parameters stay beside plots on short laptops');
    }
    for (const id of workspace === 'tune' ? ['plot-target', 'plot-drive', 'plot-drive-spectrum'] : ['plot-target', 'plot-band-comparison', 'plot-envelope']) {
      const plot = $(id), canvas = plot.querySelector('canvas');
      assert(plot.clientHeight >= 65 && plot.clientWidth >= 100, id + ': readable plot size');
      assert(Math.abs(canvas.width - canvas.clientWidth * devicePixelRatio) <= 1, id + ': canvas buffer follows layout');
    }
    const gap = $('play-gap');
    assert(gap.getBoundingClientRect().width >= 58, 'pause value has space for a decimal and number controls');
  }
  $('tab-tune').click();
  return { result: 'PASS', viewport: [innerWidth, innerHeight], desktop };
})()
