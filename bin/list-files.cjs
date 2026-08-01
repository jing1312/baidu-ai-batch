'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, openTab, evalJS, closeTarget } = require('../lib/cdp');
const { loadConfig, parseArgv } = require('../lib/config');

const args = parseArgv(process.argv.slice(2));
const cfg = loadConfig(args.config);

function log(...a) {
  console.log('[' + new Date().toLocaleTimeString('zh-CN') + ']', a.join(' '));
}

async function main() {
  log('==== 从网盘生成视频清单 ====');

  const browserCdp = await connectBrowser(cfg);
  log('已连接浏览器 (', cfg.host + ':' + cfg.port, ')');

  const tab = await openTab(browserCdp, cfg.panBase, cfg);
  try {
    await evalJS(tab.cdp, 'document.title');

    const files = await evalJS(
      tab.cdp,
      `(async function(){
        var all = [];
        for (var page = 1; page <= 20; page++) {
          var resp = await fetch('/api/list?dir=' + encodeURIComponent(${JSON.stringify(cfg.videoFolder)}) +
            '&order=name&desc=0&web=1&page=' + page + '&num=200&t=' + Date.now(), { credentials: 'include' });
          var j = await resp.json();
          if (!j.list || !j.list.length) break;
          all = all.concat(j.list);
          if (j.list.length < 200) break;
        }
        return all.map(function(f){ return f.server_filename; });
      })()`,
      true
    );

    const videos = files.filter((n) => /\.(mp4|mkv|mov|avi)$/i.test(n));
    if (!videos.length) {
      log('未找到视频文件，请检查 config.json 中的 videoFolder 是否已登录');
      process.exit(1);
    }

    fs.writeFileSync(cfg.listFile, videos.join('\n') + '\n', 'utf8');
    log('已写入', cfg.listFile, ':', videos.length, '个视频');
  } finally {
    await closeTarget(browserCdp, tab.targetId);
  }
  process.exit(0);
}

main().catch((e) => {
  log('FATAL:', e.message);
  process.exit(1);
});
