// Physical keyboard reference only: inspecting a key never sends a robot command.
(() => {
  'use strict';
  const help = TASK_DATA.controls_help, keyboard = document.getElementById('controlsKeyboard');
  const arrows = document.getElementById('controlsArrows'), title = document.getElementById('controlsKeyTitle'), detail = document.getElementById('controlsKeyDetail');
  const choices = [...document.querySelectorAll('[data-keyboard-layout]')];
  let touch = null, draggedTouch = false;
  function clearChoice() {
    for (const button of document.querySelectorAll('#controlsDlg [data-control-action]')) button.setAttribute('aria-pressed', 'false');
  }
  function clearInspection() {
    clearChoice(); title.textContent = help.prompt_title; detail.textContent = help.prompt_text;
  }
  function leave(event) {
    // Touch taps keep their explanation readable after pointer-up; a drag off the
    // keyboard, mouse leave, scroll or focus change clears the inspected key.
    if (event.pointerType === 'touch' && !event.buttons && !draggedTouch) return;
    clearInspection();
  }
  function moveTouch(event) {
    if (!touch || touch.id !== event.pointerId) return;
    const box = touch.button.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) draggedTouch = true;
    if (draggedTouch) clearInspection();
  }
  function inspect(button, key) {
    const action = help.actions[key.action];
    if (!action) return;
    clearChoice(); button.setAttribute('aria-pressed', 'true');
    title.textContent = (key.input || key.label) + help.detail_separator + action.title;
    detail.textContent = action.detail;
  }
  function wire(button, key) {
    const action = help.actions[key.action];
    button.type = 'button'; button.dataset.controlAction = key.action; button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', (key.input || key.label) + help.detail_separator + action.title);
    button.title = action.detail;
    button.addEventListener('pointerenter', event => {
      // Direct touch has implicit capture. Its release may hit-test a neighbouring
      // button, but that synthetic hover must not turn a cancelled drag into a tap.
      if (event.pointerType === 'touch') return;
      draggedTouch = false; inspect(button, key);
    });
    button.addEventListener('pointerdown', event => {
      draggedTouch = false;
      if (event.pointerType === 'touch') touch = { id:event.pointerId, button };
      inspect(button, key);
    });
    button.addEventListener('pointermove', moveTouch);
    button.addEventListener('pointerup', event => { moveTouch(event); if (touch?.id === event.pointerId) touch = null; });
    button.addEventListener('pointercancel', () => { touch = null; draggedTouch = true; clearInspection(); });
    button.addEventListener('focus', () => { if (!draggedTouch) inspect(button, key); });
    button.addEventListener('click', event => {
      if (draggedTouch && (event.pointerType === 'touch' || event.detail > 0)) { clearInspection(); return; }
      inspect(button, key);
    });
    button.addEventListener('pointerleave', leave);
    button.addEventListener('blur', clearInspection);
  }
  function row(keys, index) {
    const line = document.createElement('div'); line.className = 'controls-key-row'; line.dataset.row = index;
    for (const key of keys) {
      const bound = !!help.actions[key.action], element = document.createElement(bound ? 'button' : 'span');
      element.style.setProperty('--key-units', key.gap || key.width || 1);
      if (key.gap) { element.className = 'controls-key-gap'; element.setAttribute('aria-hidden', 'true'); }
      else {
        element.className = 'controls-key' + (bound ? ' is-bound' : '') + (key.tall ? ' is-tall' : '');
        element.dataset.keyLabel = key.label;
        if (key.shift) { const shifted = document.createElement('small'); shifted.textContent = key.shift; element.append(shifted); element.dataset.shiftLabel = key.shift; }
        const legend = document.createElement('span'); legend.textContent = key.label; element.append(legend);
        if (bound) wire(element, key); else element.setAttribute('aria-hidden', 'true');
      }
      line.append(element);
    }
    return line;
  }
  function paint(layout) {
    touch = null; draggedTouch = false;
    keyboard.replaceChildren(row(help.keyboard.function_row, 'function'), ...layout.rows.map((keys, i) => row(keys, i)));
    keyboard.dataset.layout = layout.id;
    for (const button of choices) {
      const selected = button.dataset.keyboardLayout === layout.id;
      button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    clearInspection();
  }
  for (const [index, button] of choices.entries()) {
    button.addEventListener('click', () => paint(help.keyboard.layouts.find(layout => layout.id === button.dataset.keyboardLayout)));
    button.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
        event.key === 'ArrowRight' ? (index + 1) % choices.length : event.key === 'ArrowLeft' ? (index + choices.length - 1) % choices.length : null;
      if (next === null) return;
      event.preventDefault(); choices[next].click(); choices[next].focus();
    });
  }
  arrows.replaceChildren(...help.keyboard.arrows.map((keys, i) => row(keys, i)));
  for (const mouse of help.mouse) wire(document.querySelector('[data-mouse-control="' + mouse.id + '"]'), mouse);
  keyboard.addEventListener('pointerleave', leave);
  keyboard.addEventListener('pointercancel', clearInspection);
  keyboard.parentElement.addEventListener('scroll', clearInspection);
  document.getElementById('controlsDlg').addEventListener('pointerdown', event => {
    if (!event.target.closest('[data-control-action]')) clearInspection();
  });
  document.getElementById('controlsDlg').addEventListener('keydown', () => { touch = null; draggedTouch = false; }, true);
  paint(help.keyboard.layouts.find(layout => layout.id === help.keyboard.default_layout) || help.keyboard.layouts[0]);
})();
