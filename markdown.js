// 把單支影片的留言輸出成 Markdown

function esc(text) {
  return String(text || '').replace(/\r/g, '');
}

function indent(text, prefix) {
  return esc(text).split('\n').map((line) => prefix + line).join('\n');
}

function commentBlock(comment, level) {
  const bullet = level === 0 ? '-' : '  -';
  const pad = level === 0 ? '  ' : '    ';
  const meta = [
    comment.publishedText,
    `👍 ${comment.likeCount}`,
    comment.isPinned ? '📌 置頂' : '',
    comment.authorIsOwner ? '🎬 頻道作者' : ''
  ].filter(Boolean).join(' · ');
  const head = `${bullet} **${comment.author}** — ${meta}`;
  return `${head}\n\n${indent(comment.text, pad)}\n`;
}

/** 產生檔名安全的字串 */
export function markdownFilename(video) {
  const title = String(video.title || 'video').replace(/[\\/:*?"<>|\n\r]+/g, '_').trim().slice(0, 60);
  return `${title || 'video'}-${video.id}.md`;
}

/**
 * @param {object} video 影片資訊
 * @param {Array} threads 已篩選的留言串
 * @param {{keyword?:string,total?:number}} filters
 */
export function renderMarkdown(video, threads, filters = {}) {
  const lines = [];
  lines.push(`# ${video.title}`, '');
  lines.push(`[![縮圖](${video.thumbnail})](${video.url})`, '');
  lines.push(`- 影片網址：${video.url}`);
  if (video.channelName) lines.push(`- 頻道：${video.channelName}`);
  if (video.publishedText) lines.push(`- 上傳時間：${video.publishedText}`);
  lines.push(`- 關鍵字：${filters.keyword ? `「${filters.keyword}」` : '無'}`);
  lines.push(`- 留言數（含回覆）：${filters.total ?? 0}`, '');
  lines.push('---', '');

  if (!threads.length) {
    lines.push('（沒有符合條件的留言）', '');
    return lines.join('\n');
  }

  for (const thread of threads) {
    if (thread.placeholder) {
      lines.push(`- _（主留言不符合篩選條件，僅保留以下回覆）_`, '');
    } else {
      lines.push(commentBlock(thread, 0));
    }
    for (const reply of thread.replies || []) {
      lines.push(commentBlock(reply, 1));
    }
  }
  return lines.join('\n');
}
