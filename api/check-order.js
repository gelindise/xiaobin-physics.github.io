// 轮询订单状态（前端定时调用）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const outTradeNo = req.query.out_trade_no;
  if (!outTradeNo) {
    return res.status(400).json({ error: '缺少 out_trade_no' });
  }

  try {
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${outTradeNo}&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const orders = await orderRes.json();
    if (!orders || orders.length === 0) {
      return res.json({ success: true, status: 'not_found' });
    }

    const order = orders[0];
    return res.json({
      success: true,
      status: order.status,
      vip_type: order.vip_type,
      paid_at: order.paid_at,
    });
  } catch (e) {
    console.error('[check-order] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
