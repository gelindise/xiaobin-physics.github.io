// 面包多 H5 支付 - 创建订单
const { createHash } = require('crypto');

const MBD_DEV_KEY = process.env.MBD_DEVELOPER_KEY;
// Developer Key 格式: app_id:hash:app_secret
// app_id = 第一段，app_key = 第三段（非整个developer key）
const MBD_APP_ID = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[0] : '';
const MBD_APP_KEY = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[2] : '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PRICES = { '月度VIP': '9.90', '年度VIP': '99.00', '终身VIP': '199.00' };

function md5(str) {
  return createHash('md5').update(str, 'utf8').digest('hex');
}

function sign(params, appkey) {
  const keys = Object.keys(params).filter(k => params[k] !== '' && params[k] != null).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + `&key=${appkey}`;
  console.log('[sign] stringToHash:', str);
  return md5(str);
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

    const outTradeNo = `mbd_${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const amountTotal = Math.round(parseFloat(totalFee) * 100);

    const params = {
      channel: 'h5',
      app_id: MBD_APP_ID,
      description: `物理虚拟实验 - ${vipType}`,
      amount_total: amountTotal,
      out_trade_no: outTradeNo,
    };
    params.sign = sign(params, MBD_APP_KEY);

    console.log('[create-order] app_id:', MBD_APP_ID, 'app_key_len:', MBD_APP_KEY.length);
    console.log('[create-order] params:', JSON.stringify(params));

    const mbdRes = await fetch('https://newapi.mbd.pub/release/wx/prepay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const mbdData = await mbdRes.json();

    if (mbdData.error) {
      console.error('[create-order] 面包多 error:', mbdData.error);
      return res.status(500).json({ error: '面包多创建订单失败: ' + mbdData.error });
    }

    if (!mbdData.h5_url) {
      console.error('[create-order] 面包多 no h5_url:', JSON.stringify(mbdData));
      return res.status(500).json({ error: '面包多未返回支付链接' });
    }

    // 保存订单到 Supabase（非阻塞，失败不影响返回支付链接）
    try {
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
          amount: amountTotal,
          status: 'pending',
        }),
      });

      if (!orderRes.ok) {
        console.error('[create-order] save order failed:', await orderRes.text());
      }
    } catch (e) {
      console.error('[create-order] save order error:', e.message);
    }

    return res.json({
      success: true,
      h5_url: mbdData.h5_url,
      out_trade_no: outTradeNo,
      amount: amountTotal,
    });
  } catch (e) {
    console.error('[create-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
