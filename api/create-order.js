// 创建虎皮椒支付订单，返回二维码
const { createHash } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const XUNHU_APPID = process.env.XUNHU_APPID;
const XUNHU_APPSECRET = process.env.XUNHU_APPSECRET;

const PRICES = { '月度VIP': '10.00', '年度VIP': '50.00', '终身VIP': '98.00' };

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function sign(params, appsecret) {
  const keys = Object.keys(params).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + `&appsecret=${appsecret}`;
  return md5(str).toUpperCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, vipType } = req.body;
    if (!username || !vipType) {
      return res.status(400).json({ error: '缺少参数 username 或 vipType' });
    }

    const totalFee = PRICES[vipType];
    if (!totalFee) return res.status(400).json({ error: '无效的套餐类型' });

    // 生成订单号
    const tradeOrderId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    // 回调地址
    const baseUrl = req.headers['x-forwarded-proto'] + '://' + req.headers['x-forwarded-host'];
    const notifyUrl = `${baseUrl}/api/pay-callback`;

    const time = Math.floor(Date.now() / 1000).toString();

    const params = {
      appid: XUNHU_APPID,
      type: 'WECHAT',
      trade_order_id: tradeOrderId,
      total_fee: totalFee,
      title: `物理虚拟实验 - ${vipType}`,
      time,
      notify_url: notifyUrl,
      attach: JSON.stringify({ username, vipType }),
    };
    params.sign = sign(params, XUNHU_APPSECRET);

    // 调用虎皮椒支付接口
    const xhRes = await fetch('https://api.xunhupay.com/payment/wechat.html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const xhData = await xhRes.json();

    if (xhData.errcode !== 0) {
      return res.status(500).json({ error: '虎皮椒创建订单失败: ' + (xhData.errmsg || '未知错误') });
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
        out_trade_no: tradeOrderId,
        username,
        vip_type: vipType,
        amount: Math.round(parseFloat(totalFee) * 100), // 存为分
        status: 'pending',
        payjs_order_id: xhData.order_id || '',
      }),
    });

    if (!orderRes.ok) throw new Error('保存订单失败: ' + (await orderRes.text()));

    return res.json({
      success: true,
      qrcode: xhData.url_qrcode || xhData.qrcode,
      out_trade_no: tradeOrderId,
      amount: Math.round(parseFloat(totalFee) * 100),
    });
  } catch (e) {
    console.error('[create-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
