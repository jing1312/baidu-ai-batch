'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 9222,
  panBase: 'https://pan.baidu.com',
  videoFolder: '/我的资源/课程视频/',
  listFile: 'video-list.txt',
  stateFile: 'state.json',
  outputDir: 'output',
  skipList: [],
  concurrency: 1,
  minContentLen: 100,
  cdpTimeoutMs: 30000,
};

function loadConfig(configPath) {
  const file = configPath || process.env.BAIDU_AI_CONFIG || path.join(process.cwd(), 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    console.error(`[config] 未找到配置文件: ${file}`);
    console.error('[config] 请复制 config.example.json 为 config.json 并按需修改');
    process.exit(1);
  }

  const cfg = { ...DEFAULTS, ...user };
  const baseDir = path.dirname(path.resolve(file));
  cfg.listFile = path.resolve(baseDir, cfg.listFile);
  cfg.stateFile = path.resolve(baseDir, cfg.stateFile);
  cfg.outputDir = path.resolve(baseDir, cfg.outputDir);
  cfg.skipList = new Set(cfg.skipList || []);
  return cfg;
}

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      out[key] = next !== undefined && !next.startsWith('--') ? next : true;
    }
  }
  return out;
}

function videoPageUrl(cfg, name) {
  return (
    cfg.panBase +
    '/pfile/video?path=' +
    encodeURIComponent(cfg.videoFolder + name) +
    '&theme=light&view_from=personal_file&from=home'
  );
}

module.exports = { loadConfig, parseArgv, videoPageUrl };
