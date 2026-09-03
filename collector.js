// 依網址彙整留言：列出影片 → 逐支抓留言 → 套用篩選 → 產生 Markdown
import { parseTarget, listVideos, fetchThreads } from './youtube.js';
import { filterThreads } from './filter.js';
import { renderMarkdown, markdownFilename } from './markdown.js';

const KIND_LABEL = { video: '單支影片', playlist: '播放清單', channel: '頻道' };

/**
 * @param {string} url YouTube 影片 / 播放清單 / 頻道網址
 * @param {{from?:string,to?:string,keyword?:string,maxVideos?:number,maxCommentsPerVideo?:number}} options
 * @param {(event:object)=>void} [onEvent] 進度事件（target / videos / video-start / comment-progress / video-done / video-error / done）
 */
export async function collect(url, options = {}, onEvent = () => {}) {
  const { from = '', to = '', keyword = '', maxVideos = 0, maxCommentsPerVideo = 0 } = options;
  const target = parseTarget(url);
  onEvent({ type: 'target', kind: target.kind, label: KIND_LABEL[target.kind] });

  const videos = await listVideos(target, {
    limit: maxVideos,
    onProgress: (found) => onEvent({ type: 'listing', found })
  });
  onEvent({ type: 'videos', videos });

  const results = [];
  let comments = 0;
  for (const [index, video] of videos.entries()) {
    onEvent({ type: 'video-start', index, total: videos.length, video });
    try {
      const { threads, total: fetched } = await fetchThreads(video.id, {
        maxComments: maxCommentsPerVideo,
        onProgress: (n) => onEvent({ type: 'comment-progress', index, total: videos.length, fetched: n })
      });
      const filtered = filterThreads(threads, { from, to, keyword });
      comments += filtered.total;
      const result = {
        video,
        fetched,
        count: filtered.total,
        threads: filtered.threads,
        filename: markdownFilename(video),
        markdown: renderMarkdown(video, filtered.threads, { from, to, keyword, total: filtered.total })
      };
      results.push(result);
      onEvent({ type: 'video-done', index, total: videos.length, ...result });
    } catch (error) {
      onEvent({ type: 'video-error', index, total: videos.length, video, message: error.message });
    }
  }
  onEvent({ type: 'done', videos: videos.length, comments });
  return { kind: target.kind, videos, results, comments };
}
