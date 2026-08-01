'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, openTab, evalJS, closeTarget, sleep } = require('../lib/cdp');
const { loadConfig, parseArgv, videoPageUrl } = require('../lib/config');

const args = parseArgv(process.argv.slice(2));
const cfg = loadConfig(args.config);

const stateFile = cfg.stateFile;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (_) {
    return { done: {} };
  }
}
function saveState(s) {
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
}

function log(...a) {
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + ']', a.join(' '));
}

async function exportPPT(cdp, item) {
  await cdp.send('Page.navigate', { url: videoPageUrl(cfg, item.name) });
  await sleep(3000);

  let tabFound = false;
  for (let i = 0; i < 30; i++) {
    const ok = await evalJS(cdp, `(function(){
      var t = document.querySelectorAll(".vp-tabs__header-item");
      for(var i of t) { if((i.textContent||"").trim() === "课件") return true; }
      return false;
    })()`);
    if (ok) { tabFound = true; break; }
    await sleep(500);
  }
  if (!tabFound) throw new Error('课件标签未出现');

  await evalJS(cdp, `(function(){
    var t = document.querySelectorAll(".vp-tabs__header-item");
    for(var i of t) { if((i.textContent||"").trim() === "课件") { i.click(); return; } }
  })()`);
  await sleep(2000);

  let btnFound = false;
  for (let i = 0; i < 20; i++) {
    const found = await evalJS(cdp, `(function(){
      return !!document.querySelector(".ai-course__export-container");
    })()`);
    if (found) { btnFound = true; break; }
    await sleep(1000);
  }
  if (!btnFound) throw new Error('导出按钮未出现（AI课件可能未生成）');

  const clicked = await evalJS(cdp, `(function(){
    var btn = document.querySelector(".ai-course__export-container");
    if(!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) throw new Error('点击导出按钮失败');

  await sleep(2000);
  return true;
}

async function processOne(browserCdp, item) {
  const tab = await openTab(browserCdp, 'about:blank', cfg);
  try {
    await exportPPT(tab.cdp, item);
    return { success: true };
  } finally {
    await closeTarget(browserCdp, tab.targetId);
  }
}

async function main() {
  log('==== PPT 批量导出 ====');

  const list = fs
    .readFileSync(cfg.listFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  log('清单共', list.length, '节');

  const browserCdp = await connectBrowser(cfg);
  log('已连接浏览器 (', cfg.host + ':' + cfg.port, ')');

  const state = loadState();
  const pending = list.filter((n) => !state.done[n] && !cfg.skipList.has(n));
  log('待处理:', pending.length, '节');

  let done = 0;
  let fail = 0;

  for (const name of pending) {
    try {
      log('▶', name);
      await processOne(browserCdp, { name });
      state.done[name] = { at: new Date().toISOString() };
      saveState(state);
      done++;
      log('✔', name);
      await sleep(1000);
    } catch (e) {
      fail++;
      log('✗', name, '|', e.message);
    }
  }

  log('==== 完成', done, '节 | 失败', fail, '节 ====');
  process.exit(0);
}

main().catch((e) => {
  log('FATAL:', e.message);
  process.exit(1);
});
