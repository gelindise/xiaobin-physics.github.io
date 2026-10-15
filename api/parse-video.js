// Vercel 无服务器函数 —— 视频解析 / 下载中转
// ============================================================================
//  教学素材工具的后端。前端「视频解析下载.html」调用本接口。
//
//  三种模式：
//    · mode=parse  （默认）传入 url=分享链接
//        → 返回标准化 JSON：{ ok, platform, title, cover, author, duration, videos[] }
//        · 哔哩哔哩：走内置官方接口（view + player/playurl），【无需任何配置，开箱可用】
//        · 抖音 / 快手 / 微信视频号：平台无公开接口且带签名，走第三方聚合接口，
//          需配置环境变量 VIDEO_PARSE_API（见下）
//
//    · mode=info   传入 src=视频直链
//        → 返回 { ok, size, type, acceptRanges }，前端据此做分片下载
//
//    · mode=stream 传入 src=视频直链（可选 start/end 字节区间）
//        → 服务端补上平台 Referer/UA 后中转返回视频字节。
//          平台 CDN 有防盗链：Referer 为空会 403，只要带任意非空 Referer 即放行
//          （已实测），所以这里补 Referer 即可正常下载。支持 Range，前端按 4MB 分片。
//
//  需要配置的环境变量（Vercel → 项目 → Settings → Environment Variables）：
//    VIDEO_PARSE_API    第三方解析接口模板，用 {url} 占位。例：
//                         https://your-provider.com/api/parse?url={url}
//    VIDEO_PARSE_KEY    可选。作为 Authorization: Bearer 与 ?token= 一起发出
//    VIDEO_PARSE_FIELD  可选。指定返回体里直链的字段路径，如 data.video.play_url
//
//  安全：只允许 http(s)，拦截内网 / 本机地址（防 SSRF），并做实例级限频。
// ============================================================================
const { Readable } = require('stream');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const VIDEO_PARSE_API = process.env.VIDEO_PARSE_API || '';
const VIDEO_PARSE_KEY = process.env.VIDEO_PARSE_KEY || '';
const VIDEO_PARSE_FIELD = process.env.VIDEO_PARSE_FIELD || '';

// 平台 → 下载该平台 CDN 直链时需要的 Referer（防盗链）
const REFERER_BY_PLATFORM = {
  bilibili: 'https://www.bilibili.com',
  douyin: 'https://www.douyin.com/',
  kuaishou: 'https://www.kuaishou.com/',
  weixin: 'https://channels.weixin.qq.com/',
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (/bilibili\.com|b23\.tv|bv[0-9a-z]{10}/.test(u)) return 'bilibili';
  if (/douyin\.com|iesdouyin\.com/.test(u)) return 'douyin';
  if (/kuaishou\.com|chenzhongtech\.com|gifshow\.com/.test(u)) return 'kuaishou';
  if (/weixin\.qq\.com|channels\.weixin|finder\.video\.qq\.com|视频号/.test(u)) return 'weixin';
  return 'unknown';
}

function platformLabel(p) {
  return { bilibili: '哔哩哔哩', douyin: '抖音', kuaishou: '快手', weixin: '微信视频号' }[p] || '未知平台';
}

// 只允许 http(s)，且禁止内网 / 本机地址（SSRF 防护）
function isSafeRemoteUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || (a === 169 && b === 254)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  if (host === '[::1]' || host.includes(':')) return false;
  return true;
}

// 实例级轻量限频（够挡住脚本刷接口）
const _hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  if (_hits.size > 5000) _hits.clear();
  const rec = _hits.get(key);
  if (!rec || now - rec.at > windowMs) {
    _hits.set(key, { at: now, n: 1 });
    return false;
  }
  rec.n++;
  return rec.n > limit;
}
function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || 'unknown').split(',')[0].trim();
}

function pick(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

// 在任意结构的 JSON 里递归找第一个像样的视频直链
function findVideoUrl(node, depth) {
  depth = depth || 0;
  if (depth > 6 || node == null) return '';
  if (typeof node === 'string') {
    return /^https?:\/\//.test(node) && /\.(mp4|m4v|mov|flv|m3u8)(\?|$)/i.test(node) ? node : '';
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findVideoUrl(item, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof node === 'object') {
    // 优先看常见的直链字段
    const preferred = [
      'nwm_video_url_HQ', 'nwm_video_url', 'play_addr', 'playUrl', 'play_url',
      'video_url', 'videoUrl', 'download_url', 'downloadUrl', 'video', 'play', 'url',
    ];
    for (const key of preferred) {
      if (node[key] != null) {
        const hit = findVideoUrl(node[key], depth + 1);
        if (hit) return hit;
      }
    }
    for (const key of Object.keys(node)) {
      const hit = findVideoUrl(node[key], depth + 1);
      if (hit) return hit;
    }
  }
  return '';
}

// B 站对机房 IP 会返回 -412（request was banned），解决办法是带上 buvid3 Cookie。
// 官方 /x/frontend/finger/spi 就是给这个用的，取不到时退化成本地生成的 UUID 形状值。
let _biliCookie = { value: '', at: 0 };
function randomBuvid3() {
  const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
  return hex + 'infoc';
}
async function getBiliCookie(force) {
  const now = Date.now();
  if (!force && _biliCookie.value && now - _biliCookie.at < 30 * 60 * 1000) return _biliCookie.value;
  let cookie = '';
  try {
    const r = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Accept: 'application/json, text/plain, */*' },
    });
    const j = await r.json();
    const b3 = j && j.data && j.data.b_3;
    const b4 = j && j.data && j.data.b_4;
    if (b3) cookie = 'buvid3=' + b3 + (b4 ? '; buvid4=' + b4 : '');
  } catch (_) {}
  if (!cookie) cookie = 'buvid3=' + randomBuvid3();
  _biliCookie = { value: cookie, at: now };
  return cookie;
}

async function bfetch(url, referer, forceNewCookie) {
  const cookie = await getBiliCookie(forceNewCookie);
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: referer || 'https://www.bilibili.com',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Cookie: cookie,
    },
  });
}

// 带诊断的 JSON 解析：非 JSON（例如机房 IP 被 B 站拦截后返回的 HTML）时报出
// 真实状态码与正文片段，而不是一句无用的「Unexpected token '<'」。
async function bjson(res, what) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!/json/i.test(ct)) {
    throw new Error(
      `B站接口[${what}]返回非 JSON（HTTP ${res.status}，${ct || '无类型'}）：${text.slice(0, 200).replace(/\s+/g, ' ')}`
    );
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`B站接口[${what}]JSON 解析失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// 哔哩哔哩：内置官方接口解析（无需配置）
// ---------------------------------------------------------------------------
const QUALITY_MAP = { 127: '8K', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 64: '720P', 32: '480P', 16: '360P' };

async function parseBilibili(shareUrl) {
  let bvid = (shareUrl.match(/BV[0-9A-Za-z]{10}/) || [])[0] || '';
  const aid = (shareUrl.match(/\/av(\d+)/i) || [])[1] || '';

  if (!bvid && aid) {
    const j = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`), 'view/aid');
    if (j.code !== 0) throw new Error('B站接口：' + (j.message || j.code));
    bvid = j.data.bvid;
  }
  if (!bvid) throw new Error('没能从链接里认出 B 站视频号（BV 号）。请直接粘贴视频页地址，如 https://www.bilibili.com/video/BVxxxxxxxxxx');

  let view = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`), 'view');
  if (view.code === -412) {
    // 被反爬拦了：换一个新指纹再试一次
    view = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, null, true), 'view');
  }
  if (view.code !== 0) throw new Error('B站接口：' + (view.message || 'code ' + view.code));
  const d = view.data || {};

  // 分P：链接里的 ?p=N 决定优先解析哪一 P，其余 P 也一并列出
  const pages = Array.isArray(d.pages) && d.pages.length ? d.pages : [{ cid: d.cid, part: d.title, page: 1 }];
  const wantP = parseInt((shareUrl.match(/[?&]p=(\d+)/) || [])[1] || '1', 10);
  const ordered = pages.slice().sort((a, b) => (a.page === wantP ? -1 : b.page === wantP ? 1 : a.page - b.page));

  const videos = [];
  const slice = ordered.slice(0, 12);
  const results = await Promise.all(
    slice.map(async (pg) => {
      try {
        const pj = await bjson(
          await bfetch(
            `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${pg.cid}` +
              `&qn=80&fnval=0&platform=html5&high_quality=1`
          ),
          'playurl'
        );
        const durl = (pj.data && pj.data.durl) || [];
        if (!durl.length) return null;
        return {
          label: pages.length > 1 ? `P${pg.page} ${pg.part || ''}`.trim() : QUALITY_MAP[pj.data.quality] || '默认画质',
          quality: pj.data.quality,
          url: durl[0].url,
          size: durl[0].size || 0,
          duration: Math.round((durl[0].length || 0) / 1000),
        };
      } catch (_) {
        return null;
      }
    })
  );
  results.forEach((v) => v && videos.push(v));

  if (!videos.length) throw new Error('B站没有返回可下载的直链（可能是付费/大会员专享或已下架的视频）');

  return {
    platform: 'bilibili',
    platformLabel: '哔哩哔哩',
    title: d.title || '',
    cover: String(d.pic || '').replace(/^http:/, 'https:'),
    author: (d.owner && d.owner.name) || '',
    duration: d.duration || 0,
    videos,
    source: '内置接口',
  };
}

// ---------------------------------------------------------------------------
// 其它平台：走第三方聚合接口（可配置）
// ---------------------------------------------------------------------------
async function parseViaProvider(shareUrl, platform) {
  if (!VIDEO_PARSE_API) {
    const err = new Error(
      `${platformLabel(platform)} 需要配置解析接口：请在 Vercel 环境变量里设置 VIDEO_PARSE_API` +
        `（形如 https://你的服务商/api/parse?url={url}），再重新部署。B站视频无需配置即可解析。`
    );
    err.code = 'NEED_PROVIDER';
    throw err;
  }
  const target = VIDEO_PARSE_API.includes('{url}')
    ? VIDEO_PARSE_API.replace('{url}', encodeURIComponent(shareUrl))
    : VIDEO_PARSE_API + (VIDEO_PARSE_API.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(shareUrl);

  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (VIDEO_PARSE_KEY) headers.Authorization = 'Bearer ' + VIDEO_PARSE_KEY;

  const r = await fetch(target, { headers });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error('解析接口返回的不是 JSON：' + text.slice(0, 160));
  }

  let videoUrl = '';
  if (VIDEO_PARSE_FIELD) videoUrl = pick(json, VIDEO_PARSE_FIELD) || '';
  if (!videoUrl || typeof videoUrl !== 'string') videoUrl = findVideoUrl(json);

  if (!videoUrl) throw new Error('解析接口里没找到视频直链，请检查 VIDEO_PARSE_FIELD 配置或换个接口');

  const cover = pick(json, 'data.cover') || pick(json, 'cover') || pick(json, 'data.video.cover') || findCoverUrl(json) || '';
  const title = pick(json, 'data.title') || pick(json, 'title') || pick(json, 'data.desc') || '';
  const author = pick(json, 'data.author') || pick(json, 'author') || pick(json, 'data.nickname') || '';

  return {
    platform,
    platformLabel: platformLabel(platform),
    title: String(title || ''),
    cover: String(cover || ''),
    author: String(author || ''),
    duration: Number(pick(json, 'data.duration') || 0) || 0,
    videos: [{ label: '默认画质', quality: 0, url: videoUrl, size: 0, duration: 0 }],
    source: '第三方接口',
  };
}

function findCoverUrl(node, depth) {
  depth = depth || 0;
  if (depth > 6 || node == null) return '';
  if (typeof node === 'string') {
    return /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?|$)/i.test(node) ? node : '';
  }
  if (Array.isArray(node)) {
    for (const i of node) {
      const h = findCoverUrl(i, depth + 1);
      if (h) return h;
    }
    return '';
  }
  if (typeof node === 'object') {
    for (const k of ['cover', 'pic', 'poster', 'origin_cover', 'dynamic_cover', 'thumbnail']) {
      if (node[k]) {
        const h = findCoverUrl(node[k], depth + 1);
        if (h) return h;
      }
    }
    for (const k of Object.keys(node)) {
      const h = findCoverUrl(node[k], depth + 1);
      if (h) return h;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// 下载中转：补 Referer / UA，支持 Range
// ---------------------------------------------------------------------------
function refererFor(src, platformHint) {
  if (platformHint && REFERER_BY_PLATFORM[platformHint]) return REFERER_BY_PLATFORM[platformHint];
  const p = detectPlatform(src);
  return REFERER_BY_PLATFORM[p] || 'https://www.bilibili.com';
}

async function proxyStream(req, res, src, platformHint) {
  const headers = { 'User-Agent': UA, Referer: refererFor(src, platformHint), Accept: '*/*' };

  // 支持前端传来的 start/end 分片，也支持浏览器原生的 Range
  const start = req.query.start;
  const end = req.query.end;
  if (start != null && start !== '') {
    headers.Range = `bytes=${start}-${end != null && end !== '' ? end : ''}`;
  } else if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  const upstream = await fetch(src, { headers });
  res.statusCode = upstream.status;
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase()), v);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const q = req.method === 'POST' ? Object.assign({}, req.query, req.body || {}) : req.query || {};
    const mode = q.mode || 'parse';

    const ip = clientIp(req);
    if (rateLimited('video:' + ip, 60, 60 * 1000)) {
      return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });
    }

    // ---- 诊断（临时）：把各条上游请求的真实结果摊开，用于定位机房 IP 被拦的原因 ----
    if (mode === 'debug') {
      const probe = async (label, url, headers) => {
        try {
          const r = await fetch(url, { headers });
          const text = await r.text();
          return { label, status: r.status, ct: r.headers.get('content-type') || '', body: text.slice(0, 260) };
        } catch (e) {
          return { label, error: String((e && e.message) || e) };
        }
      };
      const bvid = 'BV1GJ411x7h7';
      const base = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' };
      const out = [];
      out.push(await probe('1.spi指纹', 'https://api.bilibili.com/x/frontend/finger/spi', Object.assign({}, base, { Referer: 'https://www.bilibili.com/' })));
      out.push(await probe('2.view-无cookie', `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, Object.assign({}, base, { Referer: 'https://www.bilibili.com/' })));
      const ck = await getBiliCookie(true);
      out.push({ label: '3.取得的cookie', value: String(ck).slice(0, 70) });
      out.push(await probe('4.view-带cookie', `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, Object.assign({}, base, { Referer: 'https://www.bilibili.com/', Cookie: ck })));
      out.push(await probe('5.view-无referer', `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, base));
      out.push(await probe('6.视频页HTML', `https://www.bilibili.com/video/${bvid}/`, { 'User-Agent': UA }));
      out.push(await probe('7.出口IP', 'https://api.ipify.org?format=json', base));
      return res.json({ ok: true, debug: out });
    }

    // ---- 下载中转 ----
    if (mode === 'stream') {
      const src = q.src;
      if (!src || !isSafeRemoteUrl(src)) return res.status(400).json({ ok: false, error: '非法的视频直链' });
      return proxyStream(req, res, src, q.platform);
    }

    // ---- 探测大小（供分片下载） ----
    if (mode === 'info') {
      const src = q.src;
      if (!src || !isSafeRemoteUrl(src)) return res.status(400).json({ ok: false, error: '非法的视频直链' });
      const r = await fetch(src, {
        headers: { 'User-Agent': UA, Referer: refererFor(src, q.platform), Range: 'bytes=0-0' },
      });
      const cr = r.headers.get('content-range') || '';
      const total = parseInt((cr.split('/')[1] || ''), 10);
      return res.json({
        ok: true,
        status: r.status,
        size: isNaN(total) ? 0 : total,
        type: r.headers.get('content-type') || 'video/mp4',
        acceptRanges: (r.headers.get('accept-ranges') || '').toLowerCase() === 'bytes',
      });
    }

    // ---- 解析分享链接 ----
    const shareUrl = String(q.url || '').trim();
    if (!shareUrl) return res.status(400).json({ ok: false, error: '请先粘贴视频链接' });
    if (!/^https?:\/\//i.test(shareUrl)) return res.status(400).json({ ok: false, error: '链接需要以 http(s):// 开头' });

    const platform = detectPlatform(shareUrl);
    let data;
    if (platform === 'bilibili') {
      try {
        data = await parseBilibili(shareUrl);
      } catch (e) {
        // 内置接口被反爬拦（-412）或接口变动时，若配了第三方接口就降级过去
        if (VIDEO_PARSE_API) data = await parseViaProvider(shareUrl, 'bilibili');
        else throw e;
      }
    } else {
      data = await parseViaProvider(shareUrl, platform); // 未知平台也交给配置的接口，或抛出明确提示
    }

    return res.json(Object.assign({ ok: true, shareUrl }, data));
  } catch (e) {
    console.error('[parse-video] error:', e && e.message);
    return res.status(e.code === 'NEED_PROVIDER' ? 501 : 500).json({
      ok: false,
      code: e.code || 'ERROR',
      error: e.message || '解析失败',
    });
  }
};
