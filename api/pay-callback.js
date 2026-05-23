// PayJS 支付回调通知
const { createHash } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAYJS_KEY = process.env.PAYJS_KEY;

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function verifySign(params, key) {
  const sorted = Object.keys(params).sort();
  const str = sorted.map(k => `${k}=${params[k]}`).join('&') + `&key=${key}`;
  const expected = md5(str).toUpperCase();
  return expected === params.sign;
}

module.exports = async (req, res) => {
  // PayJS 发送 POST 请求，body 是 URL-encoded 格式
  let body = '';
  for await (const chunk of req) body += chunk;
  const params = Object.fromEntries(new URLSearchParams(body));

  console.log('[pay-callback] received:', JSON.stringify(params));

  // 验证签名
  if (!verifySign(params, PAYJS_KEY)) {
    console.error('[pay-callback] sign verification failed');
    return res.status(200).send('sign fail');
  }

  if (params.return_code !== '1') {
    console.error('[pay-callback] payjs return_code not 1:', params.return_code);
    return res.status(200).send('fail');
  }

  const outTradeNo = params.out_trade_no;
  const payjsOrderId = params.payjs_order_id;
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
    const updateOrderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${outTradeNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        status: 'paid',
        payjs_order_id: payjsOrderId,
        paid_at: now.toISOString(),
      }),
    });

    if (!updateOrderRes.ok) {
      console.error('[pay-callback] update order failed:', await updateOrderRes.text());
    }

    // 更新用户的 VIP 权限
    const updateUserRes = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${username}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ vip: vipType, expire: expireDate }),
    });

    if (!updateUserRes.ok) {
      console.error('[pay-callback] update user failed:', await updateUserRes.text());
      return res.status(200).send('fail');
    }

    console.log(`[pay-callback] SUCCESS: ${username} → ${vipType} (${expireDate})`);
    return res.status(200).send('success');
  } catch (e) {
    console.error('[pay-callback] error:', e);
    return res.status(200).send('fail');
  }
};
