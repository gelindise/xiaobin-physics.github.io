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
const crypto = require('crypto');

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
// WBI 签名
//   实测：机房 IP 对 x/web-interface/view 会返回 -412，但对
//   x/web-interface/wbi/view（带签名）、x/player/pagelist、x/player/playurl 都放行。
//   所以元数据改走签名版接口：先用 nav 拿 wbi_img，按固定置换表算出 mixinKey，
//   再把参数按字典序拼串 + mixinKey 做 MD5 得到 w_rid。
// ---------------------------------------------------------------------------
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

let _wbi = { key: '', at: 0 };
async function getWbiMixinKey() {
  const now = Date.now();
  if (_wbi.key && now - _wbi.at < 60 * 60 * 1000) return _wbi.key;
  const j = await bjson(await bfetch('https://api.bilibili.com/x/web-interface/nav'), 'nav');
  const img = j && j.data && j.data.wbi_img;
  if (!img || !img.img_url || !img.sub_url) throw new Error('拿不到 WBI 密钥');
  const base = (u) => String(u).split('/').pop().split('.')[0];
  const orig = base(img.img_url) + base(img.sub_url);
  const key = MIXIN_KEY_ENC_TAB.map((i) => orig[i]).join('').slice(0, 32);
  _wbi = { key, at: now };
  return key;
}

function wbiSign(params, mixinKey) {
  const p = Object.assign({}, params, { wts: Math.round(Date.now() / 1000) });
  const query = Object.keys(p)
    .sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]).replace(/[!'()*]/g, '')))
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return query + '&w_rid=' + w_rid;
}

// 带 WBI 签名的视频信息接口（机房 IP 可用）
async function biliWbiView(params) {
  const qs = wbiSign(params, await getWbiMixinKey());
  return bjson(await bfetch(`https://api.bilibili.com/x/web-interface/wbi/view?${qs}`), 'wbi/view');
}

// ---------------------------------------------------------------------------
// 哔哩哔哩：内置官方接口解析（无需配置）
// ---------------------------------------------------------------------------
const QUALITY_MAP = { 127: '8K', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 64: '720P', 32: '480P', 16: '360P' };

// 元数据（标题/封面/作者/时长）：三条路依次降级。
//   实测：机房 IP 下 x/web-interface/view 返回 -412、wbi/view 返回 -404（风控），
//   只有 pagelist / playurl 放行。元数据失败后不再反复硬刷（越刷风控越差），
//   10 分钟内直接跳过，由 pagelist 兜底（能拿到标题与时长，缺封面与作者）。
let _metaBlockedUntil = 0;
async function biliMeta(bvid) {
  if (Date.now() < _metaBlockedUntil) return null;
  try {
    const v = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`), 'view');
    if (v.code === 0 && v.data) return v.data;
  } catch (_) {}
  try {
    const v = await biliWbiView({ bvid });
    if (v.code === 0 && v.data) return v.data;
  } catch (_) {}
  try {
    // 搜索接口兜底：按 BV 号搜到自己，可拿回标题 / 封面 / 作者 / 时长
    const qs = wbiSign({ search_type: 'video', keyword: bvid, page: 1 }, await getWbiMixinKey());
    const s = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`), 'search');
    const list = (s && s.data && s.data.result) || [];
    const hit = list.find((x) => x && x.bvid === bvid) || list[0];
    if (hit) {
      let pic = String(hit.pic || '');
      if (pic.indexOf('//') === 0) pic = 'https:' + pic;
      return {
        title: String(hit.title || '').replace(/<[^>]+>/g, ''),
        pic,
        owner: { name: hit.author || '' },
        duration: hit.duration || 0,
      };
    }
  } catch (_) {}
  _metaBlockedUntil = Date.now() + 10 * 60 * 1000;
  return null;
}

async function parseBilibili(shareUrl) {
  let bvid = (shareUrl.match(/BV[0-9A-Za-z]{10}/) || [])[0] || '';
  const aid = (shareUrl.match(/\/av(\d+)/i) || [])[1] || '';

  if (!bvid && aid) {
    let j = null;
    try {
      j = await biliWbiView({ aid });
    } catch (_) {}
    if (!j || j.code !== 0 || !j.data) {
      j = await bjson(await bfetch(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`), 'view/aid');
    }
    if (j.code !== 0 || !j.data) throw new Error('B站接口：' + (j.message || j.code));
    bvid = j.data.bvid;
  }
  if (!bvid) throw new Error('没能从链接里认出 B 站视频号（BV 号）。请直接粘贴视频页地址，如 https://www.bilibili.com/video/BVxxxxxxxxxx');

  // 元数据（可能为 null，此时用 pagelist 兜底）
  const meta = await biliMeta(bvid);

  // 分P：优先用元数据里的 pages；拿不到就单独查 pagelist（该接口在机房 IP 下正常）
  let pages = meta && Array.isArray(meta.pages) && meta.pages.length ? meta.pages : null;
  if (!pages) {
    const pl = await bjson(await bfetch(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`), 'pagelist');
    if (pl.code === 0 && Array.isArray(pl.data) && pl.data.length) {
      pages = pl.data.map((p) => ({ cid: p.cid, part: p.part, page: p.page, duration: p.duration }));
    }
  }
  if ((!pages || !pages.length) && meta && meta.cid) pages = [{ cid: meta.cid, part: meta.title, page: 1 }];
  if (!pages || !pages.length) throw new Error('拿不到该视频的分P信息，请确认链接指向的是视频页');
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
    title: (meta && meta.title) || (pages[0] && pages[0].part) || '',
    cover: String((meta && meta.pic) || '').replace(/^http:/, 'https:'),
    author: (meta && meta.owner && meta.owner.name) || '',
    duration: (meta && meta.duration) || (pages[0] && pages[0].duration) || 0,
    videos,
    source: meta ? '内置接口' : '内置接口（元数据降级）',
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
  const headers = {
    'User-Agent': UA,
    Referer: refererFor(src, platformHint),
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };

  // 支持前端传来的 start/end 分片，也支持浏览器原生的 Range
  const start = req.query && req.query.start;
  const end = req.query && req.query.end;
  if (start != null && start !== '') {
    headers.Range = `bytes=${start}-${end != null && end !== '' ? end : ''}`;
  } else if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  const upstream = await fetch(src, { headers });
  res.statusCode = upstream.status;
  res.setHeader('X-Dbg-Range', String(headers.Range || 'none'));
  res.setHeader('X-Dbg-Start', String(start));
  res.setHeader('X-Dbg-Up', String(upstream.status));
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
