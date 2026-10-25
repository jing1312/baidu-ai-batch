'use strict';
const { evalJS, sleep } = require('./cdp');

// Runs inside the note editor (the iframe is opened as a top-level page).
function locateExport(mode, selector) {
  const normalize = (text) => (text || '').replace(/\s+/g, '').trim();
  const nodes = Array.from(document.querySelectorAll(selector || '*'));
  const matches = nodes.filter((el) => {
    const labels = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].map(normalize);
    return selector || labels.some((label) => label === (mode === 'hover' ? '导出' : '导出到网盘'));
  });
  const candidates = matches.map((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (!rect.width || !rect.height || style.display === 'none') return null;
    if (el.closest('[disabled], [aria-disabled="true"]')) return null;
    if (mode === 'click') {
      // Check ancestors too: a hover menu may retain layout while transparent.
      for (let parent = el; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (css.visibility === 'hidden' || Number(css.opacity) === 0 || css.pointerEvents === 'none') return null;
      }
    }
    const x = Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2;
    const y = Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return null;
    if (mode === 'click') {
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== el && !el.contains(hit))) return null;
    }
    const label = normalize(el.textContent);
    const isMenu = !!el.closest('[role="menu"], [role="menuitem"], [role="dialog"]');
    return { x, y, label, score: isMenu ? 10 : 0, area: rect.width * rect.height };
  }).filter(Boolean);
  // Prefer a menu action, then the smallest matching control.
  candidates.sort((a, b) => b.score - a.score || a.area - b.area);
  return candidates[0] || null;
}

async function exportNote(cdp, cfg = {}) {
  const locate = (mode, selector) => evalJS(cdp,
    `(${locateExport.toString()})(${JSON.stringify(mode)}, ${JSON.stringify(selector || '')})`);
  const deadline = Date.now() + (cfg.noteExportTimeoutMs || 15000);
  let trigger;
  while (Date.now() < deadline) {
    trigger = await locate('hover', cfg.noteExportHoverSelector);
    if (trigger) break;
    await sleep(250);
  }
  if (!trigger) throw new Error('笔记导出入口未找到，可配置 noteExportHoverSelector');

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: trigger.x, y: trigger.y });
  // A real pointer move triggers both CSS :hover and JS mouseenter handlers.
  await sleep(800);
  let button;
  while (Date.now() < deadline) {
    button = await locate('click', cfg.noteExportButtonSelector);
    if (button) break;
    await sleep(250);
  }
  if (!button) throw new Error('悬停后未找到可点击的笔记导出按钮，可配置 noteExportButtonSelector');

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y });
  await sleep(100);
  // Re-read after moving: menus may disappear or shift on pointer transitions.
  const current = await locate('click', cfg.noteExportButtonSelector);
  if (!current || Math.abs(current.x - button.x) > 2 || Math.abs(current.y - button.y) > 2) {
    throw new Error('笔记导出菜单在点击前发生变化，请检查悬停入口和按钮选择器');
  }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: current.x, y: current.y, button: 'left', clickCount: 1,
    });
  }
  return { clicked: true, label: current.label };
}

module.exports = { exportNote, locateExport };
