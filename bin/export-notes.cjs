'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, openTab, evalJS, closeTarget, sleep } = require('../lib/cdp');
const { loadConfig, parseArgv, videoPageUrl } = require('../lib/config');

const args = parseArgv(process.argv.slice(2));
const cfg = loadConfig(args.config);
const force = !!args.force;

function log(...a) {
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + ']', a.join(' '));
}

async function processNote(browserCdp, item) {
  const tab = await openTab(browserCdp, videoPageUrl(cfg, item.name), cfg);

  try {
    await sleep(5000);

    let tabsReady = false;
    for (let i = 0; i < 40; i++) {
      try {
        const ok = await evalJS(tab.cdp, `(function(){
          var t = document.querySelectorAll(".vp-tabs__header-item");
          for(var i=0; i<t.length; i++) { if((t[i].textContent||"").trim() === "笔记") return true; }
          return false;
        })()`);
        if (ok) { tabsReady = true; break; }
      } catch (_) {}
      await sleep(500);
    }

    if (!tabsReady) return { success: false, reason: '笔记标签未加载' };

    await evalJS(tab.cdp, `(function(){
      var t = document.querySelectorAll(".vp-tabs__header-item");
      for(var i=0; i<t.length; i++) { if((t[i].textContent||"").trim() === "笔记") { t[i].click(); return; } }
    })()`);
    await sleep(2000);

    const iframeUrl = await evalJS(tab.cdp, `(function(){
      var iframe = document.getElementById("noteIframe") || document.querySelector(".vp-note-iframe__view");
      return iframe ? iframe.src : null;
    })()`);

    if (!iframeUrl) return { success: false, reason: '笔记 iframe 未找到' };

    const noteTab = await openTab(browserCdp, iframeUrl, cfg);

    try {
      await sleep(3000);

      let hasContent = false;
      try {
        hasContent = await evalJS(noteTab.cdp, `(function(){
          return document.body ? document.body.innerText.length > 500 : false;
        })()`);
      } catch (_) {}

      if (!hasContent) {
        try {
          await evalJS(noteTab.cdp, `(function(){
            var els = document.querySelectorAll("*");
            for(var i=0; i<els.length; i++) {
              var text = (els[i].textContent||"").trim();
              if(text === "图文笔记") { els[i].click(); return; }
            }
          })()`);
        } catch (_) {}

        log('    等待笔记生成...');
        let exportReady = false;
        for (let i = 0; i < 60; i++) {
          await sleep(5000);
          try {
            const hasExport = await evalJS(noteTab.cdp, `(function(){
              var els = document.querySelectorAll("*");
              for(var i=0; i<els.length; i++) {
                var text = (els[i].textContent||"").trim();
                if(text === "导出") return true;
              }
              return false;
            })()`);
            if (hasExport) { exportReady = true; break; }
          } catch (_) {}
        }

        if (!exportReady) return { success: false, reason: '笔记生成超时' };
      }

      let contentLen = 0;
      for (let i = 0; i < 30; i++) {
        try {
          contentLen = await evalJS(noteTab.cdp, `(function(){
            return document.body ? document.body.innerText.length : 0;
          })()`);
        } catch (_) {}
        if (contentLen > 500) break;
        await sleep(2000);
      }

      let content = { text: '', length: 0 };
      try {
        content = await evalJS(noteTab.cdp, `(function(){
          var text = document.body ? document.body.innerText : "";
          return { text: text, length: text.length };
        })()`);
      } catch (_) {}

      if (content.length > cfg.minContentLen) {
        if (!fs.existsSync(cfg.outputDir)) fs.mkdirSync(cfg.outputDir, { recursive: true });
        const outputFile = path.join(cfg.outputDir, item.name.replace(/\.(mp4|mkv|mov|avi)$/i, '') + '_笔记.txt');
        fs.writeFileSync(outputFile, content.text, 'utf8');
      }

      try {
        await evalJS(noteTab.cdp, `(function(){
          var els = document.querySelectorAll("*");
          for(var i=0; i<els.length; i++) {
            var text = (els[i].textContent||"").trim();
            if(text === "导出") { els[i].click(); return; }
          }
        })()`);
      } catch (_) {}
      await sleep(2000);

      return { success: true, length: content.length };
    } finally {
      await closeTarget(browserCdp, noteTab.targetId);
    }
  } finally {
    await closeTarget(browserCdp, tab.targetId);
  }
}

function noteExists(item) {
  if (force) return false;
  if (!fs.existsSync(cfg.outputDir)) return false;
  const base = item.name.replace(/\.(mp4|mkv|mov|avi)$/i, '');
  const f = path.join(cfg.outputDir, base + '_笔记.txt');
  if (!fs.existsSync(f)) return false;
  return fs.statSync(f).size > cfg.minContentLen;
}

async function main() {
  log('==== 笔记批量导出 ====');

  const list = fs
    .readFileSync(cfg.listFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pending = list.filter((n) => !cfg.skipList.has(n) && !noteExists({ name: n }));
  log('待处理:', pending.length, '节（已完成的自动跳过，--force 可重跑）');

  const browserCdp = await connectBrowser(cfg);
  log('已连接浏览器 (', cfg.host + ':' + cfg.port, ')');

  let done = 0;
  let fail = 0;

  for (const name of pending) {
    try {
      log('▶', name);
      const result = await processNote(browserCdp, { name });
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
