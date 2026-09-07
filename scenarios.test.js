// 實際連線 YouTube 的驗收測試（三種情境 + 五項驗收條件）
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, listVideos } from './youtube.js';
import { listTargetVideos, collectComments, MAX_VIDEOS } from './collector.js';
import { flattenComments, dayStart, dayEnd } from './filter.js';

const PLAYLIST_URL = 'https://www.youtube.com/watch?v=2hbYCe_E5aU&list=PLWWZkn1dW3eAvSZfJv0-02q27JIsfbN2f';
const VIDEO_URL = 'https://www.youtube.com/watch?v=2hbYCe_E5aU';
const CHANNEL_URL = 'https://www.youtube.com/@dlcorner';

const MIN_PLAYLIST_VIDEOS = 10;
const MIN_VIDEO_COMMENTS = 400;
const MIN_CHANNEL_VIDEOS = 40;

const report = [];
let singleVideo = null;
let channelTotal = 0;

const isoDate = (d) => d.toLocaleDateString('en-CA');

after(() => {
  console.log('\n===== 各情境實際數量 =====');
  for (const line of report) console.log(line);
});

test('情境一：播放清單列出的影片數 ≥ 10', async () => {
  const videos = await listVideos(parseTarget(PLAYLIST_URL));
  report.push(`播放清單：影片 ${videos.length} 支`);
  assert.ok(videos.length >= MIN_PLAYLIST_VIDEOS, `只取得 ${videos.length} 支影片`);
  assert.ok(videos.every((v) => /^[\w-]{11}$/.test(v.id) && v.thumbnail.includes(v.id)));
});

test('情境一：播放清單可彙整留言並輸出各自的 Markdown', async () => {
  const listed = await listTargetVideos(PLAYLIST_URL);
  assert.equal(listed.kind, 'playlist');
  const ids = listed.videos.slice(0, 2).map((v) => v.id);

  const result = await collectComments(ids, { maxCommentsPerVideo: 30 });
  assert.equal(result.results.length, 2);
  const names = result.results.map((r) => r.filename);
  assert.equal(new Set(names).size, 2, '不同影片要有不同檔名');
  for (const r of result.results) {
    assert.ok(r.count > 0, `${r.video.title} 沒有留言`);
    assert.ok(r.markdown.includes(r.video.title));
    assert.ok(r.markdown.includes(r.video.thumbnail));
  }
  report.push(`播放清單：前 2 支影片共彙整 ${result.comments} 則留言`);
});

test('情境二：單支影片留言總數 ≥ 400', async () => {
  const events = [];
  const listed = await listTargetVideos(VIDEO_URL, {}, (e) => events.push(e));
  assert.equal(listed.kind, 'video');

  singleVideo = await collectComments(listed.videos.map((v) => v.id), {}, (e) => events.push(e));
  const first = singleVideo.results[0];
  report.push(`單支影片：${first.video.title}`);
  report.push(`單支影片：主留言 ${first.threads.length} 則、含回覆共 ${singleVideo.comments} 則`);
  assert.ok(singleVideo.comments >= MIN_VIDEO_COMMENTS, `只取得 ${singleVideo.comments} 則留言`);
  // 進度事件：知道正在抓哪支影片、抓到幾則
  assert.ok(events.some((e) => e.type === 'video-start' && e.video.title));
  assert.ok(events.some((e) => e.type === 'comment-progress' && e.fetched > 0));
  assert.ok(events.at(-1).type === 'done');
  // 階層：至少要有帶回覆的留言串
  assert.ok(first.threads.some((t) => t.replies.length > 0));
});

test('情境三：頻道列出的影片數 ≥ 40', async () => {
  const videos = await listVideos(parseTarget(CHANNEL_URL));
  channelTotal = videos.length;
  report.push(`頻道：影片 ${videos.length} 支`);
  assert.ok(videos.length >= MIN_CHANNEL_VIDEOS, `只取得 ${videos.length} 支影片`);
  assert.equal(new Set(videos.map((v) => v.id)).size, videos.length, '影片不應重複');
});

test('情境三：頻道可彙整留言', async () => {
  const listed = await listTargetVideos(CHANNEL_URL);
  assert.equal(listed.kind, 'channel');
  const result = await collectComments([listed.videos[0].id], { maxCommentsPerVideo: 20 });
  assert.equal(result.results.length, 1);
  report.push(`頻道：第 1 支影片彙整 ${result.comments} 則留言`);
});

test('驗收④：設定時間範圍後，清單裡只剩該期間上傳的影片', async () => {
  const to = new Date();
  const from = new Date(to.getTime() - 120 * 24 * 60 * 60 * 1000);
  const range = { from: isoDate(from), to: isoDate(to) };

  const { videos } = await listTargetVideos(CHANNEL_URL, range);
  report.push(`上傳日期篩選（${range.from} ~ ${range.to}）：${videos.length} 支影片`);
  assert.ok(videos.length > 0, '篩選後不該是空的');
  assert.ok(videos.length < channelTotal, '篩選後應該比全部少');
  for (const v of videos) {
    assert.ok(v.publishedAt, `${v.title} 沒有精確上傳時間`);
    const at = new Date(v.publishedAt);
    assert.ok(at >= dayStart(range.from) && at <= dayEnd(range.to), `${v.title} 超出範圍：${v.publishedAt}`);
  }
});

test('驗收：一次超過 20 支影片會被擋下，要求分批', async () => {
  const ids = Array.from({ length: MAX_VIDEOS + 1 }, (_, i) => `video${i}`);
  await assert.rejects(() => collectComments(ids), /最多 20 支影片/);
});

test('驗收⑤：設定關鍵字後，每一則留言都含該關鍵字', async () => {
  assert.ok(singleVideo, '需先完成情境二');
  const all = flattenComments(singleVideo.results[0].threads);
  const keyword = ['謝謝', '感謝', '請問', '教學', '影片']
    .find((k) => all.filter((c) => c.text.includes(k)).length >= 3);
  assert.ok(keyword, '找不到適合的測試關鍵字');

  const result = await collectComments([singleVideo.results[0].video.id], { keyword });
  const comments = flattenComments(result.results[0].threads);
  report.push(`關鍵字篩選（${keyword}）：${result.comments} 則留言`);
  assert.ok(comments.length > 0);
  assert.equal(comments.length, result.comments);
  for (const c of comments) {
    assert.ok(c.text.includes(keyword), `留言未含關鍵字：${c.text.slice(0, 40)}`);
  }
});
