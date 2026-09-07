// 以 SSE 回傳抓取進度的小型網頁服務
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listTargetVideos, collectComments } from './collector.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(root, 'public')));

/** 開一條 SSE，把 run(send) 期間的事件推給前端 */
function stream(res, req, run) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event) => {
    if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  return run(send)
    .catch((error) => send({ type: 'error', message: error.message }))
    .finally(() => res.end());
}

// 第一階段：列出符合上傳日期範圍的影片，供前端勾選
app.get('/api/videos', (req, res) => stream(res, req, (send) => listTargetVideos(
  String(req.query.url || ''),
  { from: String(req.query.from || ''), to: String(req.query.to || '') },
  send
)));

// 第二階段：抓取勾選影片的留言
app.get('/api/collect', (req, res) => stream(res, req, (send) => collectComments(
  String(req.query.ids || '').split(',').filter(Boolean),
  {
    keyword: String(req.query.keyword || ''),
    maxCommentsPerVideo: Number(req.query.maxCommentsPerVideo || 0)
  },
  send
)));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`YouTube 留言彙整工具： http://localhost:${port}`);
});
