// 留言篩選：相對時間換算、日期區間與關鍵字過濾

const UNIT_MS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000
};

/**
 * YouTube 網頁端只提供相對時間（例："3 months ago"），沒有絕對時間戳，
 * 這裡以抓取當下往回推算出估計發表時間。
 * @returns {Date|null}
 */
export function relativeToDate(text, now = new Date()) {
  if (!text) return null;
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const d = new Date(now.getTime());
  if (unit === 'month') {
    d.setMonth(d.getMonth() - n);
    return d;
  }
  if (unit === 'year') {
    d.setFullYear(d.getFullYear() - n);
    return d;
  }
  return new Date(now.getTime() - n * UNIT_MS[unit]);
}

/** 把 YYYY-MM-DD 轉成當天起訖時間；空值回傳 null */
export function dayStart(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dayEnd(value) {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function matchComment(comment, { from = null, to = null, keyword = '' } = {}) {
  if (keyword) {
    const text = String(comment.text || '').toLowerCase();
    if (!text.includes(keyword.toLowerCase())) return false;
  }
  if (from || to) {
    if (!comment.publishedAt) return false;
    const at = new Date(comment.publishedAt);
    if (from && at < from) return false;
    if (to && at > to) return false;
  }
  return true;
}

/**
 * 逐則留言套用條件（回覆也獨立判斷）。
 * 主留言不符合但底下有符合的回覆時，保留該串並把主留言標成 placeholder：
 * 只留作者與階層位置，不輸出內容，也不列入留言數。
 */
export function filterThreads(threads, options = {}) {
  const opts = {
    from: dayStart(options.from),
    to: dayEnd(options.to),
    keyword: (options.keyword || '').trim()
  };
  const active = Boolean(opts.from || opts.to || opts.keyword);
  if (!active) return { threads, total: countComments(threads) };

  const kept = [];
  for (const thread of threads) {
    const replies = (thread.replies || []).filter((r) => matchComment(r, opts));
    const selfMatch = matchComment(thread, opts);
    if (!selfMatch && replies.length === 0) continue;
    kept.push(selfMatch
      ? { ...thread, replies }
      : { ...thread, text: '', publishedText: '', publishedAt: null, likeCount: 0, placeholder: true, replies });
  }
  return { threads: kept, total: countComments(kept) };
}

/** 統計留言數（主留言 + 回覆，不含 placeholder） */
export function countComments(threads) {
  let n = 0;
  for (const t of threads) {
    if (!t.placeholder) n += 1;
    n += (t.replies || []).length;
  }
  return n;
}

/** 攤平成陣列，方便驗證 */
export function flattenComments(threads) {
  const out = [];
  for (const t of threads) {
    if (!t.placeholder) out.push(t);
    for (const r of t.replies || []) out.push(r);
  }
  return out;
}
