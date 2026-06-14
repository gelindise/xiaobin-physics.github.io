// 面包多 H5 支付 - 创建订单
const { createHash } = require('crypto');

const MBD_DEV_KEY = process.env.MBD_DEVELOPER_KEY;
const MBD_APP_ID = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[0] : '';
// 尝试第三段作为 app_key
const MBD_APP_KEY = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[2] : '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PRICES = { '月度VIP': '9.90', '年度VIP': '99.00', '终身VIP': '199.00' };

function md5(str) {
  return createHash('md5').update(str, 'utf8').digest('hex');
}

function makeSign(params, appkey) {
  const keys = Object.keys(params).filter(k => params[k] !== '' && params[k] != null).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + `&key=${appkey}`;
  return { sign: md5(str), debug: str };
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

    const allResults = [];

    // 尝试1: 标准参数
    const p1 = {
      channel: 'h5',
      app_id: MBD_APP_ID,
      description: `物理虚拟实验 - ${vipType}`,
      amount_total: amountTotal,
      out_trade_no: outTradeNo,
    };
    const s1 = makeSign(p1, MBD_APP_KEY);
    const r1 = await fetch('https://newapi.mbd.pub/release/wx/prepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p1, sign: s1.sign }),
    }).then(r => r.json());
    console.log('[try1] standard:', s1.debug, '->', s1.sign, 'result:', JSON.stringify(r1));
    allResults.push({ label: 'standard', signStr: s1.debug, result: r1 });
    if (r1.h5_url) return res.json({ success: true, h5_url: r1.h5_url, out_trade_no: outTradeNo, amount: amountTotal });

    // 尝试2: amount_total作为字符串
    const p2 = { ...p1, amount_total: String(amountTotal) };
    const s2 = makeSign(p2, MBD_APP_KEY);
    const r2 = await fetch('https://newapi.mbd.pub/release/wx/prepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p1, sign: s2.sign }),
    }).then(r => r.json());
    console.log('[try2] str amount:', s2.debug, '->', s2.sign, 'result:', JSON.stringify(r2));
    allResults.push({ label: 'str_amount', signStr: s2.debug, result: r2 });
    if (r2.h5_url) return res.json({ success: true, h5_url: r2.h5_url, out_trade_no: outTradeNo, amount: amountTotal });

    // 尝试3: 简单英文描述
    const p3 = { ...p1, description: 'VIP' };
    const s3 = makeSign(p3, MBD_APP_KEY);
    const r3 = await fetch('https://newapi.mbd.pub/release/wx/prepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p3, sign: s3.sign }),
    }).then(r => r.json());
    console.log('[try3] simple desc:', s3.debug, '->', s3.sign, 'result:', JSON.stringify(r3));
    allResults.push({ label: 'simple_desc', signStr: s3.debug, result: r3 });
    if (r3.h5_url) return res.json({ success: true, h5_url: r3.h5_url, out_trade_no: outTradeNo, amount: amountTotal });

    // 尝试4: 使用完整developer key作为app_key
    const s4 = makeSign(p1, MBD_DEV_KEY);
    const r4 = await fetch('https://newapi.mbd.pub/release/wx/prepay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p1, sign: s4.sign }),
    }).then(r => r.json());
    console.log('[try4] full key:', s4.debug, '->', s4.sign, 'result:', JSON.stringify(r4));
    allResults.push({ label: 'full_key', signStr: s4.debug, result: r4 });
    if (r4.h5_url) return res.json({ success: true, h5_url: r4.h5_url, out_trade_no: outTradeNo, amount: amountTotal });

    return res.status(500).json({
      error: '所有签名方案均失败',
      debug: allResults,
    });
  } catch (e) {
    console.error('[create-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
