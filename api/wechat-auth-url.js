// ========== 生成微信OAuth授权URL ==========
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const WECHAT_APPID = process.env.WECHAT_APPID;
  if (!WECHAT_APPID) {
    return res.status(500).json({ error: 'WECHAT_APPID 未配置' });
  }

  const { redirect } = req.query;
  // 安全校验 redirect 参数
  const safeRedirect = redirect && redirect.startsWith('/')
    ? `https://${req.headers['x-forwarded-host'] || 'localhost'}` + redirect
    : `https://${req.headers['x-forwarded-host'] || 'localhost'}/experiments.html`;

  const callbackUrl = `https://${req.headers['x-forwarded-host']}/api/wechat-callback?redirect=${encodeURIComponent(safeRedirect)}`;

  // 微信OAuth2.0：snsapi_base 静默授权（只拿openid）
  // snsapi_userinfo 需要用户手动授权（可拿昵称头像）
  const authUrl =
    'https://open.weixin.qq.com/connect/oauth2/authorize' +
    `?appid=${WECHAT_APPID}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    '&response_type=code' +
    '&scope=snsapi_userinfo' +
    '&state=physics#wechat_redirect';

  res.json({ url: authUrl });
};
