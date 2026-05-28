// ========== 微信OAuth回调处理 ==========
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WECHAT_APPID = process.env.WECHAT_APPID;
const WECHAT_APPSECRET = process.env.WECHAT_APPSECRET;

async function supabaseQuery(table, method, body, filter) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = new URLSearchParams();
  if (filter) params.set(filter.col, filter.val);
  if (method === 'GET') params.set('select', '*');
  const qs = params.toString();
  if (qs) url += '?' + qs;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code, state, redirect: rawRedirect } = req.query;
    if (!code) return res.status(400).send('缺少授权码');

    // 1. 用 code 换取 access_token 和 openid
    const tokenRes = await fetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token` +
      `?appid=${WECHAT_APPID}&secret=${WECHAT_APPSECRET}&code=${code}&grant_type=authorization_code`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.errcode) {
      console.error('[微信] token交换失败:', tokenData);
      return res.status(400).send('微信授权失败');
    }

    const { openid, access_token } = tokenData;

    // 2. 获取用户微信昵称和头像（snsapi_userinfo 才需要）
    let nickname = `wx_${openid.slice(-6)}`;
    let avatar = '';
    try {
      const userRes = await fetch(
        `https://api.weixin.qq.com/sns/userinfo` +
        `?access_token=${access_token}&openid=${openid}&lang=zh_CN`
      );
      const userData = await userRes.json();
      if (userData.nickname) nickname = userData.nickname;
      if (userData.headimgurl) avatar = userData.headimgurl;
    } catch (e) {
      console.warn('[微信] 获取用户信息失败:', e.message);
    }

    // 3. 查找或创建用户（以 openid 为唯一标识）
    let users = await supabaseQuery(
      'users', 'GET', null,
      { col: 'openid', val: `eq.${openid}` }
    );
    let userRecord = users && users.length > 0 ? users[0] : null;

    if (!userRecord) {
      // 新用户 —— 自动注册
      const username = `wx_${openid.slice(-8)}`;
      await supabaseQuery('users', 'POST', {
        username,
        openid,
        wechat_nickname: nickname,
        wechat_avatar: avatar,
        password: '',       // 微信用户无需密码
        email: '',
        vip: '普通用户',
        expire: '',
      });
    } else {
      // 已有用户 —— 更新昵称头像
      await supabaseQuery(
        'users', 'PATCH', { wechat_nickname: nickname, wechat_avatar: avatar },
        { col: 'openid', val: `eq.${openid}` }
      );
    }

    // 4. 生成登录令牌（简化：用 openid + 时间戳签名）
    const token = Buffer.from(JSON.stringify({
      openid,
      nickname,
      t: Date.now(),
    })).toString('base64');

    // 5. 重定向回前端，通过 URL hash 传递 token
    const redirectUrl = rawRedirect || `https://${req.headers['x-forwarded-host']}/experiments.html`;
    const finalUrl = redirectUrl.includes('?')
      ? `${redirectUrl}&wechat_token=${encodeURIComponent(token)}&openid=${openid}`
      : `${redirectUrl}?wechat_token=${encodeURIComponent(token)}&openid=${openid}`;

    // 返回一个自提交页面，把 token 存入 localStorage 再跳转
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html><body>
<script>
  localStorage.setItem('wechat_token', '${token}');
  localStorage.setItem('currentUser', '${nickname.replace(/'/g, "\\'")}');
  localStorage.setItem('openid', '${openid}');
  window.location.href = '${finalUrl.replace(/'/g, "\\'")}';
</script>
</body></html>`);
  } catch (e) {
    console.error('[微信回调] 错误:', e.message);
    res.status(500).send('微信登录失败，请稍后重试');
  }
};
