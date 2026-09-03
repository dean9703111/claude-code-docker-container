// 以 SSE 回傳抓取進度的小型網頁服務
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { collect } from './collector.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(root, 'public')));

app.get('/api/collect', async (req, res) => {
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

  try {
    await collect(String(req.query.url || ''), {
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
      keyword: String(req.query.keyword || ''),
      maxVideos: Number(req.query.maxVideos || 0),
      maxCommentsPerVideo: Number(req.query.maxCommentsPerVideo || 0)
    }, send);
  } catch (error) {
    send({ type: 'error', message: error.message });
  }
  res.end();
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`YouTube 留言彙整工具： http://localhost:${port}`);
});
