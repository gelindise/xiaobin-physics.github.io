// 面包多支付回调通知 (Webhook)
//
// ============ 安全模型（2026-10 安全整改） ============
//   面包多的异步通知【没有签名字段】，且官方要求回调 URL 不能携带任何参数
//   ⇒ 单靠「相信通知内容」无法防伪造（任何人只要知道自己的订单号，
//     就能伪造一条 charge_succeeded，不付钱拿到 VIP）。
//   官方推荐做法 = 收到通知后【主动向面包多查单】，以查单结果为准。
//   因此本函数依次做四件事，任何一项不过都不发货：
//     ① 通知里的 amount 必须与本地订单金额一致
//     ② 向 newapi.mbd.pub/release/main/search_order 查单，state 必须为已支付/已结算
//     ③ 查单返回的 amount 必须与本地订单金额一致
//     ④ 订单必须是 pending（天然去重：面包多会重复推送）
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MBD_DEV_KEY = process.env.MBD_DEVELOPER_KEY;          // 与 create-order 用的是同一个
const MBD_APP_ID = MBD_DEV_KEY ? MBD_DEV_KEY.split(':')[0] : '';
const MBD_APP_KEY = MBD_DEV_KEY || '';
const MBD_QUERY_URL = process.env.MBD_QUERY_URL || 'https://newapi.mbd.pub/release/main/search_order';

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}
// 与官方「签名算法」一致：非空参数按参数名 ASCII 字典序拼接 + &key=<app_key>，取 MD5
function sign(params, appkey) {
  const keys = Object.keys(params).filter(k => params[k] !== '' && params[k] != null).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join('&') + `&key=${appkey}`;
  return md5(str);
}

function svcHeaders(extra) {
  const h = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
  };
  if (extra) { for (const k in extra) h[k] = extra[k]; }
  return h;
}

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

  // 订单投诉通知：只记录，不涉及发货
  if (body.type === 'complaint') {
    console.log('[pay-callback] complaint:', JSON.stringify(body.data || {}));
    return res.json({ code: 'ignored' });
  }

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
    // ---------- 查本地订单（必须还是 pending） ----------
    const queryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${encodeURIComponent(outTradeNo)}&status=eq.pending&select=*`,
      { headers: svcHeaders({ Prefer: undefined }) }
    );
    const orders = await queryRes.json();
    if (!orders || orders.length === 0) {
      console.log('[pay-callback] order not found or already paid:', outTradeNo);
      return res.json({ code: 'order_not_found' });
    }

    const order = orders[0];
    const expectAmount = Number(order.amount);

    // ---------- ① 通知金额必须与本地订单一致 ----------
    if (webData.amount != null && Number(webData.amount) !== expectAmount) {
      console.error('[pay-callback] AMOUNT MISMATCH (notify):', webData.amount, '!=', expectAmount, outTradeNo);
      return res.json({ code: 'amount_mismatch' });
    }

    // ---------- ② 主动查单：以面包多的结果为准 ----------
    if (!MBD_APP_ID || !MBD_APP_KEY) {
      console.error('[pay-callback] MBD_DEVELOPER_KEY 未配置，无法二次查单，拒绝发货');
      return res.status(500).json({ code: 'not_configured' });
    }

    const queryParams = { app_id: MBD_APP_ID, out_trade_no: outTradeNo };
    queryParams.sign = sign(queryParams, MBD_APP_KEY);

    let remote;
    try {
      const r = await fetch(MBD_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryParams),
      });
      remote = await r.json();
    } catch (e) {
      // 查单网络异常 ⇒ 返回 500 让面包多重推，绝不凭通知发货
      console.error('[pay-callback] query order failed:', e.message);
      return res.status(500).json({ code: 'query_failed' });
    }

    if (!remote || remote.error || remote.state == null) {
      console.error('[pay-callback] query says no order / error:', JSON.stringify(remote));
      return res.json({ code: 'remote_not_paid' });
    }

    const remoteState = Number(remote.state);
    // 1=已支付 2=已结算 视为已付款；0=未支付，3/4/6=投诉中，5=投诉超时 ⇒ 不发货
    if (remoteState !== 1 && remoteState !== 2) {
      console.error('[pay-callback] remote state not paid:', remoteState, outTradeNo);
      return res.json({ code: 'remote_not_paid' });
    }

    // ---------- ③ 查单金额也必须一致 ----------
    if (remote.amount != null && parseInt(remote.amount, 10) !== expectAmount) {
      console.error('[pay-callback] AMOUNT MISMATCH (remote):', remote.amount, '!=', expectAmount, outTradeNo);
      return res.json({ code: 'amount_mismatch' });
    }

    // ---------- 通过全部校验，发货 ----------
    const now = new Date();
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

    // 更新订单状态（记录渠道流水号，便于对账与排查重复推送）
    await fetch(`${SUPABASE_URL}/rest/v1/orders?out_trade_no=eq.${encodeURIComponent(outTradeNo)}`, {
      method: 'PATCH',
      headers: svcHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status: 'paid',
        paid_at: now.toISOString(),
        charge_id: remote.charge_id || webData.charge_id || null,
        payway: remote.payway != null ? Number(remote.payway) : null,
        amount_paid: parseInt(remote.amount, 10) || expectAmount,
      }),
    });

    // 更新用户 VIP
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(order.username)}`,
      {
        method: 'PATCH',
        headers: svcHeaders({ Prefer: 'return=minimal' }),
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
