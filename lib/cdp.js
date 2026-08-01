'use strict';
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson({ host, port, path }) {
  return new Promise((resolve, reject) => {
    http
      .get({ host, port, path }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function makeWS(url, maxPayload = 200 * 1024 * 1024) {
  const WS = require('ws');
  const raw = new WS(url, { maxPayload });
  return {
    raw,
    send: (s) => raw.send(s),
    onMessage: (cb) => raw.on('message', (d) => cb(d.toString())),
    onOpen: (cb) => raw.on('open', cb),
    onError: (cb) => raw.on('error', cb),
  };
}

async function waitOpen(ws, timeoutMs = 15000) {
  await new Promise((res, rej) => {
    ws.onOpen(res);
    ws.onError(rej);
    setTimeout(() => rej(new Error('WebSocket 连接超时')), timeoutMs);
  });
}

class CDP {
  constructor(ws, timeoutMs = 30000) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    ws.onMessage((msg) => {
      let m;
      try {
        m = JSON.parse(msg);
      } catch (_) {
        return;
      }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, this.timeoutMs);
    });
  }
}

async function connectBrowser({ host, port, timeoutMs }) {
  const version = await httpGetJson({ host, port, path: '/json/version' });
  const ws = makeWS(version.webSocketDebuggerUrl);
  await waitOpen(ws);
  return new CDP(ws, timeoutMs);
}

async function openTab(browserCdp, url, { host, port, timeoutMs }) {
  const r = await browserCdp.send('Target.createTarget', { url });
  await sleep(500);
  const list = await httpGetJson({ host, port, path: '/json/list' });
  const info = list.find((t) => t.id === r.targetId);
  if (!info) throw new Error('新建标签页未找到');
  const ws = makeWS(info.webSocketDebuggerUrl);
  await waitOpen(ws);
  const cdp = new CDP(ws, timeoutMs);
  await cdp.send('Runtime.enable');
  return { cdp, ws, targetId: r.targetId };
}

async function evalJS(cdp, body, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: body,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) throw new Error('页面脚本执行异常');
  return r.result.value;
}

async function closeTarget(browserCdp, targetId) {
  try {
    await browserCdp.send('Target.closeTarget', { targetId });
  } catch (_) {}
}

module.exports = { CDP, connectBrowser, openTab, evalJS, closeTarget, sleep, httpGetJson };
