// ==UserScript==
// @name         百度网盘 AI 批量导出（课件PPT / 讲稿 / 笔记）
// @namespace    https://github.com/jing1312/baidu-ai-batch
// @version      1.0.0
// @description  在百度网盘视频播放页自动触发 AI 课件/讲稿/笔记生成并导出；配合列表页排队可实现全自动跑批
// @author       jing1312
// @match        https://pan.baidu.com/disk/home*
// @match        https://pan.baidu.com/pfile/video*
// @match        https://pan.baidu.com/fcb/videoedit*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 常量 ----------
  const LS_QUEUE = 'baai_queue';          // 待处理队列 [{name, url}]
  const LS_DONE = 'baai_done';            // 每节完成状态 { [name]: {ppt,draft,note} }
  const LS_FLAG = 'baai_note_flag';       // 去笔记页的返回信息 {name, returnUrl}
  const VIDEO_RE = /\.(mp4|mkv|mov|avi)$/i;
  const pageType = location.pathname.startsWith('/disk')
    ? 'home'
    : location.pathname.startsWith('/fcb')
      ? 'iframe'
      : 'video';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const lsGet = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; }
  };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function loadDone() { return lsGet(LS_DONE, {}); }
  function markDone(name, step) {
    const d = loadDone();
    d[name] = d[name] || {};
    d[name][step] = 1;
    lsSet(LS_DONE, d);
  }
  function stepDone(name, step) {
    return !!(loadDone()[name] && loadDone()[name][step]);
  }

  function videoUrl(dir, name) {
    return (
      location.origin +
      '/pfile/video?path=' + encodeURIComponent(dir + name) +
      '&theme=light&view_from=personal_file&from=home'
    );
  }

  // ---------- UI ----------
  let panel = null;
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;width:280px;' +
      'background:#fff;border:1px solid #d0d0d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
      'font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#222;padding:12px 14px;';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;">百度网盘 AI 批量导出</div>' +
      '<div id="baai-status" style="margin-bottom:8px;white-space:pre-wrap;">就绪</div>' +
      '<div style="display:flex;gap:6px;">' +
      '<button id="baai-btn" style="flex:1;padding:6px 0;border:0;border-radius:6px;background:#306cff;color:#fff;cursor:pointer;">开始</button>' +
      '<button id="baai-skip" style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;" title="跳过本节，处理下一节">跳过</button>' +
      '</div>';
    document.body.appendChild(panel);
    return panel;
  }
  function setStatus(text) { const p = ensurePanel().querySelector('#baai-status'); p.textContent = text; }
  function bindButton(text, cb) { const b = ensurePanel().querySelector('#baai-btn'); b.textContent = text; b.onclick = cb; }
  function bindSkip(cb) { ensurePanel().querySelector('#baai-skip').onclick = cb; }

  // ---------- 通用动作 ----------
  async function clickTab(label) {
    for (let i = 0; i < 40; i++) {
      const el = $$('.vp-tabs__header-item').find((t) => (t.textContent || '').trim() === label);
      if (el) { el.click(); return true; }
      await sleep(500);
    }
    return false;
  }

  async function waitFor(selector, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if ($(selector)) return true;
      await sleep(500);
    }
    return false;
  }

  async function waitDraftText(minLen, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const d = document.querySelector('.vp-ai-draft');
      const text = d ? (d.textContent || '').trim() : '';
      if (text.length > minLen) return text;
      await sleep(2000);
    }
    return '';
  }

  function findTextButton(text) {
    return $$('*').find((el) => (el.textContent || '').trim() === text);
  }

  function downloadTxt(filename, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- 视频页主流程 ----------
  async function handleVideoPage() {
    const name = new URLSearchParams(location.search).get('path') || '';
    const short = decodeURIComponent(name).split('/').pop() || '当前视频';
    ensurePanel();
    setStatus('视频：' + short + '\n检查进度…');

    const allDone = ['ppt', 'draft', 'note'].every((s) => stepDone(short, s));
    if (allDone) {
      setStatus('本节已完成，跳到下一节…');
      await sleep(800);
      nextVideo();
      return;
    }

    bindSkip(async () => { setStatus('跳过 ' + short); nextVideo(); });

    // ① 课件 PPT：切标签 → 等导出图标 → 点导出
    if (!stepDone(short, 'ppt')) {
      setStatus('① 课件：等待 AI 课件生成…');
      if (await clickTab('课件')) {
        await sleep(1500);
        if (await waitFor('.ai-course__export-container', 60000)) {
          $('.ai-course__export-container').click();
          markDone(short, 'ppt');
          setStatus('① 课件：已点击导出（PPT 将保存到网盘目录）');
        } else {
          setStatus('① 课件：导出按钮未出现（可能服务端生成失败）');
        }
      } else {
        setStatus('① 课件：标签不存在，跳过');
      }
    }

    // ② 讲稿：切标签 → 等内容 → 下载 TXT
    if (!stepDone(short, 'draft')) {
      setStatus('② 讲稿：等待 AI 讲稿生成…');
      if (await clickTab('文稿')) {
        await sleep(1500);
        const text = await waitDraftText(100, 120000);
        if (text.length > 100) {
          downloadTxt(short.replace(VIDEO_RE, '') + '_文稿.txt', text);
          markDone(short, 'draft');
          setStatus('② 讲稿：已下载 TXT（' + text.length + '字）');
        } else {
          setStatus('② 讲稿：内容为空（可能服务端生成失败）');
        }
      } else {
        setStatus('② 讲稿：标签不存在，跳过');
      }
    }

    // ③ 笔记：切标签 → 拿 iframe → 跳过去处理
    if (!stepDone(short, 'note')) {
      setStatus('③ 笔记：打开笔记编辑器…');
      if (await clickTab('笔记')) {
        await sleep(1500);
        const iframe = $('#noteIframe') || $('.vp-note-iframe__view');
        const iframeUrl = iframe && iframe.src;
        if (iframeUrl) {
          lsSet(LS_FLAG, { name: short, returnUrl: location.href });
          location.href = iframeUrl; // 同域，iframe 页的脚本逻辑会接管
          return;
        }
        setStatus('③ 笔记：iframe 未找到，跳过');
      } else {
        setStatus('③ 笔记：标签不存在，跳过');
      }
    }

    nextVideo();
  }

  // ---------- 笔记编辑器页（fcb/videoedit） ----------
  async function handleIframePage() {
    const flag = lsGet(LS_FLAG, null);
    if (!flag) return; // 非本脚本跳转来的，不干预

    ensurePanel();
    setStatus('③ 笔记：' + flag.name + '\n等待生成…');

    let hasContent = (document.body.innerText || '').length > 500;
    if (!hasContent) {
      const btn = findTextButton('图文笔记');
      if (btn) btn.click();
    }

    // 等「导出」按钮出现（生成完成），最长 5 分钟
    let exportBtn = null;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      exportBtn = findTextButton('导出');
      if (exportBtn) break;
      const text = (document.body.innerText || '');
      if (text.length > 500) { // 内容已生成但按钮未出现，也再等等
        setStatus('③ 笔记：已生成 ' + text.length + ' 字，等待导出按钮…');
      }
    }

    if (exportBtn) {
      exportBtn.click();
      markDone(flag.name, 'note');
      setStatus('③ 笔记：已点击导出（PDF 将保存到网盘）');
    } else {
      setStatus('③ 笔记：生成超时，跳过（可手动重试）');
    }

    await sleep(1500);
    localStorage.removeItem(LS_FLAG);
    location.href = flag.returnUrl; // 回视频页，脚本会接着跑下一节
  }

  // ---------- 队列 ----------
  function nextVideo() {
    const q = lsGet(LS_QUEUE, []);
    const done = loadDone();
    while (q.length) {
      const item = q.shift();
      const ok = ['ppt', 'draft', 'note'].every((s) => done[item.name] && done[item.name][s]);
      if (!ok) {
        lsSet(LS_QUEUE, q);
        setStatus('下一节：' + item.name);
        location.href = item.url;
        return;
      }
    }
    lsSet(LS_QUEUE, q);
    setStatus('🎉 队列已全部处理完成');
  }

  // ---------- 列表页：收集当前目录视频 ----------
  async function handleHomePage() {
    const params = new URLSearchParams(location.search);
    let dir = params.get('dir') || '/视频目录/';
    ensurePanel();
    setStatus('列表页\n目录：' + dir);

    bindButton('收集本目录视频', async () => {
      setStatus('正在读取网盘文件列表…');
      try {
        const files = [];
        for (let page = 1; page <= 20; page++) {
          const resp = await fetch(
            '/api/list?dir=' + encodeURIComponent(dir) +
            '&order=name&desc=0&web=1&page=' + page + '&num=200&t=' + Date.now(),
            { credentials: 'include' }
          );
          const j = await resp.json();
          if (!j.list || !j.list.length) break;
          files.push(...j.list);
          if (j.list.length < 200) break;
        }
        const videos = files.filter((f) => VIDEO_RE.test(f.server_filename));
        if (!videos.length) { setStatus('目录里没找到视频文件'); return; }
        const q = videos.map((f) => ({ name: f.server_filename, url: videoUrl(dir, f.server_filename) }));
        lsSet(LS_QUEUE, q);
        setStatus('已入队 ' + q.length + ' 节视频\n点「开始」自动跑批');
        bindButton('开始跑批', () => {
          setStatus('开始…');
          nextVideo();
        });
      } catch (e) {
        setStatus('读取失败：' + e.message);
      }
    });
  }

  // ---------- 入口 ----------
  if (pageType === 'home') {
    handleHomePage();
  } else if (pageType === 'video') {
    handleVideoPage();
  } else if (pageType === 'iframe') {
    handleIframePage();
  }
})();
