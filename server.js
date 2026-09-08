// 以 SSE 回傳抓取進度的小型網頁服務
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listTargetVideos, collectComments } from './collector.js';
import { acquire } from './limit.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(root, 'public')));

/** 開一條 SSE，把 run(send, signal) 期間的事件推給前端 */
function stream(req, res, run) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  let closed = false;
  const send = (event) => {
    if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // req.ip 取的是連線來源；若擺在反向代理後面要另外設定 app.set('trust proxy', …)
  const slot = acquire(req.ip);
  if (!slot.ok) {
    send({ type: 'error', message: slot.reason });
    return res.end();
  }

  // 前端關掉連線（按停止、關分頁）就中止，別讓迴圈在背景繼續打 YouTube
  const abort = new AbortController();
  req.on('close', () => { closed = true; abort.abort(); });

  return run(send, abort.signal)
    .catch((error) => send({ type: 'error', message: error.message }))
    .finally(() => {
      slot.release();
      res.end();
    });
}

// 第一階段：列出符合上傳日期範圍的影片，供前端勾選
app.get('/api/videos', (req, res) => stream(req, res, (send, signal) => listTargetVideos(
  String(req.query.url || ''),
  { from: String(req.query.from || ''), to: String(req.query.to || ''), signal },
  send
)));

// 第二階段：抓取勾選影片的留言
app.get('/api/collect', (req, res) => stream(req, res, (send, signal) => collectComments(
  String(req.query.ids || '').split(',').filter(Boolean),
  {
    keyword: String(req.query.keyword || ''),
    maxCommentsPerVideo: Number(req.query.maxCommentsPerVideo || 0),
    signal
  },
  send
)));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`YouTube 留言彙整工具： http://localhost:${port}`);
});
