// Vercel 无服务器函数 - 用户操作代理（服务端执行，避免客户端直接暴露查询）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const crypto = require('crypto');

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

// 公开字段（不含 password / session_token）
var PUBLIC_FIELDS = 'username,vip,expire,email,created_at,last_seen';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.method === 'GET' ? req.query.action : req.body?.action;
    if (!action) return res.status(400).json({ error: '缺少 action 参数' });

    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    };

    // ========== 查询单个用户（含敏感字段，仅管理员使用） ==========
    if (action === 'getUser') {
      const username = req.method === 'GET' ? req.query.username : req.body?.username;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username) + '&select=*';
      const r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: data[0] || null });
    }

    // ========== 获取所有用户（含敏感字段，仅管理员使用） ==========
    if (action === 'getUsers') {
      const url = SUPABASE_URL + '/rest/v1/users?select=*&order=username.asc';
      const r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, users: data });
    }

    // ========== 获取用户公开信息（不含密码/token，前端使用） ==========
    if (action === 'getUserPublic') {
      const username = req.body?.username;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username) + '&select=' + PUBLIC_FIELDS;
      const r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: data[0] || null });
    }

    // ========== 创建用户（服务端密码哈希） ==========
    if (action === 'createUser') {
      const body = req.body?.data || req.body;
      var username = body.username;
      var password = body.password;
      var email = body.email || '';
      if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });
      var url = SUPABASE_URL + '/rest/v1/users';
      var r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: username,
          password: hashPassword(password),
          email: email,
          vip: body.vip || '普通用户',
          expire: body.expire || '',
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
      var username = req.body?.username;
      var password = req.body?.password;
      if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });

      var url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username) + '&select=*';
      var r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      var data = await r.json();
      var userData = data && data[0] ? data[0] : null;

      if (!userData) {
        return res.status(401).json({ error: '用户不存在' });
      }

      if (!verifyPassword(password, userData.password)) {
        return res.status(401).json({ error: '密码错误' });
      }

      // 兼容迁移：如果旧版明文密码，验证通过后哈希化并更新
      var storedPwd = userData.password || '';
      if (storedPwd.indexOf(':') === -1) {
        console.log('[proxy-user] migrating plaintext password for:', username);
        var hashed = hashPassword(password);
        await fetch(SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
          body: JSON.stringify({ password: hashed }),
        });
      }

      // 生成并存储 session_token
      var sessionToken = generateSessionToken();
      await fetch(SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
        body: JSON.stringify({ session_token: sessionToken }),
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
      var username = req.body?.username;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      await fetch(SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
        body: JSON.stringify({ session_token: null }),
      });
      return res.json({ success: true });
    }

    // ========== 校验 session_token（单设备登录） ==========
    if (action === 'checkSession') {
      var username = req.body?.username;
      var token = req.body?.token;
      if (!username || !token) return res.status(400).json({ error: '缺少 username 或 token' });
      var url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username) + '&select=session_token';
      var r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      var data = await r.json();
      var serverToken = data && data[0] ? data[0].session_token : null;
      if (serverToken && serverToken !== token) {
        return res.json({ valid: false, reason: 'kicked' });
      }
      return res.json({ valid: true });
    }

    // ========== 更新用户 ==========
    if (action === 'updateUser') {
      const { username, data: fields } = req.body;
      if (!username || !fields) return res.status(400).json({ error: '缺少 username 或 data' });
      // 如果更新密码，服务端哈希
      if (fields.password) {
        fields.password = hashPassword(fields.password);
      }
      var url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username);
      var r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(fields),
      });
      if (!r.ok) return res.status(502).json({ error: '更新失败: ' + (await r.text()) });
      var data = await r.json();
      // 返回时清除敏感字段
      var user = Array.isArray(data) ? data[0] : data;
      if (user) { delete user.password; delete user.session_token; }
      return res.json({ success: true, user: user || null });
    }

    // ========== 更新 VIP（快捷操作） ==========
    if (action === 'updateVIP') {
      const { username, vip, expire } = req.body;
      if (!username || !vip) return res.status(400).json({ error: '缺少 username 或 vip' });
      var url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username);
      var r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ vip: vip, expire: expire || '', last_seen: new Date().toISOString() }),
      });
      if (!r.ok) return res.status(502).json({ error: 'VIP更新失败: ' + (await r.text()) });
      var data = await r.json();
      return res.json({ success: true, user: Array.isArray(data) ? data[0] : data });
    }

    // ========== 删除用户 ==========
    if (action === 'deleteUser') {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      var url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(username);
      var r = await fetch(url, {
        method: 'DELETE',
        headers: { ...headers, Prefer: undefined },
      });
      if (!r.ok) return res.status(502).json({ error: '删除失败: ' + (await r.text()) });
      return res.json({ success: true });
    }

    // ========== 查询激活码 ==========
    if (action === 'getActivationCode') {
      const code = req.body?.code;
      if (!code) return res.status(400).json({ error: '缺少 code' });
      var url = SUPABASE_URL + '/rest/v1/activation_codes?code=eq.' + encodeURIComponent(code) + '&select=*';
      var r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      var data = await r.json();
      return res.json({ success: true, codes: data });
    }

    // ========== 更新激活码 ==========
    if (action === 'updateActivationCode') {
      const { id, data: fields } = req.body;
      if (!id || !fields) return res.status(400).json({ error: '缺少 id 或 data' });
      var url = SUPABASE_URL + '/rest/v1/activation_codes?id=eq.' + encodeURIComponent(id);
      var r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(fields),
      });
      if (!r.ok) return res.status(502).json({ error: '更新失败: ' + (await r.text()) });
      return res.json({ success: true });
    }

    // ========== 获取所有激活码（含筛选） ==========
    if (action === 'getAllActivationCodes') {
      var filterStatus = req.body?.filter || 'all';
      var url = SUPABASE_URL + '/rest/v1/activation_codes?select=*&order=created_at.desc';
      if (filterStatus !== 'all') url += '&status=eq.' + filterStatus;
      var r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      var data = await r.json();
      return res.json({ success: true, codes: data });
    }

    // ========== 批量创建激活码 ==========
    if (action === 'createActivationCodes') {
      var codes = req.body?.codes;
      if (!codes || !codes.length) return res.status(400).json({ error: '缺少 codes' });
      var r = await fetch(SUPABASE_URL + '/rest/v1/activation_codes', {
        method: 'POST', headers,
        body: JSON.stringify(codes),
      });
      if (!r.ok) return res.status(502).json({ error: '创建失败: ' + (await r.text()) });
      return res.json({ success: true });
    }

    // ========== 管理员统计数据 ==========
    if (action === 'getAdminStats') {
      var todayStr = new Date().toISOString().split('T')[0];
      var r1 = await fetch(SUPABASE_URL + '/rest/v1/users?select=id', { headers: { ...headers, Prefer: undefined } });
      if (!r1.ok) return res.status(502).json({ error: '查询失败' });
      var allUsers = await r1.json();
      var total = (allUsers || []).length;
      var vipCount = (allUsers || []).filter(function(u) { return u.vip && u.vip !== '普通用户'; }).length;

      var r2 = await fetch(SUPABASE_URL + '/rest/v1/visits?select=id&created_at=gte.' + todayStr + 'T00:00:00', { headers: { ...headers, Prefer: undefined } });
      var visitsToday = r2.ok ? (await r2.json()).length : 0;

      var r3 = await fetch(SUPABASE_URL + '/rest/v1/users?select=id&created_at=gte.' + todayStr + 'T00:00:00', { headers: { ...headers, Prefer: undefined } });
      var newUsersToday = r3.ok ? (await r3.json()).length : 0;

      return res.json({ success: true, stats: { totalUsers: total, vipCount: vipCount, visitsToday: visitsToday, newUsersToday: newUsersToday } });
    }

    return res.status(400).json({ error: '未知 action: ' + action });
  } catch (e) {
    console.error('[proxy-user] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
