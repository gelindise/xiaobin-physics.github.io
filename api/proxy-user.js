// Vercel 无服务器函数 - 用户操作代理（服务端执行，避免客户端直接暴露查询）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

    // ========== 查询单个用户 ==========
    if (action === 'getUser') {
      const username = req.method === 'GET' ? req.query.username : req.body?.username;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&select=*`;
      const r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: data[0] || null });
    }

    // ========== 获取所有用户（分页） ==========
    if (action === 'getUsers') {
      const url = `${SUPABASE_URL}/rest/v1/users?select=*&order=username.asc`;
      const r = await fetch(url, { headers: { ...headers, Prefer: undefined } });
      if (!r.ok) return res.status(502).json({ error: '查询失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, users: data });
    }

    // ========== 创建用户 ==========
    if (action === 'createUser') {
      const { username, password, email, vip, expire } = req.body?.data || req.body;
      if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });
      const url = `${SUPABASE_URL}/rest/v1/users`;
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username,
          password,
          email: email || '',
          vip: vip || '普通用户',
          expire: expire || '',
          last_seen: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        if (text.includes('duplicate') || text.includes('23505')) {
          return res.status(409).json({ error: '用户名已存在' });
        }
        return res.status(502).json({ error: '创建失败: ' + text });
      }
      const data = await r.json();
      return res.json({ success: true, user: Array.isArray(data) ? data[0] : data });
    }

    // ========== 更新用户 ==========
    if (action === 'updateUser') {
      const { username, data: fields } = req.body;
      if (!username || !fields) return res.status(400).json({ error: '缺少 username 或 data' });
      const url = `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(fields),
      });
      if (!r.ok) return res.status(502).json({ error: '更新失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: Array.isArray(data) ? data[0] : data });
    }

    // ========== 更新 VIP（快捷操作） ==========
    if (action === 'updateVIP') {
      const { username, vip, expire } = req.body;
      if (!username || !vip) return res.status(400).json({ error: '缺少 username 或 vip' });
      const url = `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ vip, expire: expire || '', last_seen: new Date().toISOString() }),
      });
      if (!r.ok) return res.status(502).json({ error: 'VIP更新失败: ' + (await r.text()) });
      const data = await r.json();
      return res.json({ success: true, user: Array.isArray(data) ? data[0] : data });
    }

    // ========== 删除用户 ==========
    if (action === 'deleteUser') {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: '缺少 username' });
      const url = `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}`;
      const r = await fetch(url, {
        method: 'DELETE',
        headers: { ...headers, Prefer: undefined },
      });
      if (!r.ok) return res.status(502).json({ error: '删除失败: ' + (await r.text()) });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: `未知 action: ${action}` });
  } catch (e) {
    console.error('[proxy-user] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
