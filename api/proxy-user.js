// Vercel 无服务器函数 - 用户操作代理（服务端执行，避免客户端直接暴露查询）
//
// ============ 安全模型（2026-10 安全整改） ============
//   · 【公开接口】PUBLIC_ACTIONS：只暴露登录 / 注册 / 查本人信息 / 兑换激活码所需的最小能力
//   · 【管理接口】ADMIN_ACTIONS：必须携带 x-admin-token，令牌比对的是【服务端保存】的口令哈希
//     —— 口令来源优先级：数据库 app_settings.admin_password（PBKDF2 哈希）
//        → 环境变量 ADMIN_PASSWORD（明文，兜底）→ 都没有则拒绝（fail-closed）
//   · 【白名单】不在两个名单里的 action 一律 400 —— 防止将来新增接口时被默认暴露
//   · 管理口令【不再】写在前端源码里；admin.html 只负责把口令交给本接口校验
//   · 注册时忽略客户端传来的 vip / expire —— 否则可以自己给自己开永久 VIP
//   · 激活码兑换走服务端 redeemCode（原子占用），前端不再直接改 users / activation_codes
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const crypto = require('crypto');

// 公开接口能看到的字段（不含 email / authCode / password / session_token）
var PUBLIC_FIELDS = 'username,vip,expire,created_at';
var ADMIN_SETTINGS_TABLE = 'app_settings';
var ADMIN_PASSWORD_KEY = 'admin_password';

var PUBLIC_ACTIONS = [
  'login', 'createUser', 'getUserPublic', 'checkSession', 'logout',
  'dropOtherSessions',
  'findByEmail', 'redeemCode', 'resetPasswordByCode', 'verifyAdmin',
];
var ADMIN_ACTIONS = [
  'getUser', 'getUsers', 'updateUser', 'updateVIP', 'deleteUser',
  'getSessions', 'kickSession',
  'getActivationCode', 'getAllActivationCodes', 'createActivationCodes',
  'deleteActivationCode', 'updateActivationCode', 'getAdminStats', 'setAdminPassword',
];

// ========== 密码处理 ==========
function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') === -1) {
    // 旧版明文密码（兼容迁移：登录成功时会自动哈希化）
    return stored === password;
  }
  var parts = stored.split(':');
  var salt = parts[0];
  var hash = parts[1];
  var verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verifyHash));
  } catch (e) {
    return false;
  }
}

function generateSessionToken() {
  return 'sess_' + crypto.randomBytes(24).toString('hex');
}

function vipExpire(vipType) {
  var now = new Date();
  if (vipType === '月度VIP') { now.setDate(now.getDate() + 30); return now.toISOString().split('T')[0]; }
  if (vipType === '年度VIP') { now.setDate(now.getDate() + 365); return now.toISOString().split('T')[0]; }
  return '永久';
}

// ========== Supabase 服务端访问 ==========
function svcHeaders(extra) {
  var h = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  };
  if (extra) { for (var k in extra) h[k] = extra[k]; }
  return h;
}
function sbFetch(path, opts) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, opts || {});
}
// PostgREST 单次请求默认最多返回 1000 行，直接数返回数组长度会在 1000 处封顶。
// 需要真实总数时用 count=exact，从响应的 Content-Range（形如 0-0/1234）里取总数。
// 空结果集时 PostgREST 会回 416 + "Content-Range: */0"，同样从这里取到 0；
// 真出错（无 Content-Range）返回 null，由调用方决定如何提示，不要伪装成 0。
async function sbCount(path) {
  var r = await sbFetch(path, { headers: svcHeaders({ Prefer: 'count=exact', Range: '0-0' }) });
  var cr = r.headers.get('content-range') || '';
  var n = parseInt(cr.split('/')[1], 10);
  return isNaN(n) ? null : n;
}

// ========== 管理员口令 ==========
var _adminHashCache = { value: undefined, at: 0 };
async function getAdminHash(force) {
  var now = Date.now();
  if (!force && _adminHashCache.at && (now - _adminHashCache.at) < 30000) return _adminHashCache.value;
  var value = null;
  try {
    var r = await sbFetch(ADMIN_SETTINGS_TABLE + '?key=eq.' + ADMIN_PASSWORD_KEY + '&select=value', {
      headers: svcHeaders({ Prefer: undefined }),
    });
    if (r.ok) {
      var d = await r.json();
      if (d && d[0] && d[0].value) value = d[0].value;
    }
  } catch (_) {}
  if (!value && process.env.ADMIN_PASSWORD) value = 'plain:' + process.env.ADMIN_PASSWORD;
  _adminHashCache = { value: value, at: now };
  return value;
}

function adminTokenOk(token, stored) {
  if (!stored || !token) return false;
  if (stored.indexOf('plain:') === 0) {
    var expect = stored.slice(6);
    if (expect.length !== token.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(token)); } catch (e) { return false; }
  }
  return verifyPassword(token, stored);
}

// ========== 轻量限频（按实例内存，够挡住脚本扫号/撞码） ==========
var _hits = new Map();
function rateLimited(key, limit, windowMs) {
  var now = Date.now();
  if (_hits.size > 5000) _hits.clear();
  var rec = _hits.get(key);
  if (!rec || (now - rec.at) > windowMs) { _hits.set(key, { at: now, n: 1 }); return false; }
  rec.n++;
  return rec.n > limit;
}
function clientIp(req) {
  var h = req.headers || {};
  // 🔴 EdgeOne 在最前面：线上链路是 用户 → EdgeOne → Vercel，
  //    到 Vercel 时 x-forwarded-for 的首段未必是真实客户端（可能是 EdgeOne 节点），
  //    而 EO-Connecting-IP 是 EdgeOne 认定的客户端地址，优先级最高。
  //    都没有时才退到 x-forwarded-for / x-real-ip（直连 Vercel 或本地调试）。
  var raw = h['eo-connecting-ip'] || h['x-forwarded-for'] || h['x-real-ip'] || 'unknown';
  return String(raw).split(',')[0].trim();
}

// ============ 多设备会话（终身会员：同城 5 个 IP 同时在线） ============
//  模型：
//   · 每次登录在 user_sessions 里落一行（token 为主键），checkSession 只认表里的 token
//   · 普通/月度/年度会员：limit = 1 —— 新登录把旧会话全部清掉（与改版前「单设备」一致）
//   · 终身VIP：limit = 5 个【不同 IP】。同城可并存；第 6 个 IP 登录时自动挤掉
//     「最久没活动」的那一个（按 last_seen 最旧），不打断其它设备
//   · 异地（新 IP 的城市与在线设备不同）→ 允许登录，但把原城市的设备全部下线（换城）
//   · 城市查不到（第三方接口抖动 / 内网 IP）→ 一律按「同城」处理。
//     宁可少踢一次，也不能因为接口抖动把正在上课的老师集体踢下线。
var SESSION_TTL_MS = 12 * 3600 * 1000;   // 会话闲置 12 小时自动失效
var MULTI_IP_LIMIT = 5;                  // 终身会员同城最多 5 个 IP 同时在线
var LIFETIME_VIP = '终身VIP';

function isLifetime(u) {
  if (!u) return false;
  var vip = String(u.vip || '');
  var exp = String(u.expire || '');
  return vip === LIFETIME_VIP || exp === '永久';
}

function maskIp(ip) {
  var s = String(ip || '');
  if (!s || s === 'unknown') return '未知';
  if (s.indexOf(':') !== -1) return s.split(':').slice(0, 3).join(':') + '::…';
  var p = s.split('.');
  return p.length === 4 ? p[0] + '.' + p[1] + '.*.*' : s;
}

function uniqIp(rows) {
  var out = [];
  (rows || []).forEach(function (x) {
    if (x && x.ip && out.indexOf(x.ip) === -1) out.push(x.ip);
  });
  return out;
}

// checkSession 的「重活」节流：每台设备 5 分钟才统计一次在线 IP / 同步 users.last_seen。
// 按实例内存记，多实例时实际频率会高一些，但都远低于「每 30 秒一次」。
var _heavyAt = new Map();
function heavyDue(token) {
  var now = Date.now();
  var last = _heavyAt.get(token) || 0;
  if (now - last < 5 * 60 * 1000) return false;
  if (_heavyAt.size > 5000) _heavyAt.clear();
  _heavyAt.set(token, now);
  return true;
}

// —— IP → 城市（带进程内缓存，避免每次登录都打第三方）——
var _geoCache = new Map();
var _geoDownUntil = 0;
var GEO_TTL_MS = 12 * 3600 * 1000;

function normCity(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_.·]/g, '').replace(/(市|省|自治区|特别行政区|地区)$/, '');
}

function fetchJson(url, ms) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
  return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { 'User-Agent': 'xiaobin-physics/1.0' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (d) { clearTimeout(timer); return d; });
}

async function geoOf(ip) {
  if (!ip || ip === 'unknown') return { key: '', label: '', weak: true };
  var hit = _geoCache.get(ip);
  if (hit && (Date.now() - hit.at) < GEO_TTL_MS) return hit.value;

  var value = null;
  // 主：ip-api.com（45 次/分，免费版只走 http）。城市名稳定，同城判定就靠它。
  if (Date.now() > _geoDownUntil) {
    var d1 = await fetchJson('http://ip-api.com/json/' + encodeURIComponent(ip) + '?lang=zh-CN&fields=status,country,regionName,city', 1800);
    if (d1 && d1.status === 'success') {
      var c1 = d1.city || d1.regionName || d1.country || '';
      value = { key: normCity(c1), label: String(c1 || ''), weak: false };
    } else if (d1 && d1.status === 'fail' && /quota|limit|reserved|private/i.test(String(d1.message || ''))) {
      _geoDownUntil = Date.now() + 60000;   // 被限频就歇一分钟，别把登录拖慢
    }
  }
  // 备：ipapi.co（https）。城市名可能是英文，所以标记 weak —— 只用于显示，不用于踢人
  if (!value) {
    var d2 = await fetchJson('https://ipapi.co/' + encodeURIComponent(ip) + '/json/', 1800);
    if (d2 && d2.city) value = { key: normCity(d2.city), label: String(d2.city), weak: true };
  }
  if (!value) value = { key: '', label: '', weak: true };

  if (_geoCache.size > 3000) _geoCache.clear();
  _geoCache.set(ip, { at: Date.now(), value: value });
  return value;
}

// —— user_sessions 读写 ——
// 返回 null = 表不可用（还没执行 SQL / 数据库异常）⇒ 调用方降级为旧的单设备模式，
// 绝不能因为新表没建就让所有人都登不进来。
async function loadSessions(username) {
  var r = await sbFetch('user_sessions?username=eq.' + encodeURIComponent(username) +
    '&select=token,ip,city_key,city_label,city_weak,ua,created_at,last_seen&order=last_seen.asc',
    { headers: svcHeaders({ Prefer: undefined }) });
  if (!r.ok) return null;
  var rows = await r.json();
  var now = Date.now();
  var live = [];
  var stale = false;
  (rows || []).forEach(function (x) {
    var t = x.last_seen ? new Date(x.last_seen).getTime() : 0;
    if (now - t < SESSION_TTL_MS) live.push(x); else stale = true;
  });
  if (stale) pruneSessions(username);
  return live;
}

function pruneSessions(username) {
  var cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  sbFetch('user_sessions?username=eq.' + encodeURIComponent(username) + '&last_seen=lt.' + encodeURIComponent(cutoff), {
    method: 'DELETE', headers: svcHeaders({ Prefer: 'return=minimal' }),
  }).catch(function () {});
}

// 清空该账号全部会话。顺手把 users.session_token 置空 —— 否则旧 token 会通过
// checkSession 的「改版前旧 token 迁移」分支被复活，等于踢了又没踢。
async function clearSessions(username) {
  var n = 0;
  try {
    var r = await sbFetch('user_sessions?username=eq.' + encodeURIComponent(username), {
      method: 'DELETE', headers: svcHeaders({ Prefer: 'return=representation' }),
    });
    if (r.ok) { var d = await r.json(); n = Array.isArray(d) ? d.length : 0; }
    await sbFetch('users?username=eq.' + encodeURIComponent(username), {
      method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ session_token: null }),
    });
  } catch (_) {}
  return n;
}

async function deleteSession(username, token) {
  var ok = false;
  try {
    var r = await sbFetch('user_sessions?token=eq.' + encodeURIComponent(token) + '&username=eq.' + encodeURIComponent(username), {
      method: 'DELETE', headers: svcHeaders({ Prefer: 'return=minimal' }),
    });
    ok = r.ok;
    await sbFetch('users?username=eq.' + encodeURIComponent(username) + '&session_token=eq.' + encodeURIComponent(token), {
      method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ session_token: null }),
    });
  } catch (_) {}
  return ok;
}
function readToken(req) {
  var h = req.headers || {};
  return String(h['x-admin-token'] || h['X-Admin-Token'] || (req.body && req.body.adminToken) || '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.method === 'GET' ? req.query.action : (req.body && req.body.action);
    if (!action) return res.status(400).json({ error: '缺少 action 参数' });

    // ---------- 白名单 + 管理鉴权 ----------
    var isAdminAction = ADMIN_ACTIONS.indexOf(action) !== -1;
    if (!isAdminAction && PUBLIC_ACTIONS.indexOf(action) === -1) {
      return res.status(400).json({ error: '未知 action: ' + action });
    }
    if (isAdminAction) {
      var stored = await getAdminHash();
      if (!stored) {
        return res.status(503).json({
          error: '服务端尚未配置管理员密码。二选一：① 执行 outputs/security-hardening.sql 建 app_settings 表（推荐，同时会关闭激活码与用户列表的匿名可读）；② 在 Vercel 设置环境变量 ADMIN_PASSWORD 后重新部署（无需建表）',
        });
      }
      if (!adminTokenOk(readToken(req), stored)) {
        return res.status(401).json({ error: '管理员身份校验失败，请重新登录后台' });
      }
    }

    // ========== 校验管理员口令（后台登录用） ==========
    if (action === 'verifyAdmin') {
      var s = await getAdminHash();
      if (!s) {
        return res.status(503).json({
          error: '服务端尚未配置管理员密码。二选一：① 执行 outputs/security-hardening.sql 建 app_settings 表（推荐，同时会关闭激活码与用户列表的匿名可读）；② 在 Vercel 设置环境变量 ADMIN_PASSWORD 后重新部署（无需建表）',
        });
      }
      if (!adminTokenOk(readToken(req), s)) {
        return res.status(401).json({ error: '密码错误' });
      }
      return res.json({ success: true });
    }

    // ========== 修改管理员口令（需要当前口令） ==========
    if (action === 'setAdminPassword') {
      var np = req.body && req.body.newPassword;
      if (!np || String(np).length < 6) return res.status(400).json({ error: '新密码至少需要 6 位' });
      var newHash = hashPassword(String(np));
      var w = await sbFetch(ADMIN_SETTINGS_TABLE, {
        method: 'POST',
        headers: svcHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ key: ADMIN_PASSWORD_KEY, value: newHash, updated_at: new Date().toISOString() }),
      });
      if (!w.ok) return res.status(502).json({ error: '保存失败: ' + (await w.text()) });
      _adminHashCache = { value: newHash, at: Date.now() };
      return res.json({ success: true });
    }

    // ========== 查询单个用户（含敏感字段，仅管理员使用） ==========
    if (action === 'getUser') {
      const username = req.method === 'GET' ? req.query.username : (req.body && req.body.username);
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = 'users?username=eq.' + encodeURIComponent(username) + '&select=*';
      const r = await sbFetch(url, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: data[0] || null });
    }

    // ========== 获取所有用户（仅管理员；不返回密码哈希与令牌） ==========
    if (action === 'getUsers') {
      const url = 'users?select=username,vip,expire,email,created_at,last_seen&order=username.asc';
      const r = await sbFetch(url, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, users: data });
    }

    // ========== 获取用户公开信息（不含邮箱/密码/令牌，前端使用） ==========
    if (action === 'getUserPublic') {
      const username = (req.body && req.body.username) || req.query.username;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = 'users?username=eq.' + encodeURIComponent(username) + '&select=' + PUBLIC_FIELDS;
      const r = await sbFetch(url, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: data[0] || null });
    }

    // ========== 按邮箱查找账号（找回密码用，只返回用户名） ==========
    if (action === 'findByEmail') {
      const email = req.body && req.body.email;
      if (!email) return res.status(400).json({ error: '缺少 email' });
      const ip = clientIp(req);
      if (rateLimited('findByEmail:' + ip, 20, 10 * 60 * 1000)) {
        return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
      }
      const url = 'users?email=eq.' + encodeURIComponent(email) + '&select=username';
      const r = await sbFetch(url, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, users: data || [] });
    }

    // ========== 创建用户（服务端密码哈希；忽略客户端传来的 vip/expire） ==========
    if (action === 'createUser') {
      const ip = clientIp(req);
      if (rateLimited('createUser:' + ip, 15, 60 * 60 * 1000)) {
        return res.status(429).json({ error: '注册过于频繁，请稍后再试' });
      }
      const body = (req.body && req.body.data) || req.body || {};
      var username = body.username;
      var password = body.password;
      var email = body.email || '';
      if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });
      var url = 'users';
      var r = await sbFetch(url, {
        method: 'POST',
        headers: svcHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          username: username,
          password: hashPassword(password),
          email: email,
          // 🔴 固定为普通用户：绝不能采用客户端传来的 vip / expire
          vip: '普通用户',
          expire: '',
          last_seen: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        var text = await r.text();
        if (text.indexOf('duplicate') !== -1 || text.indexOf('23505') !== -1) {
          return res.status(409).json({ error: '用户名已存在' });
        }
        return res.status(502).json({ error: '创建失败: ' + text });
      }
      var data = await r.json();
      // 返回不含密码的用户信息
      var user = Array.isArray(data) ? data[0] : data;
      if (user) { delete user.password; delete user.session_token; }
      return res.json({ success: true, user: user });
    }

    // ========== 登录（服务端验证密码 + 生成 session_token） ==========
    if (action === 'login') {
      var ip2 = clientIp(req);
      if (rateLimited('login:' + ip2, 30, 10 * 60 * 1000)) {
        return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
      }
      var loginName = req.body && req.body.username;
      var loginPwd = req.body && req.body.password;
      if (!loginName || !loginPwd) return res.status(400).json({ error: '缺少 username 或 password' });

      var url2 = 'users?username=eq.' + encodeURIComponent(loginName) + '&select=*';
      var r2 = await sbFetch(url2, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r2.ok) return res.status(502).json({ error: '查询失败: ' + (await r2.text()) });
      var data2 = await r2.json();
      var userData = data2 && data2[0] ? data2[0] : null;

      if (!userData) {
        return res.status(401).json({ error: '用户不存在' });
      }

      if (!verifyPassword(loginPwd, userData.password)) {
        return res.status(401).json({ error: '密码错误' });
      }

      // 兼容迁移：如果旧版明文密码，验证通过后哈希化并更新
      var storedPwd = userData.password || '';
      if (storedPwd.indexOf(':') === -1) {
        console.log('[proxy-user] migrating plaintext password for:', loginName);
        var hashed = hashPassword(loginPwd);
        await sbFetch('users?username=eq.' + encodeURIComponent(loginName), {
          method: 'PATCH',
          headers: svcHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ password: hashed }),
        });
      }

      // ===== 会话判定：IP 归属地 + 现有在线设备，两个查询并行 =====
      var pair = await Promise.all([geoOf(ip2), loadSessions(loginName)]);
      var city = pair[0];
      var sessions = pair[1];
      var degraded = (sessions === null);   // 表不可用 → 旧单设备模式
      if (degraded) sessions = [];

      var lifetime = isLifetime(userData);
      var limit = lifetime ? MULTI_IP_LIMIT : 1;
      var kicked = 0;        // 被下线的旧会话数
      var evicted = null;    // 被挤掉的那台（第 6 个 IP 登录时）

      if (!degraded && limit === 1) {
        // 非终身会员：单设备，新登录把旧会话全部清掉（与改版前一致）
        if (sessions.length) kicked = await clearSessions(loginName);
        sessions = [];
      } else if (!degraded) {
        // ① 异地判定：在线设备的城市（只认强结果）与本次登录城市不同 ⇒ 换城
        var strongCities = [];
        sessions.forEach(function (s) {
          if (s.city_key && !s.city_weak && strongCities.indexOf(s.city_key) === -1) strongCities.push(s.city_key);
        });
        if (city.key && !city.weak && strongCities.length === 1 && strongCities[0] !== city.key) {
          kicked = await clearSessions(loginName);   // 原城市的设备全部下线
          sessions = [];
        }

        // ② 同城 IP 数上限：满 5 个再来第 6 个 IP ⇒ 挤掉「最久没活动」的那台
        //    （用 while 而不是 if：万一历史上积了 6、7 个 IP，一次登录也要收敛到 5 个）
        var guard = 0;
        while (guard++ < 10) {
          var ipList = uniqIp(sessions);
          if (ipList.indexOf(ip2) !== -1 || ipList.length < limit) break;
          // 同一 IP 下有多台设备时整组一起淘汰，保证 IP 数真的降下来
          var victimIp = ipList[0];
          var victims = sessions.filter(function (s) { return s.ip === victimIp; });
          for (var vi = 0; vi < victims.length; vi++) {
            await deleteSession(loginName, victims[vi].token);
            kicked++;
          }
          evicted = { ip: maskIp(victimIp), lastSeen: victims.length ? victims[0].last_seen : '' };
          sessions = sessions.filter(function (s) { return s.ip !== victimIp; });
        }
      }

      // ===== 落库：新会话 =====
      var sessionToken = generateSessionToken();
      var nowIso = new Date().toISOString();
      if (!degraded) {
        var ins = await sbFetch('user_sessions', {
          method: 'POST',
          headers: svcHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({
            token: sessionToken,
            username: loginName,
            ip: ip2,
            city_key: city.key || '',
            city_label: city.label || '',
            city_weak: !!city.weak,
            ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 200),
            created_at: nowIso,
            last_seen: nowIso,
          }),
        });
        if (!ins.ok) {
          // 插入失败（多半是表结构不匹配）→ 降级，宁可退回单设备也不能让人登不进来
          console.warn('[proxy-user] user_sessions 写入失败，本次降级为单设备:', await ins.text());
          degraded = true;
        }
      }

      await sbFetch('users?username=eq.' + encodeURIComponent(loginName), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ session_token: sessionToken, last_seen: nowIso }),
      });

      var ipCount = 1;
      if (!degraded) {
        ipCount = uniqIp(sessions.concat([{ ip: ip2 }])).length;
      }

      return res.json({
        success: true,
        token: sessionToken,
        user: {
          username: userData.username,
          vip: userData.vip || '普通用户',
          expire: userData.expire || '',
          email: userData.email || '',
        },
        session: {
          limit: limit,
          ipCount: ipCount,
          ip: maskIp(ip2),
          city: city.label || '',
          multi: limit > 1,
          degraded: degraded,
          kicked: kicked,
          evicted: evicted,
        },
      });
    }

    // ========== 退出登录 ==========
    if (action === 'logout') {
      var logoutName = req.body && req.body.username;
      var logoutToken = req.body && req.body.token;
      if (!logoutName) return res.status(400).json({ error: '缺少 username' });
      if (logoutToken) {
        // 多设备下只能退自己那一台，不能把别的设备一起退掉
        await deleteSession(logoutName, logoutToken);
      } else {
        await clearSessions(logoutName);   // 旧客户端不带 token → 保持原来的「全退」语义
      }
      return res.json({ success: true });
    }

    // ========== 校验会话（顺带刷新在线时间） ==========
    if (action === 'checkSession') {
      var csName = req.body && req.body.username;
      var csToken = req.body && req.body.token;
      if (!csName || !csToken) return res.status(400).json({ error: '缺少 username 或 token' });

      var sr = await sbFetch('user_sessions?token=eq.' + encodeURIComponent(csToken) +
        '&username=eq.' + encodeURIComponent(csName) +
        '&select=token,ip,city_key,city_label,city_weak,last_seen', { headers: svcHeaders({ Prefer: undefined }) });

      if (sr.ok) {
        var rows = await sr.json();
        if (rows && rows.length) {
          var me = rows[0];
          var age = me.last_seen ? (Date.now() - new Date(me.last_seen).getTime()) : 0;
          if (age > SESSION_TTL_MS) {
            await deleteSession(csName, csToken);
            return res.json({ valid: false, reason: 'expired' });
          }
          // 心跳每 30 秒一次：只写本会话的 last_seen（1 次写）。
          // 「统计在线 IP 数 + 同步 users.last_seen + 查 VIP」每 5 分钟才做一次 ——
          // 否则 5 台设备 = 每分钟 20 次多余查询，白烧 Supabase 配额。
          try {
            await sbFetch('user_sessions?token=eq.' + encodeURIComponent(csToken), {
              method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }),
              body: JSON.stringify({ last_seen: new Date().toISOString() }),
            });
          } catch (_) {}
          if (!heavyDue(csToken)) return res.json({ valid: true });

          var liveRes = await sbFetch('user_sessions?username=eq.' + encodeURIComponent(csName) + '&select=ip,last_seen', {
            headers: svcHeaders({ Prefer: undefined }),
          });
          var liveRows = liveRes.ok ? await liveRes.json() : [];
          var nowMs = Date.now();
          var ips = [];
          (liveRows || []).forEach(function (x) {
            var t = x.last_seen ? new Date(x.last_seen).getTime() : 0;
            if (nowMs - t < SESSION_TTL_MS && x.ip && ips.indexOf(x.ip) === -1) ips.push(x.ip);
          });
          var nowIso2 = new Date().toISOString();
          try {
            await sbFetch('users?username=eq.' + encodeURIComponent(csName), {
              method: 'PATCH', headers: svcHeaders({ Prefer: 'return=minimal' }),
              body: JSON.stringify({ last_seen: nowIso2 }),
            });
          } catch (_) {}
          var ur0 = await sbFetch('users?username=eq.' + encodeURIComponent(csName) + '&select=vip,expire', { headers: svcHeaders({ Prefer: undefined }) });
          var uu0 = ur0.ok ? await ur0.json() : [];
          var life0 = isLifetime(uu0 && uu0[0]);
          return res.json({
            valid: true,
            session: {
              limit: life0 ? MULTI_IP_LIMIT : 1,
              ipCount: ips.length,
              ip: maskIp(me.ip),
              city: me.city_label || '',
              multi: life0,
            },
          });
        }

        // token 不在表里：可能是改版前登录的旧 token。
        // 只在 users.session_token 正好等于它时才认（说明它仍是「最后一台」），
        // 认完立刻补一行正式会话 —— 否则老用户全部要重新登录一次。
        var lur = await sbFetch('users?username=eq.' + encodeURIComponent(csName) + '&select=session_token', {
          headers: svcHeaders({ Prefer: undefined }),
        });
        var luRows = lur.ok ? await lur.json() : [];
        var legacyToken = luRows && luRows[0] ? luRows[0].session_token : null;
        if (legacyToken && legacyToken === csToken) {
          var lip = clientIp(req);
          var lcity = await geoOf(lip);
          var lnow = new Date().toISOString();
          await sbFetch('user_sessions', {
            method: 'POST',
            headers: svcHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({
              token: csToken, username: csName, ip: lip,
              city_key: lcity.key || '', city_label: lcity.label || '', city_weak: !!lcity.weak,
              ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 200),
              created_at: lnow, last_seen: lnow,
            }),
          });
          return res.json({ valid: true, migrated: true });
        }
        return res.json({ valid: false, reason: 'kicked' });
      }

      // 表不可用 → 退回旧的单值 token 校验（保证降级期间不掉线）
      var url3 = 'users?username=eq.' + encodeURIComponent(csName) + '&select=session_token';
      var r3 = await sbFetch(url3, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r3.ok) return res.status(502).json({ error: '查询失败: ' + (await r3.text()) });
      var data3 = await r3.json();
      var serverToken = data3 && data3[0] ? data3[0].session_token : null;
      if (serverToken && serverToken !== csToken) {
        return res.json({ valid: false, reason: 'kicked' });
      }
      if (serverToken && serverToken === csToken) {
        try {
          await sbFetch('users?username=eq.' + encodeURIComponent(csName), {
            method: 'PATCH',
            headers: svcHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ last_seen: new Date().toISOString() }),
          });
        } catch (_) {}
      }
      return res.json({ valid: true, degraded: true });
    }

    // ========== 下线本账号其它设备（本人自助，需持有有效 token） ==========
    if (action === 'dropOtherSessions') {
      var doName = req.body && req.body.username;
      var doToken = req.body && req.body.token;
      if (!doName || !doToken) return res.status(400).json({ error: '缺少 username 或 token' });
      var dchk = await sbFetch('user_sessions?token=eq.' + encodeURIComponent(doToken) + '&username=eq.' + encodeURIComponent(doName) + '&select=token', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      var dRows = dchk.ok ? await dchk.json() : [];
      if (!dRows || !dRows.length) return res.status(401).json({ error: '当前会话已失效，请重新登录' });
      var del = await sbFetch('user_sessions?username=eq.' + encodeURIComponent(doName) + '&token=neq.' + encodeURIComponent(doToken), {
        method: 'DELETE', headers: svcHeaders({ Prefer: 'return=representation' }),
      });
      var delRows = del.ok ? await del.json() : [];
      return res.json({ success: true, dropped: Array.isArray(delRows) ? delRows.length : 0 });
    }

    // ========== 兑换激活码（服务端原子占用；取代前端直接改表） ==========
    if (action === 'redeemCode') {
      var rip = clientIp(req);
      if (rateLimited('redeem:' + rip, 12, 10 * 60 * 1000)) {
        return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
      }
      var rcName = String((req.body && req.body.username) || '').trim();
      var rcCode = String((req.body && req.body.code) || '').trim().toUpperCase().replace(/[\s-]/g, '');
      var rcType = String((req.body && req.body.vipType) || '').trim();
      if (!rcName || !rcCode) return res.status(400).json({ error: '缺少 username 或 code' });

      // 1) 用户必须存在
      var uRes = await sbFetch('users?username=eq.' + encodeURIComponent(rcName) + '&select=*', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      if (!uRes.ok) return res.status(502).json({ error: '查询用户失败' });
      var uRows = await uRes.json();
      if (!uRows || !uRows.length) return res.status(404).json({ error: '用户不存在，请先注册账号' });
      var uRow = uRows[0];

      // 2) 新机制：activation_codes
      var cRes = await sbFetch('activation_codes?code=eq.' + encodeURIComponent(rcCode) + '&select=*', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      var cRows = cRes.ok ? await cRes.json() : [];
      var vipType = null;

      if (cRows && cRows.length) {
        var rec = cRows[0];
        if (rec.status !== 'unused') {
          return res.status(409).json({ error: '此激活码已被使用' });
        }
        vipType = rec.vip_type;
        if (rcType && rcType !== vipType) {
          return res.status(409).json({ error: '此激活码是「' + vipType + '」专用，与所选套餐不匹配' });
        }
        // 原子占用：只有 status 仍为 unused 时才会被改到，拿不到行说明被别人抢先
        var claim = await sbFetch('activation_codes?code=eq.' + encodeURIComponent(rcCode) + '&status=eq.unused', {
          method: 'PATCH',
          headers: svcHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ status: 'used', used_by: rcName, used_at: new Date().toISOString() }),
        });
        var claimed = claim.ok ? await claim.json() : [];
        if (!claimed || !claimed.length) {
          return res.status(409).json({ error: '此激活码刚刚被使用，请换一个' });
        }
      } else {
        // 3) 兼容旧数据：users.authCode（该列若不存在则自然走到「激活码无效」）
        var legacy = String(uRow.authCode || '').trim().toUpperCase().replace(/[\s-]/g, '');
        if (!legacy || legacy !== rcCode) {
          return res.status(404).json({ error: '激活码无效' });
        }
        vipType = rcType || '月度VIP';
      }

      var exp = vipExpire(vipType);
      var pRes = await sbFetch('users?username=eq.' + encodeURIComponent(rcName), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ vip: vipType, expire: exp }),
      });
      if (!pRes.ok) return res.status(502).json({ error: 'VIP 更新失败: ' + (await pRes.text()) });

      return res.json({ success: true, vip: vipType, expire: exp });
    }

    // ========== 凭激活码重置密码（公开；身份凭证 = 邮箱 + 该账号已兑换过的激活码） ==========
    //   链路：邮箱 → 账号名 → 激活码绑定账号 → 二者必须是同一账号 → 才允许改密。
    //   激活码的 used_by 就是当初兑换它的账号，天然与账号对应（见 redeemCode）。
    if (action === 'resetPasswordByCode') {
      var rpIp = clientIp(req);
      if (rateLimited('resetByCode:' + rpIp, 10, 10 * 60 * 1000)) {
        return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
      }
      var rpEmail = String((req.body && req.body.email) || '').trim();
      var rpCode = String((req.body && req.body.code) || '').trim().toUpperCase().replace(/[\s-]/g, '');
      var rpPwd = String((req.body && req.body.newPassword) || '');
      if (!rpEmail || !rpCode) return res.status(400).json({ error: '缺少 email 或 code' });
      if (rpPwd.length < 6) return res.status(400).json({ error: '新密码至少需要 6 位' });

      // 1) 邮箱 → 账号（一个邮箱可能关联多个账号）
      var ruRes = await sbFetch('users?email=eq.' + encodeURIComponent(rpEmail) + '&select=username,authCode', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      if (!ruRes.ok) return res.status(502).json({ error: '查询失败: ' + (await ruRes.text()) });
      var ruRows = (await ruRes.json()) || [];
      if (!ruRows.length) return res.status(404).json({ error: '该邮箱没有关联的账号' });
      var emailUsers = ruRows.map(function(x) { return x.username; });

      // 2) 激活码 → 绑定的账号（只认「已被兑换」的码；未兑换的码没有主人）
      var rcRes = await sbFetch('activation_codes?code=eq.' + encodeURIComponent(rpCode) + '&select=code,status,used_by', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      var rcRows = rcRes.ok ? await rcRes.json() : [];
      var boundTo = null;
      if (rcRows && rcRows.length) {
        if (rcRows[0].status !== 'used' || !rcRows[0].used_by) {
          return res.status(409).json({ error: '此激活码尚未被任何账号兑换，无法用于找回密码' });
        }
        boundTo = rcRows[0].used_by;
      } else {
        // 兼容旧数据：users.authCode（该列不存在时会自然走到「无效」）
        var legacy = ruRows.filter(function(x) {
          return String(x.authCode || '').trim().toUpperCase().replace(/[\s-]/g, '') === rpCode;
        });
        boundTo = legacy.length ? legacy[0].username : null;
      }

      // 3) 两道信息必须指向同一账号（防止拿别人的码改自己的密码，或反之）
      if (!boundTo || emailUsers.indexOf(boundTo) === -1) {
        return res.status(403).json({ error: '激活码无效，或与该邮箱不匹配' });
      }

      // 4) 写入新密码，并清空该账号的全部会话 → 所有旧设备下次校验即被踢下线
      //    （改多设备后不能再靠「换 session_token」踢人：终身会员有 5 条会话）
      var rpRes = await sbFetch('users?username=eq.' + encodeURIComponent(boundTo), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ password: hashPassword(rpPwd), session_token: null }),
      });
      if (!rpRes.ok) return res.status(502).json({ error: '重置失败: ' + (await rpRes.text()) });
      await clearSessions(boundTo);

      return res.json({ success: true, username: boundTo });
    }

    // ========== 更新用户（仅管理员） ==========
    if (action === 'updateUser') {
      const { username, data: fields } = req.body;
      if (!username || !fields) return res.status(400).json({ error: '缺少 username 或 data' });
      // 如果更新密码，服务端哈希
      if (fields.password) {
        fields.password = hashPassword(fields.password);
      }
      var url4 = 'users?username=eq.' + encodeURIComponent(username);
      var r4 = await sbFetch(url4, {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(fields),
      });
      if (!r4.ok) return res.status(502).json({ error: '更新失败: ' + (await r4.text()) });
      var data4 = await r4.json();
      var user4 = Array.isArray(data4) ? data4[0] : data4;
      if (user4) { delete user4.password; delete user4.session_token; }
      return res.json({ success: true, user: user4 || null });
    }

    // ========== 更新 VIP（仅管理员） ==========
    if (action === 'updateVIP') {
      const { username, vip, expire } = req.body;
      if (!username || !vip) return res.status(400).json({ error: '缺少 username 或 vip' });
      var url5 = 'users?username=eq.' + encodeURIComponent(username);
      var r5 = await sbFetch(url5, {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ vip: vip, expire: expire || '', last_seen: new Date().toISOString() }),
      });
      if (!r5.ok) return res.status(502).json({ error: 'VIP更新失败: ' + (await r5.text()) });
      var data5 = await r5.json();
      return res.json({ success: true, user: Array.isArray(data5) ? data5[0] : data5 });
    }

    // ========== 查看某账号的在线设备（仅管理员，用于客服排查） ==========
    if (action === 'getSessions') {
      var gsName = String((req.body && req.body.username) || '').trim();
      if (!gsName) return res.status(400).json({ error: '缺少 username' });
      var gsRows = await loadSessions(gsName);
      if (gsRows === null) {
        return res.status(503).json({ error: 'user_sessions 表不可用，请先执行 outputs/multi-device-sessions.sql' });
      }
      var guRes = await sbFetch('users?username=eq.' + encodeURIComponent(gsName) + '&select=vip,expire', {
        headers: svcHeaders({ Prefer: undefined }),
      });
      var guRows = guRes.ok ? await guRes.json() : [];
      var gLife = isLifetime(guRows && guRows[0]);
      var callerIp = clientIp(req);
      var callerCity = await geoOf(callerIp);
      return res.json({
        success: true,
        lifetime: gLife,
        limit: gLife ? MULTI_IP_LIMIT : 1,
        ipCount: uniqIp(gsRows).length,
        sessions: gsRows.map(function (s) {
          return {
            token: s.token,
            ip: maskIp(s.ip),
            city: s.city_label || '',
            cityWeak: !!s.city_weak,
            createdAt: s.created_at,
            lastSeen: s.last_seen,
            ua: s.ua || '',
          };
        }),
        caller: { ip: maskIp(callerIp), city: callerCity.label || '', cityWeak: !!callerCity.weak },
      });
    }

    // ========== 踢掉指定会话（仅管理员） ==========
    if (action === 'kickSession') {
      var ksName = String((req.body && req.body.username) || '').trim();
      var ksToken = String((req.body && req.body.token) || '').trim();
      if (!ksName || !ksToken) return res.status(400).json({ error: '缺少 username 或 token' });
      var ksOk = await deleteSession(ksName, ksToken);
      return res.json({ success: true, deleted: ksOk });
    }

    // ========== 删除用户（仅管理员） ==========
    if (action === 'deleteUser') {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      var url6 = 'users?username=eq.' + encodeURIComponent(username);
      var r6 = await sbFetch(url6, { method: 'DELETE', headers: svcHeaders({ Prefer: undefined }) });
      if (!r6.ok) return res.status(502).json({ error: '删除失败: ' + (await r6.text()) });
      // 会话一并清掉，否则删号后旧 token 还能通过 checkSession
      try {
        await sbFetch('user_sessions?username=eq.' + encodeURIComponent(username), {
          method: 'DELETE', headers: svcHeaders({ Prefer: 'return=minimal' }),
        });
      } catch (_) {}
      return res.json({ success: true });
    }

    // ========== 查询激活码（仅管理员） ==========
    if (action === 'getActivationCode') {
      const code = req.body && req.body.code;
      if (!code) return res.status(400).json({ error: '缺少 code' });
      var url7 = 'activation_codes?code=eq.' + encodeURIComponent(code) + '&select=*';
      var r7 = await sbFetch(url7, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r7.ok) return res.status(502).json({ error: '查询失败: ' + (await r7.text()) });
      var data7 = await r7.json();
      return res.json({ success: true, codes: data7 });
    }

    // ========== 按码删除激活码（仅管理员） ==========
    if (action === 'deleteActivationCode') {
      const code = req.body && req.body.code;
      if (!code) return res.status(400).json({ error: '缺少 code' });
      var url8 = 'activation_codes?code=eq.' + encodeURIComponent(code);
      var r8 = await sbFetch(url8, { method: 'DELETE', headers: svcHeaders({ Prefer: 'return=representation' }) });
      if (!r8.ok) return res.status(502).json({ error: '删除失败: ' + (await r8.text()) });
      var data8 = await r8.json();
      return res.json({ success: true, deleted: (data8 || []).length });
    }

    // ========== 更新激活码（仅管理员） ==========
    if (action === 'updateActivationCode') {
      const { id, data: fields } = req.body;
      if (!id || !fields) return res.status(400).json({ error: '缺少 id 或 data' });
      var url9 = 'activation_codes?id=eq.' + encodeURIComponent(id);
      var r9 = await sbFetch(url9, {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(fields),
      });
      if (!r9.ok) return res.status(502).json({ error: '更新失败: ' + (await r9.text()) });
      return res.json({ success: true });
    }

    // ========== 获取所有激活码（仅管理员） ==========
    if (action === 'getAllActivationCodes') {
      var filterStatus = (req.body && req.body.filter) || 'all';
      var url10 = 'activation_codes?select=*&order=created_at.desc';
      if (filterStatus !== 'all') url10 += '&status=eq.' + filterStatus;
      var r10 = await sbFetch(url10, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r10.ok) return res.status(502).json({ error: '查询失败: ' + (await r10.text()) });
      var data10 = await r10.json();
      return res.json({ success: true, codes: data10 });
    }

    // ========== 批量创建激活码（仅管理员） ==========
    if (action === 'createActivationCodes') {
      var codes = req.body && req.body.codes;
      if (!codes || !codes.length) return res.status(400).json({ error: '缺少 codes' });
      var r11 = await sbFetch('activation_codes', {
        method: 'POST',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify(codes),
      });
      if (!r11.ok) return res.status(502).json({ error: '创建失败: ' + (await r11.text()) });
      return res.json({ success: true });
    }

    // ========== 管理员统计数据（仅管理员） ==========
    if (action === 'getAdminStats') {
      var todayStr = new Date().toISOString().split('T')[0];
      var since = todayStr + 'T00:00:00';
      var results = await Promise.all([
        sbCount('users?select=id'),
        sbCount('users?select=id&vip=not.is.null&vip=neq.' + encodeURIComponent('普通用户')),
        sbCount('visits?select=id&created_at=gte.' + since),
        sbCount('users?select=id&created_at=gte.' + since),
      ]);
      if (results.some(function(x) { return x === null; })) return res.status(502).json({ error: '查询失败' });
      return res.json({ success: true, stats: {
        totalUsers: results[0], vipCount: results[1],
        visitsToday: results[2], newUsersToday: results[3],
      } });
    }

    return res.status(400).json({ error: '未知 action: ' + action });
  } catch (e) {
    console.error('[proxy-user] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
