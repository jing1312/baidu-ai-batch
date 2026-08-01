# baidu-ai-batch

通过 Chrome DevTools Protocol (CDP) 控制本机浏览器，批量导出百度网盘「AI 视频」的三种成果：

1. **AI 课件 PPT** —— 点播放页「课件」标签的导出图标，PPT 直接保存到网盘视频所在文件夹
2. **AI 文稿** —— 抓取「文稿」标签的 AI 生成文本，保存为本地 TXT
3. **AI 笔记** —— 打开「笔记」iframe，触发「图文笔记」生成并点击「导出」（PDF 保存到网盘），同时备份文本到本地

原理：本机浏览器以 `--remote-debugging-port` 启动后，脚本通过 WebSocket 与浏览器交互，每个任务在**新标签页**中执行（不影响你正在使用的页面）。

## 环境要求

- Node.js ≥ 18
- 一个以调试模式启动的浏览器（Edge/Chrome），并且已登录百度网盘

### 启动调试模式浏览器

```bash
# Edge
msedge --remote-debugging-port=9222

# Chrome
chrome --remote-debugging-port=9222
```

> 注意：调试端口浏览器与日常浏览器是独立的配置目录，调试浏览器里需要重新登录百度网盘。

## 安装与配置

```bash
npm install
cp config.example.json config.json   # Windows: copy config.example.json config.json
```

编辑 `config.json`：

| 字段 | 说明 |
|------|------|
| `host` / `port` | 浏览器调试端口（默认 127.0.0.1:9222） |
| `panBase` | 网盘域名，默认 `https://pan.baidu.com` |
| `videoFolder` | 网盘内视频所在目录（以 `/` 结尾） |
| `listFile` | 视频文件名清单，每行一个 `.mp4` 文件名 |
| `stateFile` | PPT 导出进度记录（断点续传） |
| `outputDir` | 文稿/笔记的本地 TXT 输出目录 |
| `skipList` | 跳过处理的视频文件名数组（如黑屏视频） |
| `minContentLen` | 判定内容有效的字数阈值 |

生成清单：

```bash
# 通过网盘 API 列出目录文件（需浏览器已登录）
node bin/list-files.cjs
```

## 使用

```bash
# 1. 批量导出 AI 课件 PPT（有进度记录，可断点续跑）
node bin/export-ppt.cjs

# 2. 批量提取 AI 文稿为本地 TXT（已存在则跳过）
node bin/extract-manuscript.cjs

# 3. 批量生成并导出 AI 笔记（已存在则跳过；--force 重跑）
node bin/export-notes.cjs
```

可用参数：

- `--config <path>` 指定配置文件路径
- `--force`（仅笔记）忽略已有输出，重新处理

## 目录结构

```
baidu-ai-batch/
├── bin/
│   ├── export-ppt.cjs          # PPT 批量导出
│   ├── extract-manuscript.cjs  # 文稿批量提取
│   ├── export-notes.cjs        # 笔记批量生成/导出
│   └── list-files.cjs          # 从网盘生成视频清单
├── lib/
│   ├── cdp.js                  # CDP 连接/新标签页/JS 求值等公共能力
│   └── config.js               # 配置加载与解析
├── config.example.json         # 配置模板（复制为 config.json 使用）
└── video-list.txt              # 视频清单（由 list-files 生成）
```

## 注意事项

- 百度网盘 AI 功能是服务端生成的：若某视频的课件/文稿/笔记为空或只有占位模板文本，通常是服务端生成失败，重跑脚本也无效，需在网页端手动重试
- PPT 每次点击导出都会在网盘生成一个新文件（文件名带时间戳），重复运行会产生重复文件，注意自行清理
- 脚本串行执行（PPT 并发调高会导致服务端大量失败）
- `config.json`、`state.json`、`output/` 已在 `.gitignore` 中，不会上传仓库

## 许可

MIT
