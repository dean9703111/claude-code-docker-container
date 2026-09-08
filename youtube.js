// 透過 youtubei.js（YouTube 內部 InnerTube 介面，免 API key）取得影片清單與留言
import { Innertube, Log } from 'youtubei.js';
import { relativeToDate } from './filter.js';

Log.setLevel(Log.Level.NONE);

const VIDEO_ID = /^[\w-]{11}$/;

let clientPromise = null;
export function getClient() {
  if (!clientPromise) {
    // 固定 en-US，讓留言的相對時間字串（"3 months ago"）格式可預期
    clientPromise = Innertube.create({ lang: 'en', location: 'US', retrieve_player: false });
  }
  return clientPromise;
}

/** 解析使用者輸入的網址，判斷是影片、播放清單還是頻道 */
export function parseTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('請輸入 YouTube 網址');
  if (VIDEO_ID.test(raw)) return { kind: 'video', id: raw, url: `https://www.youtube.com/watch?v=${raw}` };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`無法解析的網址：${raw}`);
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (!/^(youtube\.com|youtu\.be|music\.youtube\.com)$/.test(host)) {
    throw new Error('只支援 YouTube 網址');
  }
  const path = url.pathname.replace(/\/$/, '');
  const list = url.searchParams.get('list');

  // 帶 list= 一律視為播放清單（RD 開頭是自動推薦清單，不算）
  if (list && !/^RD/.test(list)) return { kind: 'playlist', id: list, url: url.href };
  if (host === 'youtu.be') return video(path.slice(1), url.href);

  const v = url.searchParams.get('v');
  if (v) return video(v, url.href);

  const embedded = /^\/(shorts|live|embed|v)\/([\w-]{11})/.exec(path);
  if (embedded) return video(embedded[2], url.href);

  if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)$/.test(path)) {
    return { kind: 'channel', id: `https://www.youtube.com${path}`, url: url.href };
  }
  throw new Error(`無法判斷網址類型：${raw}`);
}

function video(id, href) {
  if (!VIDEO_ID.test(id)) throw new Error(`無效的影片 ID：${id}`);
  return { kind: 'video', id, url: href || `https://www.youtube.com/watch?v=${id}` };
}

// 列清單時看過的影片；第二階段只拿到影片 ID，靠這裡取回標題與縮圖，不必重抓
const videoCache = new Map();

function remember(video) {
  videoCache.set(video.id, video);
  return video;
}

function makeVideo(id, title, publishedText, channelName = '', publishedAt = null) {
  return remember({
    id,
    title: title || '(無標題)',
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedText: publishedText || '',
    publishedAt,
    channelName
  });
}

export function getCachedVideo(id) {
  return videoCache.get(id) || null;
}

/**
 * 取回單支影片的精確上傳時間（清單只有相對時間，Shorts 甚至沒有），順便補上標題與頻道名。
 * @returns {Promise<object>} 更新後的影片物件，publishedAt 為 ISO 字串（取不到則為 null）
 */
export async function fetchVideoDetails(id) {
  const yt = await getClient();
  const info = await yt.getInfo(id);
  const publishedAt = info.page?.[0]?.microformat?.publish_date || null;
  const cached = videoCache.get(id);
  return makeVideo(
    id,
    info.basic_info?.title || cached?.title,
    publishedAt ? publishedAt.slice(0, 10) : (cached?.publishedText || info.primary_info?.published?.text),
    info.basic_info?.channel?.name || cached?.channelName || '',
    publishedAt
  );
}

/** 清單項目有新舊兩種節點格式（LockupView / Video），統一轉成同一份資料 */
function normalizeListItem(item) {
  if (!item) return null;
  if (item.type === 'ShortsLockupView') {
    const id = item.on_tap_endpoint?.payload?.videoId;
    const title = item.overlay_metadata?.primary_text?.text
      || String(item.accessibility_text || '').split(',')[0];
    return id ? makeVideo(id, title, '') : null;
  }
  if (item.type === 'LockupView') {
    if (item.content_type && item.content_type !== 'VIDEO') return null;
    const parts = (item.metadata?.metadata?.metadata_rows || [])
      .flatMap((row) => (row.metadata_parts || []).map((p) => p.text?.text))
      .filter(Boolean);
    return makeVideo(item.content_id, item.metadata?.title?.text, parts.find((t) => /ago$/i.test(t)));
  }
  const id = item.id || item.video_id;
  if (!id) return null;
  return makeVideo(id, item.title?.text ?? String(item.title ?? ''), item.published?.text, item.author?.name);
}

async function collectPages(first, limit, onProgress, signal, out = [], seen = new Set()) {
  let page = first;
  while (page) {
    if (signal?.aborted) break;
    for (const item of page.videos || []) {
      const v = normalizeListItem(item);
      if (!v || !VIDEO_ID.test(v.id) || seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
    onProgress?.(out.length);
    if (limit && out.length >= limit) break;
    if (!page.has_continuation) break;
    page = await page.getContinuation();
  }
  return limit ? out.slice(0, limit) : out;
}

/** 頻道的長片與 Shorts 分屬不同分頁，兩個都算「影片」 */
async function collectChannelVideos(channel, limit, onProgress, signal) {
  const out = [];
  const seen = new Set();
  await collectPages(await channel.getVideos(), limit, onProgress, signal, out, seen);
  if (!limit || out.length < limit) {
    if (channel.has_shorts && !signal?.aborted) {
      await collectPages(await channel.getShorts(), limit, onProgress, signal, out, seen);
    }
  }
  return limit ? out.slice(0, limit) : out;
}

async function resolveChannelId(yt, input) {
  const m = /\/channel\/(UC[\w-]+)/.exec(input);
  if (m) return m[1];
  const endpoint = await yt.resolveURL(input);
  const id = endpoint?.payload?.browseId;
  if (!id) throw new Error(`找不到頻道：${input}`);
  return id;
}

/**
 * 依 target 列出要處理的影片
 * @param {{kind:string,id:string}} target
 * @param {{limit?:number, onProgress?:(n:number)=>void, signal?:AbortSignal}} options
 */
export async function listVideos(target, { limit = 0, onProgress, signal } = {}) {
  const yt = await getClient();
  if (target.kind === 'video') {
    return [await fetchVideoDetails(target.id)];
  }
  if (target.kind === 'playlist') {
    const playlist = await yt.getPlaylist(target.id);
    const author = playlist.info?.author?.name;
    const videos = await collectPages(playlist, limit, onProgress, signal);
    return videos.map((v) => remember({ ...v, channelName: v.channelName || author || '' }));
  }
  const channelId = await resolveChannelId(yt, target.id);
  const channel = await yt.getChannel(channelId);
  const videos = await collectChannelVideos(channel, limit, onProgress, signal);
  const name = channel.metadata?.title || '';
  return videos.map((v) => remember({ ...v, channelName: v.channelName || name }));
}

function normalizeComment(node, publishedNow) {
  const c = node?.comment ?? node;
  if (!c) return null;
  return {
    id: c.comment_id || '',
    author: c.author?.name || '',
    authorThumbnail: c.author?.thumbnails?.[0]?.url || '',
    authorIsOwner: Boolean(c.author_is_channel_owner),
    isPinned: Boolean(c.is_pinned),
    text: c.content?.text || '',
    publishedText: c.published_time || '',
    publishedAt: publishedNow(c.published_time),
    likeCount: Number(c.like_count || 0),
    replies: []
  };
}

/** 回覆分頁：sub_threads 裡可能是「更多回覆」的 continuation，也可能是巢狀的回覆串 */
function replyNodes(node) {
  return [...(node.replies || []), ...(node.comment_replies_data?.sub_threads || [])];
}

function continuationEndpoint(node) {
  const item = (node.comment_replies_data?.sub_threads || []).find((n) => n.type === 'ContinuationItem');
  return item?.button?.endpoint || item?.endpoint || null;
}

/**
 * 取回一則主留言底下的所有回覆。
 * YouTube 會把「回覆的回覆」再包一層 CommentThread，這裡一律攤平成同一層，
 * 與網頁上的呈現一致。
 */
async function fetchReplies(yt, thread, publishedNow, signal) {
  const out = [];
  const seen = new Set();
  const pending = [thread];

  const take = (node) => {
    const id = node.comment?.comment_id;
    if (!node.comment || (id && seen.has(id))) return;
    if (id) seen.add(id);
    const reply = normalizeComment(node, publishedNow);
    if (reply) out.push(reply);
    pending.push(node);
  };

  while (pending.length) {
    if (signal?.aborted) break;
    const node = pending.shift();
    for (const child of replyNodes(node)) {
      if (child.type === 'CommentThread') take(child);
    }
    let endpoint = continuationEndpoint(node);
    while (endpoint) {
      const response = await endpoint.call(yt.actions, { parse: true });
      let next = null;
      for (const group of response.on_response_received_endpoints || []) {
        for (const item of group.contents || []) {
          if (item.type === 'CommentThread') take(item);
          else if (item.type === 'ContinuationItem') next = item.button?.endpoint || item.endpoint;
        }
      }
      endpoint = next;
    }
  }
  return out;
}

/**
 * 抓取單支影片的所有留言（含回覆）
 * @param {string} videoId
 * @param {{maxComments?:number, onProgress?:(n:number)=>void, now?:Date, signal?:AbortSignal}} options
 */
export async function fetchThreads(videoId, { maxComments = 0, onProgress, now = new Date(), signal } = {}) {
  const yt = await getClient();
  const publishedNow = (text) => {
    const d = relativeToDate(text, now);
    return d ? d.toISOString() : null;
  };
  const threads = [];
  let total = 0;
  // 依「最新」排序：熱門排序會隱藏部分留言，最新排序才拿得到完整串
  let page = await yt.getComments(videoId, 'NEWEST_FIRST');
  const declared = Number(String(page.header?.count?.text || '').replace(/[^\d]/g, '')) || 0;

  outer: while (page) {
    for (const node of page.contents || []) {
      const thread = normalizeComment(node, publishedNow);
      if (!thread) continue;
      if (signal?.aborted) break outer;
      if (node.has_replies) thread.replies = await fetchReplies(yt, node, publishedNow, signal);
      threads.push(thread);
      total += 1 + thread.replies.length;
      onProgress?.(total);
      if (maxComments && total >= maxComments) break outer;
    }
    if (!page.has_continuation) break;
    page = await page.getContinuation();
  }
  return { threads, total, declared };
}
