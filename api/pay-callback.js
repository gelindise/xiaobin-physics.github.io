// 面包多支付回调通知 (Webhook)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try {
    // 面包多发 JSON POST
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch (e) {
    console.error('[pay-callback] parse error:', e.message);
    return res.status(400).json({ code: 'parse_error' });
  }

  console.log('[pay-callback] received:', JSON.stringify(body));

  // 面包多 webhook 格式: { type: "charge_succeeded", data: { out_trade_no, amount, charge_id, payway, ... } }
  if (body.type !== 'charge_succeeded') {
    console.log('[pay-callback] ignored type:', body.type);
    return res.json({ code: 'ignored' });
  }

  const webData = body.data;
  if (!webData || !webData.out_trade_no) {
    console.error('[pay-callback] missing data.out_trade_no');
    return res.json({ code: 'missing_data' });
  }

  const outTradeNo = webData.out_trade_no;

  try {
    // 查询订单
    const queryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${outTradeNo}&status=eq.pending&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const orders = await queryRes.json();
    if (!orders || orders.length === 0) {
      console.log('[pay-callback] order not found or already paid:', outTradeNo);
      return res.json({ code: 'order_not_found' });
    }

    const order = orders[0];
    const now = new Date();

    // 计算到期时间
    let expireDate;
    if (order.vip_type === '月度VIP') {
      const d = new Date(now); d.setDate(d.getDate() + 30);
      expireDate = d.toISOString().split('T')[0];
    } else if (order.vip_type === '年度VIP') {
      const d = new Date(now); d.setDate(d.getDate() + 365);
      expireDate = d.toISOString().split('T')[0];
    } else {
      expireDate = '永久';
    }

    // 更新订单状态
    await fetch(`${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${outTradeNo}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ status: 'paid', paid_at: now.toISOString() }),
    });

    // 更新用户 VIP
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?username=eq.${order.username}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ vip: order.vip_type, expire: expireDate }),
      }
    );

    if (!userRes.ok) {
      console.error('[pay-callback] update user failed:', await userRes.text());
      return res.json({ code: 'update_failed' });
    }

    console.log(`[pay-callback] SUCCESS: ${order.username} → ${order.vip_type} (${expireDate})`);
    return res.json({ code: 'success' });
  } catch (e) {
    console.error('[pay-callback] error:', e);
    return res.status(500).json({ code: 'error', message: e.message });
  }
};
