// 兩階段流程：① 依上傳日期列出影片供勾選 ② 抓選定影片的留言
import { parseTarget, listVideos, fetchVideoDetails, getCachedVideo, fetchThreads } from './youtube.js';
import { filterThreads, relativeRange, rangeOverlaps, inDateRange } from './filter.js';
import { renderMarkdown, markdownFilename } from './markdown.js';

/** 單次可彙整的影片上限，超過請分批 */
export const MAX_VIDEOS = 20;

const KIND_LABEL = { video: '單支影片', playlist: '播放清單', channel: '頻道' };

/**
 * 影片清單只給相對時間（"1mo ago"），頻道 Shorts 連時間都沒有，
 * 所以先用「可能區間」粗篩，再逐支取回精確上傳時間確認。
 */
async function filterByUploadDate(videos, from, to, onEvent) {
  const now = new Date();
  const candidates = videos.filter((v) => rangeOverlaps(relativeRange(v.publishedText, now), from, to));
  const kept = [];
  for (const [index, video] of candidates.entries()) {
    onEvent({ type: 'resolving', done: index, total: candidates.length });
    try {
      const detailed = await fetchVideoDetails(video.id);
      if (inDateRange(detailed.publishedAt, from, to)) kept.push(detailed);
    } catch {
      // 影片可能已私人化或下架，拿不到上傳時間就不納入
    }
  }
  onEvent({ type: 'resolving', done: candidates.length, total: candidates.length });
  return kept;
}

/**
 * 第一階段：列出網址底下、上傳時間落在範圍內的影片（不抓留言）
 * @param {string} url YouTube 影片 / 播放清單 / 頻道網址
 * @param {{from?:string,to?:string}} options 影片上傳時間範圍
 * @param {(event:object)=>void} [onEvent] 進度事件（target / listing / resolving / videos）
 */
export async function listTargetVideos(url, options = {}, onEvent = () => {}) {
  const { from = '', to = '' } = options;
  const target = parseTarget(url);
  onEvent({ type: 'target', kind: target.kind, label: KIND_LABEL[target.kind] });

  const found = await listVideos(target, {
    onProgress: (n) => onEvent({ type: 'listing', found: n })
  });
  const videos = (from || to) ? await filterByUploadDate(found, from, to, onEvent) : found;

  onEvent({ type: 'videos', kind: target.kind, videos, scanned: found.length, max: MAX_VIDEOS });
  return { kind: target.kind, videos, scanned: found.length };
}

/**
 * 第二階段：抓取選定影片的留言
 * @param {string[]} ids 影片 ID，最多 MAX_VIDEOS 支
 * @param {{keyword?:string,maxCommentsPerVideo?:number}} options
 * @param {(event:object)=>void} [onEvent] 進度事件（video-start / comment-progress / video-done / video-error / done）
 */
export async function collectComments(ids, options = {}, onEvent = () => {}) {
  const { keyword = '', maxCommentsPerVideo = 0 } = options;
  if (!ids.length) throw new Error('請至少選擇一支影片');
  if (ids.length > MAX_VIDEOS) {
    throw new Error(`一次最多 ${MAX_VIDEOS} 支影片（目前 ${ids.length} 支），請分批執行`);
  }

  const results = [];
  let comments = 0;
  for (const [index, id] of ids.entries()) {
    const video = getCachedVideo(id) || await fetchVideoDetails(id);
    onEvent({ type: 'video-start', index, total: ids.length, video });
    try {
      const { threads, total: fetched } = await fetchThreads(id, {
        maxComments: maxCommentsPerVideo,
        onProgress: (n) => onEvent({ type: 'comment-progress', index, total: ids.length, fetched: n })
      });
      const filtered = filterThreads(threads, { keyword });
      comments += filtered.total;
      const result = {
        video,
        fetched,
        count: filtered.total,
        threads: filtered.threads,
        filename: markdownFilename(video),
        markdown: renderMarkdown(video, filtered.threads, { keyword, total: filtered.total })
      };
      results.push(result);
      onEvent({ type: 'video-done', index, total: ids.length, ...result });
    } catch (error) {
      onEvent({ type: 'video-error', index, total: ids.length, video, message: error.message });
    }
  }
  onEvent({ type: 'done', videos: ids.length, comments });
  return { results, comments };
}
