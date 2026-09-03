// 純邏輯測試（不連網）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeToDate, filterThreads, countComments, flattenComments } from './filter.js';
import { parseTarget } from './youtube.js';
import { renderMarkdown, markdownFilename } from './markdown.js';

const NOW = new Date('2026-09-03T00:00:00Z');

test('relativeToDate 換算相對時間', () => {
  assert.equal(relativeToDate('3 days ago', NOW).toISOString().slice(0, 10), '2026-08-31');
  assert.equal(relativeToDate('2 months ago', NOW).toISOString().slice(0, 10), '2026-07-03');
  assert.equal(relativeToDate('1 year ago (edited)', NOW).toISOString().slice(0, 10), '2025-09-03');
  assert.equal(relativeToDate(''), null);
  assert.equal(relativeToDate('剛剛'), null);
});

test('parseTarget 判斷網址類型', () => {
  assert.deepEqual(
    parseTarget('https://www.youtube.com/watch?v=2hbYCe_E5aU&list=PLabc'),
    { kind: 'playlist', id: 'PLabc', url: 'https://www.youtube.com/watch?v=2hbYCe_E5aU&list=PLabc' }
  );
  assert.equal(parseTarget('https://www.youtube.com/watch?v=2hbYCe_E5aU').kind, 'video');
  assert.equal(parseTarget('https://youtu.be/2hbYCe_E5aU').kind, 'video');
  assert.equal(parseTarget('https://www.youtube.com/shorts/2hbYCe_E5aU').kind, 'video');
  assert.equal(parseTarget('https://www.youtube.com/@dlcorner').kind, 'channel');
  assert.equal(parseTarget('https://www.youtube.com/channel/UCPLS1Hyv2vTXvMgjO4SMwDw').kind, 'channel');
  assert.throws(() => parseTarget(''), /請輸入/);
  assert.throws(() => parseTarget('https://example.com/watch?v=x'), /只支援/);
});

const sample = [
  {
    id: 'a', author: 'A', text: '這集很棒', publishedAt: '2026-05-01T12:00:00.000Z',
    publishedText: '4 months ago', likeCount: 3,
    replies: [
      { id: 'a1', author: 'B', text: '同意很棒', publishedAt: '2026-06-01T00:00:00.000Z', publishedText: '3 months ago', likeCount: 0 },
      { id: 'a2', author: 'C', text: '沒感覺', publishedAt: '2026-01-01T00:00:00.000Z', publishedText: '8 months ago', likeCount: 0 }
    ]
  },
  {
    id: 'b', author: 'D', text: '路過', publishedAt: '2026-08-01T00:00:00.000Z',
    publishedText: '1 month ago', likeCount: 1,
    replies: [
      { id: 'b1', author: 'E', text: '很棒的教學', publishedAt: '2026-08-02T00:00:00.000Z', publishedText: '1 month ago', likeCount: 0 }
    ]
  }
];

test('countComments 含回覆', () => {
  assert.equal(countComments(sample), 5);
});

test('關鍵字篩選後每則留言都含關鍵字', () => {
  const { threads, total } = filterThreads(sample, { keyword: '很棒' });
  const flat = flattenComments(threads);
  assert.equal(total, 3);
  assert.equal(flat.length, 3);
  for (const c of flat) assert.ok(c.text.includes('很棒'), c.text);
  // 主留言不符時保留為 placeholder，且不計入留言數、不輸出內容
  const placeholder = threads.find((t) => t.placeholder);
  assert.equal(placeholder.id, 'b');
  assert.equal(placeholder.text, '');
});

test('日期區間篩選後沒有區間外的留言', () => {
  const { threads, total } = filterThreads(sample, { from: '2026-05-01', to: '2026-06-30' });
  const flat = flattenComments(threads);
  assert.equal(total, 2);
  for (const c of flat) {
    const at = new Date(c.publishedAt);
    assert.ok(at >= new Date('2026-05-01T00:00:00'), c.publishedAt);
    assert.ok(at <= new Date('2026-06-30T23:59:59.999'), c.publishedAt);
  }
});

test('Markdown 產出含縮圖、階層與檔名', () => {
  const video = { id: 'abc12345678', title: 'Vibe/Coding: 教學', url: 'https://youtu.be/abc12345678', thumbnail: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg', channelName: 'Ch' };
  const md = renderMarkdown(video, sample, { keyword: '', total: 5 });
  assert.match(md, /^# Vibe\/Coding: 教學/);
  assert.match(md, /!\[縮圖\]\(https:\/\/i\.ytimg\.com/);
  assert.match(md, /- \*\*A\*\*/);
  assert.match(md, /  - \*\*B\*\*/);
  assert.equal(markdownFilename(video), 'Vibe_Coding_ 教學-abc12345678.md');
});
