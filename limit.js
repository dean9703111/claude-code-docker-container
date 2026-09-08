// 後端保護：抓一次頻道會對 YouTube 發出大量請求，限制來源的請求頻率與同時進行的任務數

export const WINDOW_MS = 60 * 1000;
export const MAX_PER_WINDOW = 20;   // 每個來源每分鐘的請求數
export const MAX_CONCURRENT = 2;    // 全站同時進行的任務數

const hits = new Map();      // ip -> 最近一分鐘的請求時間
const running = new Set();   // 正在跑任務的來源

function tooFrequent(ip, now) {
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

/**
 * 取得一個任務名額。被擋下的請求一樣算進頻率，避免重試不用付代價。
 * @returns {{ok:true, release:()=>void}|{ok:false, reason:string}}
 */
export function acquire(ip, now = Date.now()) {
  if (tooFrequent(ip, now)) {
    return { ok: false, reason: `請求太頻繁，請等一分鐘再試（每分鐘最多 ${MAX_PER_WINDOW} 次）` };
  }
  if (running.has(ip)) {
    return { ok: false, reason: '你已經有一個任務進行中，請先按停止或等它跑完' };
  }
  if (running.size >= MAX_CONCURRENT) {
    return { ok: false, reason: `伺服器同時只處理 ${MAX_CONCURRENT} 個任務，請稍後再試` };
  }
  running.add(ip);
  return { ok: true, release: () => running.delete(ip) };
}
