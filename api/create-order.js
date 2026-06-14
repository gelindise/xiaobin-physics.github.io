// 面包多 H5 支付 - 创建订单
const { createHash } = require('crypto');

const MBD_DEV_KEY = process.env.MBD_DEVELOPER_KEY;
// 文档: developer key 整体就是 app_key
const MBD_APP_KEY = MBD_DEV_KEY || '';
const MBD_APP_ID = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[0] : '';
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

    const baseParams = {
      channel: 'h5',
      app_id: MBD_APP_ID,
      description: `物理虚拟实验 - ${vipType}`,
      amount_total: amountTotal,
      out_trade_no: outTradeNo,
    };

    const allResults = [];

    // 测试不同的 API 端点和参数组合
    const configs = [
      { label: 'newapi_fullkey', url: 'https://newapi.mbd.pub/release/wx/prepay', params: baseParams, key: MBD_APP_KEY },
      { label: 'api_fullkey', url: 'https://api.mbd.pub/release/wx/prepay', params: baseParams, key: MBD_APP_KEY },
      { label: 'newapi_nochannel', url: 'https://newapi.mbd.pub/release/wx/prepay', params: (() => { const { channel, ...r } = baseParams; return r; })(), key: MBD_APP_KEY },
      { label: 'api_nochannel', url: 'https://api.mbd.pub/release/wx/prepay', params: (() => { const { channel, ...r } = baseParams; return r; })(), key: MBD_APP_KEY },
      { label: 'newapi_chn', url: 'https://newapi.mbd.pub/release/wx/prepay', params: { ...baseParams, channel: 'wx_h5' }, key: MBD_APP_KEY },
    ];

    for (const cfg of configs) {
      const s = makeSign(cfg.params, cfg.key);
      const body = { ...cfg.params, sign: s.sign };

      console.log(`[create-order] ${cfg.label} -> ${cfg.url} | signStr: ${s.debug}`);

      const mbdRes = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const mbdData = await mbdRes.json();
      console.log(`[create-order] ${cfg.label} result:`, JSON.stringify(mbdData));

      allResults.push({ label: cfg.label, endpoint: cfg.url, signStr: s.debug, result: mbdData });

      if (mbdData.h5_url) {
        // 保存订单到 Supabase（非阻塞）
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
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
        } catch (e) {
          console.error('[create-order] save order error:', e.message);
        }
        return res.json({ success: true, h5_url: mbdData.h5_url, out_trade_no: outTradeNo, amount: amountTotal, via: cfg.label });
      }
    }

    return res.status(500).json({ error: '所有方案均失败', debug: allResults });
  } catch (e) {
    console.error('[create-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
