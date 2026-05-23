// 虎皮椒支付回调通知
const { createHash } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const XUNHU_APPSECRET = process.env.XUNHU_APPSECRET;

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function verifySign(params, appsecret) {
  const keys = Object.keys(params).sort();
  // 排除 sign 字段本身
  const str = keys.filter(k => k !== 'sign').map(k => `${k}=${params[k]}`).join('&') + `&appsecret=${appsecret}`;
  const expected = md5(str).toUpperCase();
  return expected === params.sign;
}

module.exports = async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const params = Object.fromEntries(new URLSearchParams(body));

  console.log('[pay-callback] received:', JSON.stringify(params));

  // 验证签名
  if (!verifySign(params, XUNHU_APPSECRET)) {
    console.error('[pay-callback] sign verification failed');
    return res.status(200).send('fail');
  }

  // 只处理支付成功
  if (params.trade_status !== 'completed') {
    console.log('[pay-callback] trade_status:', params.trade_status, '-> ignored');
    return res.status(200).send('success');
  }

  const outTradeNo = params.out_trade_no;
  let attach = {};
  try { attach = JSON.parse(params.attach || '{}'); } catch (e) {}

  const username = attach.username;
  const vipType = attach.vipType;

  if (!outTradeNo || !username || !vipType) {
    console.error('[pay-callback] missing required data');
    return res.status(200).send('fail');
  }

  try {
    const now = new Date();

    // 计算 VIP 到期日
    let expireDate = '';
    if (vipType === '月度VIP') {
      const d = new Date(now); d.setDate(d.getDate() + 30);
      expireDate = d.toISOString().split('T')[0];
    } else if (vipType === '年度VIP') {
      const d = new Date(now); d.setDate(d.getDate() + 365);
      expireDate = d.toISOString().split('T')[0];
    } else {
      expireDate = '永久';
    }

    // 更新订单状态
    const orderKey = `out_trade_no=eq.${outTradeNo}`;
    await fetch(`${SUPABASE_URL}/rest/v1/orders?${orderKey}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        status: 'paid',
        paid_at: now.toISOString(),
      }),
    });

    // 更新用户的 VIP 权限
    const userKey = `username=eq.${username}`;
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?${userKey}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ vip: vipType, expire: expireDate }),
    });

    if (!userRes.ok) {
      console.error('[pay-callback] update user failed:', await userRes.text());
      return res.status(200).send('fail');
    }

    console.log(`[pay-callback] SUCCESS: ${username} → ${vipType} (${expireDate})`);
    return res.status(200).send('success');
  } catch (e) {
    console.error('[pay-callback] error:', e);
    return res.status(200).send('fail');
  }
};
