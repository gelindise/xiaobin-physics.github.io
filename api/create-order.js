// 创建 PayJS 支付订单，返回二维码
const { createHash } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAYJS_MCHID = process.env.PAYJS_MCHID;
const PAYJS_KEY = process.env.PAYJS_KEY;

// 套餐定价（单位：分）
const PRICES = { '月度VIP': 1000, '年度VIP': 5000, '终身VIP': 9800 };

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function sign(obj, key) {
  const sorted = Object.keys(obj).sort();
  const str = sorted.map(k => `${k}=${obj[k]}`).join('&') + `&key=${key}`;
  return md5(str).toUpperCase();
}

async function sbQuery(sql, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query_text: sql, params }),
  });
  if (!res.ok) throw new Error(`Supabase RPC error: ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, vipType } = req.body;
    if (!username || !vipType) {
      return res.status(400).json({ error: '缺少参数 username 或 vipType' });
    }

    const amount = PRICES[vipType];
    if (!amount) {
      return res.status(400).json({ error: '无效的套餐类型' });
    }

    // 生成唯一订单号
    const outTradeNo = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    // 回调地址（Vercel 部署后的回调地址）
    const baseUrl = req.headers['x-forwarded-proto'] + '://' + req.headers['x-forwarded-host'];
    const notifyUrl = `${baseUrl}/api/pay-callback`;

    const payjsParams = {
      mchid: PAYJS_MCHID,
      total_fee: amount,
      out_trade_no: outTradeNo,
      body: `物理虚拟实验 - ${vipType}`,
      notify_url: notifyUrl,
      attach: JSON.stringify({ username, vipType }),
    };
    payjsParams.sign = sign(payjsParams, PAYJS_KEY);

    // 调用 PayJS 原生支付接口
    const payjsRes = await fetch('https://payjs.cn/api/native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payjsParams).toString(),
    });
    const payjsData = await payjsRes.json();

    if (payjsData.return_code !== 1) {
      return res.status(500).json({ error: 'PayJS 创建订单失败: ' + (payjsData.return_msg || '未知错误') });
    }

    // 订单写入 Supabase
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        out_trade_no: outTradeNo,
        username,
        vip_type: vipType,
        amount,
        status: 'pending',
        payjs_order_id: payjsData.payjs_order_id || '',
      }),
    });

    if (!orderRes.ok) {
      throw new Error('保存订单失败: ' + (await orderRes.text()));
    }

    return res.json({
      success: true,
      qrcode: payjsData.qrcode,
      out_trade_no: outTradeNo,
      payjs_order_id: payjsData.payjs_order_id,
      amount,
    });
  } catch (e) {
    console.error('[create-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
