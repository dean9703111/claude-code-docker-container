// 相對時間換算、影片上傳日期判斷與留言關鍵字篩選

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000
};

// 留言是全字（"3 months ago"），影片清單是縮寫（"3d ago" / "1mo ago"），兩種都要認。
// 順序有意義：years? 要排在 y 前面、months?/mo 要排在 minutes?/m 前面。
const RELATIVE = /(\d+)\s*(years?|y|months?|mo|weeks?|w|days?|d|hours?|hr|h|minutes?|min|m|seconds?|sec|s)\s+ago/i;

function unitKey(raw) {
  const u = raw.toLowerCase();
  if (u.startsWith('y')) return 'y';
  if (u.startsWith('mo')) return 'mo';
  if (u.startsWith('w')) return 'w';
  if (u.startsWith('d')) return 'd';
  if (u.startsWith('h')) return 'h';
  if (u.startsWith('m')) return 'm';
  return 's';
}

function parseRelative(text) {
  const m = RELATIVE.exec(String(text || ''));
  return m ? { n: Number(m[1]), unit: unitKey(m[2]) } : null;
}

/** 從 now 往回推 n 個單位 */
function shiftBack(now, n, unit) {
  const d = new Date(now.getTime());
  if (unit === 'y') {
    d.setFullYear(d.getFullYear() - n);
    return d;
  }
  if (unit === 'mo') {
    d.setMonth(d.getMonth() - n);
    return d;
  }
  return new Date(now.getTime() - n * UNIT_MS[unit]);
}

/**
 * YouTube 網頁端只提供相對時間，沒有絕對時間戳，
 * 這裡以抓取當下往回推算出估計發表時間。
 * @returns {Date|null}
 */
export function relativeToDate(text, now = new Date()) {
  const p = parseRelative(text);
  return p ? shiftBack(now, p.n, p.unit) : null;
}

/**
 * 「1mo ago」實際落在 1～2 個月前，換算成可能的時間區間，用來粗篩影片。
 * 無法解析（例如頻道 Shorts 沒有時間欄位）回傳 null。
 * @returns {{earliest:Date, latest:Date}|null}
 */
export function relativeRange(text, now = new Date()) {
  const p = parseRelative(text);
  if (!p) return null;
  return { earliest: shiftBack(now, p.n + 1, p.unit), latest: shiftBack(now, p.n, p.unit) };
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

/** 可能區間與 [from, to] 有沒有交集；區間未知一律當成有可能（之後再取精確日期確認） */
export function rangeOverlaps(range, from, to) {
  if (!range) return true;
  const start = dayStart(from);
  const end = dayEnd(to);
  if (start && range.latest < start) return false;
  if (end && range.earliest > end) return false;
  return true;
}

/** 精確上傳時間是否落在 [from, to]；日期不明視為不符合 */
export function inDateRange(iso, from, to) {
  if (!iso) return false;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  const start = dayStart(from);
  const end = dayEnd(to);
  if (start && at < start) return false;
  if (end && at > end) return false;
  return true;
}

export function matchComment(comment, { keyword = '' } = {}) {
  if (!keyword) return true;
  return String(comment.text || '').toLowerCase().includes(keyword.toLowerCase());
}

/**
 * 逐則留言套用關鍵字（回覆也獨立判斷）。
 * 主留言不符合但底下有符合的回覆時，保留該串並把主留言標成 placeholder：
 * 只留作者與階層位置，不輸出內容，也不列入留言數。
 */
export function filterThreads(threads, options = {}) {
  const opts = { keyword: (options.keyword || '').trim() };
  if (!opts.keyword) return { threads, total: countComments(threads) };

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
