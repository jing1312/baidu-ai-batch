'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportNote } = require('../lib/note-export');

// Optional browser regression test: NODE_PATH must include playwright.
test('笔记悬停导出（真实 CDP 鼠标事件）', async (t) => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await t.test('悬停显示菜单，跳过无效入口，点击导出到网盘', async () => {
      await page.setContent(`
        <style>
          #toolbar { position:absolute; left:100px; top:100px; width:180px; }
          #menu { opacity:0; visibility:hidden; transition:opacity .2s; }
          #toolbar:hover #menu { opacity:1; visibility:visible; }
        </style>
        <div id="toolbar"><button id="trigger"><span>导出</span></button>
          <div id="menu" role="menu"><button id="actual">导出到网盘</button></div>
        </div>
        <script>
          window.clicked = 0; window.wrong = 0; window.trusted = false;
          trigger.onclick = () => window.wrong++;
          actual.onclick = (event) => { window.clicked++; window.trusted = event.isTrusted; };
        </script>`);
      await exportNote(cdp);
      assert.deepEqual(await page.evaluate(() => ({ clicked, wrong, trusted })),
        { clicked: 1, wrong: 0, trusted: true });
    });
    await t.test('只有旧入口时明确失败，不点击旧入口冒充导出', async () => {
      await page.setContent('<button onclick="window.wrong++">导出</button><script>window.wrong=0</script>');
      await assert.rejects(exportNote(cdp, { noteExportTimeoutMs: 1400 }), /悬停后未找到/);
      assert.equal(await page.evaluate(() => window.wrong), 0);
    });
    await t.test('不会点击禁用的菜单项', async () => {
      await page.setContent('<button>导出</button><button disabled>导出到网盘</button>');
      await assert.rejects(exportNote(cdp, { noteExportTimeoutMs: 1400 }), /悬停后未找到/);
    });
  } finally {
    await browser.close();
  }
});
