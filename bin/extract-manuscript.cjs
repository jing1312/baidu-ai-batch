'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, openTab, evalJS, closeTarget, sleep } = require('../lib/cdp');
const { loadConfig, parseArgv, videoPageUrl } = require('../lib/config');

const args = parseArgv(process.argv.slice(2));
const cfg = loadConfig(args.config);

function log(...a) {
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + ']', a.join(' '));
}

async function extractManuscript(cdp, item) {
  await cdp.send('Page.navigate', { url: videoPageUrl(cfg, item.name) });
  await sleep(3000);

  let tabFound = false;
  for (let i = 0; i < 30; i++) {
    const ok = await evalJS(cdp, `(function(){
      var t = document.querySelectorAll(".vp-tabs__header-item");
      for(var i of t) { if((i.textContent||"").trim() === "文稿") return true; }
      return false;
    })()`);
    if (ok) { tabFound = true; break; }
    await sleep(500);
  }
  if (!tabFound) return { found: false, reason: '文稿标签未出现' };

  await evalJS(cdp, `(function(){
    var t = document.querySelectorAll(".vp-tabs__header-item");
    for(var i of t) { if((i.textContent||"").trim() === "文稿") { i.click(); return; } }
  })()`);
  await sleep(2000);

  for (let i = 0; i < 60; i++) {
    const len = await evalJS(cdp, `(function(){
      var d = document.querySelector(".vp-ai-draft");
      return d ? (d.textContent||"").trim().length : 0;
    })()`);
    if (len > cfg.minContentLen) break;
    await sleep(2000);
  }

  return await evalJS(cdp, `(function(){
    var d = document.querySelector(".vp-ai-draft");
    if(!d) return { found: false, reason: "未找到文稿容器", length: 0 };
    var text = (d.textContent||"").trim();
    return { found: text.length > ${cfg.minContentLen}, text: text, length: text.length, reason: text.length > ${cfg.minContentLen} ? null : "内容过短" };
  })()`);
}

async function processOne(browserCdp, item) {
  const tab = await openTab(browserCdp, 'about:blank', cfg);
  try {
    const result = await extractManuscript(tab.cdp, item);
    if (result.found) {
      if (!fs.existsSync(cfg.outputDir)) fs.mkdirSync(cfg.outputDir, { recursive: true });
      const outputFile = path.join(cfg.outputDir, item.name.replace(/\.(mp4|mkv|mov|avi)$/i, '') + '_文稿.txt');
      fs.writeFileSync(outputFile, result.text, 'utf8');
      return { success: true, length: result.length };
    }
    return { success: false, reason: result.reason || '内容过短或未找到' };
  } finally {
    await closeTarget(browserCdp, tab.targetId);
  }
}

async function main() {
  log('==== 文稿批量导出 ====');

  const existingFiles = new Set();
  if (fs.existsSync(cfg.outputDir)) {
    fs.readdirSync(cfg.outputDir).forEach((f) => {
      if (f.endsWith('_文稿.txt')) existingFiles.add(f.replace(/_文稿\.txt$/, ''));
    });
  }
  log('已有文稿:', existingFiles.size, '个');

  const list = fs
    .readFileSync(cfg.listFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pending = list.filter((n) => {
    const base = n.replace(/\.(mp4|mkv|mov|avi)$/i, '');
    return !existingFiles.has(base) && !cfg.skipList.has(n);
  });
  log('待导出:', pending.length, '节');

  if (pending.length === 0) {
    log('全部完成！');
    process.exit(0);
  }

  const browserCdp = await connectBrowser(cfg);
  log('已连接浏览器 (', cfg.host + ':' + cfg.port, ')');

  let done = 0;
  let fail = 0;

  for (const name of pending) {
    try {
      log('▶', name);
      const result = await processOne(browserCdp, { name });
      if (result.success) {
        done++;
        log('✔', name, '(' + result.length + '字)');
      } else {
        fail++;
        log('✗', name, '|', result.reason);
      }
      await sleep(500);
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
