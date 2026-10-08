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
  'findByEmail', 'redeemCode', 'verifyAdmin',
];
var ADMIN_ACTIONS = [
  'getUser', 'getUsers', 'updateUser', 'updateVIP', 'deleteUser',
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
  return String(h['x-forwarded-for'] || h['x-real-ip'] || 'unknown').split(',')[0].trim();
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

      // 生成并存储 session_token
      var sessionToken = generateSessionToken();
      await sbFetch('users?username=eq.' + encodeURIComponent(loginName), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ session_token: sessionToken, last_seen: new Date().toISOString() }),
      });

      return res.json({
        success: true,
        token: sessionToken,
        user: {
          username: userData.username,
          vip: userData.vip || '普通用户',
          expire: userData.expire || '',
          email: userData.email || '',
        },
      });
    }

    // ========== 退出登录 ==========
    if (action === 'logout') {
      var logoutName = req.body && req.body.username;
      if (!logoutName) return res.status(400).json({ error: '缺少 username' });
      await sbFetch('users?username=eq.' + encodeURIComponent(logoutName), {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ session_token: null }),
      });
      return res.json({ success: true });
    }

    // ========== 校验 session_token（单设备登录）+ 顺带刷新在线时间 ==========
    if (action === 'checkSession') {
      var csName = req.body && req.body.username;
      var csToken = req.body && req.body.token;
      if (!csName || !csToken) return res.status(400).json({ error: '缺少 username 或 token' });
      var url3 = 'users?username=eq.' + encodeURIComponent(csName) + '&select=session_token';
      var r3 = await sbFetch(url3, { headers: svcHeaders({ Prefer: undefined }) });
      if (!r3.ok) return res.status(502).json({ error: '查询失败: ' + (await r3.text()) });
      var data3 = await r3.json();
      var serverToken = data3 && data3[0] ? data3[0].session_token : null;
      if (serverToken && serverToken !== csToken) {
        return res.json({ valid: false, reason: 'kicked' });
      }
      // 仅在令牌确实匹配时才刷新 last_seen（避免匿名者借此刷写）
      if (serverToken && serverToken === csToken) {
        try {
          await sbFetch('users?username=eq.' + encodeURIComponent(csName), {
            method: 'PATCH',
            headers: svcHeaders({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ last_seen: new Date().toISOString() }),
          });
        } catch (_) {}
      }
      return res.json({ valid: true });
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

    // ========== 删除用户（仅管理员） ==========
    if (action === 'deleteUser') {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      var url6 = 'users?username=eq.' + encodeURIComponent(username);
      var r6 = await sbFetch(url6, { method: 'DELETE', headers: svcHeaders({ Prefer: undefined }) });
      if (!r6.ok) return res.status(502).json({ error: '删除失败: ' + (await r6.text()) });
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
      var q1 = await sbFetch('users?select=id,vip', { headers: svcHeaders({ Prefer: undefined }) });
      if (!q1.ok) return res.status(502).json({ error: '查询失败' });
      var allUsers = await q1.json();
      var total = (allUsers || []).length;
      var vipCount = (allUsers || []).filter(function(u) { return u.vip && u.vip !== '普通用户'; }).length;

      var q2 = await sbFetch('visits?select=id&created_at=gte.' + todayStr + 'T00:00:00', { headers: svcHeaders({ Prefer: undefined }) });
      var visitsToday = q2.ok ? (await q2.json()).length : 0;

      var q3 = await sbFetch('users?select=id&created_at=gte.' + todayStr + 'T00:00:00', { headers: svcHeaders({ Prefer: undefined }) });
      var newUsersToday = q3.ok ? (await q3.json()).length : 0;

      return res.json({ success: true, stats: { totalUsers: total, vipCount: vipCount, visitsToday: visitsToday, newUsersToday: newUsersToday } });
    }

    return res.status(400).json({ error: '未知 action: ' + action });
  } catch (e) {
    console.error('[proxy-user] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
