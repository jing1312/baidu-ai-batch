'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, openTab, evalJS, closeTarget, sleep } = require('../lib/cdp');
const { loadConfig, parseArgv, videoPageUrl } = require('../lib/config');
const { exportNote } = require('../lib/note-export');

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

      if (content.length <= cfg.minContentLen) {
        return { success: false, reason: '笔记内容过短，未执行导出' };
      }
      /**
       * 笔记导出适配了悬停菜单：脚本先用真实鼠标悬停「导出」，等待「导出到网盘」出现，再点击菜单项。找不到可点击的菜单项会报错，不会把点击旧入口当作成功。日志表示已点击按钮，最终文件仍以网盘中的结果为准。

如果之前已经生成了本地笔记 TXT，但没有真正导出到网盘，用 `node bin/export-notes.cjs --force` 重新处理（会重跑清单内未跳过的视频，已有网盘导出可能重复）。

若页面后续再次改版，可在 `config.json` 中添加 `noteExportHoverSelector`（悬停入口的 CSS 选择器）和 `noteExportButtonSelector`（真正导出按钮的 CSS 选择器），覆盖默认文字定位。`noteExportTimeoutMs` 可调整入口和菜单的总等待时间，默认 15000 毫秒。
       */

      await exportNote(noteTab.cdp, cfg);
      log('    已悬停并点击导出按钮，等待页面处理（请确认网盘中的导出文件）');
      await sleep(2000);

      if (content.length > cfg.minContentLen) {
        if (!fs.existsSync(cfg.outputDir)) fs.mkdirSync(cfg.outputDir, { recursive: true });
        const outputFile = path.join(cfg.outputDir, item.name.replace(/\.(mp4|mkv|mov|avi)$/i, '') + '_笔记.txt');
        fs.writeFileSync(outputFile, content.text, 'utf8');
      }

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
