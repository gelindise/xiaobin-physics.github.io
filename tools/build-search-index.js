// 生成 search-index.js：从 experiments.html 提取实验卡片 + 知识点图谱，产出静态索引
// 用法：node tools/build-search-index.js
// 新增/调整实验卡片后重跑一次即可（搜索排序只依赖这份索引，不读页面 DOM）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'experiments.html');

function extractExperiments() {
  const h = fs.readFileSync(HTML, 'utf8');
  const starts = [];
  const r = /<div class="card(?!-)/g;
  let m;
  while ((m = r.exec(h))) starts.push(m.index);

  const marks = [];
  const gRe = /<div id="(grade8a|grade8b|grade9)" class="grade-content/g;
  const cRe = /<h3 class="chapter-header"[^>]*>\s*([\s\S]*?)<span class="arrow">/g;
  const sRe = /<div class="section-header"[^>]*>\s*([\s\S]*?)<span class="arrow">/g;
  while ((m = gRe.exec(h))) marks.push({ i: m.index, t: 'g', v: m[1] });
  while ((m = cRe.exec(h))) marks.push({ i: m.index, t: 'c', v: m[1].replace(/\s+/g, ' ').trim() });
  while ((m = sRe.exec(h))) marks.push({ i: m.index, t: 's', v: m[1].replace(/\s+/g, ' ').trim() });
  marks.sort((a, b) => a.i - b.i);

  let cur = { g: '', c: '', s: '' }, mi = 0;
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k], end = k + 1 < starts.length ? starts[k + 1] : h.length;
    const blk = h.slice(start, end);
    while (mi < marks.length && marks[mi].i < start) { cur[marks[mi].t] = marks[mi].v; mi++; }
    const head = blk.slice(0, blk.indexOf('>') + 1);
    const cls = (head.match(/class="card([^"]*)"/) || [])[1] || '';
    const onclick = (head.match(/onclick="([^"]*)"/) || [])[1] || '';
    const title = (blk.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1] || '';
    const icon = (blk.match(/class="card-icon">([\s\S]*?)<\/div>/) || [])[1] || '';
    const tag = (blk.match(/class="tag[^"]*">([\s\S]*?)<\/p>/) || [])[1] || '';
    let desc = '';
    const pRe = /<p(?![^>]*class="tag")[^>]*>([\s\S]*?)<\/p>/g;
    const pm = pRe.exec(blk);
    if (pm) desc = pm[1];
    const url = (onclick.match(/['"]([^'"]+\.html)['"]/) || [])[1] || '';
    out.push({ g: cur.g, c: cur.c, s: cur.s, t: title.replace(/<[^>]+>/g, '').trim(), i: icon.trim(), tag: tag.trim(), d: desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), u: url, lock: /lock/.test(cls) });
  }

  const seen = new Map();
  for (const e of out) {
    if (!e.u) continue;
    if (!seen.has(e.u)) seen.set(e.u, e);
    else {
      const p = seen.get(e.u);
      if (!p.d && e.d) p.d = e.d;
      if (!p.s && e.s) p.s = e.s;
    }
  }
  return [...seen.values()];
}

const exps = extractExperiments();

// ===== 知识点图谱 =====
// id, n=名称, d=领域, a=别名（含口语/近义/教材说法）, r=相关概念[权重]
// dom:true 的条目只作为「领域入口」，不参与实验打标
const CONCEPTS = [
  // ---------- 力学：运动 ----------
  { id: 'yundong', n: '机械运动', d: '力学', a: ['参照物', '相对运动', '相对静止', '静止', '运动状态'], r: [['sudu', .8], ['changdu', .5]] },
  { id: 'changdu', n: '长度和时间的测量', d: '力学', a: ['长度测量', '刻度尺', '停表', '秒表', '读数', '误差', '测量工具'], r: [['yundong', .5], ['midu', .3]] },
  { id: 'sudu', n: '速度', d: '力学', a: ['快慢', '平均速度', '匀速直线运动', '路程', '速度公式'], r: [['yundong', .8], ['yundong_tuxiang', .7]] },
  { id: 'yundong_tuxiang', n: '运动图像', d: '力学', a: ['s-t图像', 'v-t图像', '图像分析', '频闪摄影', '频闪'], r: [['sudu', .9]] },

  // ---------- 声学 ----------
  { id: 'shengyin', n: '声音的产生与传播', d: '声学', a: ['声源', '振动', '传播', '介质', '真空铃', '真空不能传声'], r: [['shengsu', .8], ['shengbo', .8]] },
  { id: 'shengsu', n: '声速', d: '声学', a: ['340', '声速测量', '声音的速度'], r: [['shengyin', .8], ['huisheng', .8]] },
  { id: 'huisheng', n: '回声', d: '声学', a: ['回声测距', '回音', '声呐', '测距'], r: [['shengsu', .8], ['shengliyong', .6]] },
  { id: 'shengyin_texing', n: '声音的特性', d: '声学', a: ['音调', '响度', '音色', '频率', '振幅', '音品'], r: [['shengbo', .8], ['yueqi', .7]] },
  { id: 'shengbo', n: '声波', d: '声学', a: ['波形', '疏密波', '驻波', '波长', '波峰', '绳波'], r: [['shengyin', .8], ['shengyin_texing', .7]] },
  { id: 'yueqi', n: '乐器与音调', d: '声学', a: ['吉他', '琴弦', '弦乐器', '瓶子', '吹瓶', '和弦', '音阶', '十二平均律', '纯律'], r: [['shengyin_texing', .9], ['shengbo', .7]] },
  { id: 'zaosheng', n: '噪声', d: '声学', a: ['噪音', '分贝', '隔音', '消声', '噪声控制'], r: [['shengyin_texing', .5]] },
  { id: 'shengliyong', n: '声的利用', d: '声学', a: ['超声波', '次声波', '清洗', 'B超', '碎石', '多普勒', '测速雷达'], r: [['huisheng', .7], ['shengsu', .6]] },

  // ---------- 热学 ----------
  { id: 'wendu', n: '温度', d: '热学', a: ['温度计', '摄氏度', '体温计', '量程', '分度值'], r: [['ronghua', .5], ['qihua', .5]] },
  { id: 'wutai', n: '物态变化', d: '热学', a: ['物态变化', '三态', '状态变化'], r: [['ronghua', .8], ['qihua', .8], ['shenghua', .7]] },
  { id: 'ronghua', n: '熔化和凝固', d: '热学', a: ['熔化', '凝固', '晶体', '非晶体', '熔点', '冰化', '凝固点'], r: [['wendu', .6], ['wutai', .8]] },
  { id: 'qihua', n: '汽化和液化', d: '热学', a: ['汽化', '蒸发', '沸腾', '液化', '开水', '烧开', '白气', '水蒸气', '沸点', '致冷', '下雨', '雨', '白雾'], r: [['wendu', .6], ['wutai', .8]] },
  { id: 'shenghua', n: '升华和凝华', d: '热学', a: ['升华', '凝华', '干冰', '霜', '碘', '雾凇'], r: [['wutai', .8]] },
  { id: 'neineng', n: '内能', d: '热学', a: ['内能', '热传递', '做功改变内能', '温度升高', '热量'], r: [['fenzi', .8], ['bire', .7]] },
  { id: 'fenzi', n: '分子热运动', d: '热学', a: ['分子', '扩散', '热运动', '布朗运动', '分子间作用力'], r: [['neineng', .8], ['wutai', .5]] },
  { id: 'bire', n: '比热容', d: '热学', a: ['比热容', '升温曲线', '水的比热', 'Q=cm'], r: [['neineng', .8], ['reqi', .5]] },
  { id: 'reqi', n: '热机', d: '热学', a: ['汽油机', '柴油机', '四冲程', '内燃机', '吸气冲程', '压缩冲程', '做功冲程', '排气冲程'], r: [['rexiaolv', .8], ['neineng', .6]] },
  { id: 'rexiaolv', n: '热机效率', d: '热学', a: ['热值', '效率', '永动机', '能量流向'], r: [['reqi', .8], ['nengliang', .7]] },
  { id: 'nengliang', n: '能量的转化和守恒', d: '热学', a: ['能量守恒', '能量转化', '转化和守恒'], r: [['jixie_neng', .7], ['rexiaolv', .6]] },

  // ---------- 光学 ----------
  { id: 'guangsu', n: '光的直线传播', d: '光学', a: ['直线传播', '光速', '光年', '光线', '光沿直线'], r: [['yingzi', .8], ['xiaokong', .8]] },
  { id: 'yingzi', n: '影子与日月食', d: '光学', a: ['影子', '日食', '月食', '影锥', '本影', '半影', '树影'], r: [['guangsu', .9]] },
  { id: 'xiaokong', n: '小孔成像', d: '光学', a: ['小孔', '倒立实像', '针孔'], r: [['guangsu', .9]] },
  { id: 'fanshe', n: '光的反射', d: '光学', a: ['反射', '入射角', '反射角', '镜面反射', '漫反射', '光路可逆', '法线'], r: [['pingmianjing', .8], ['zheshe', .6]] },
  { id: 'pingmianjing', n: '平面镜成像', d: '光学', a: ['平面镜', '镜子', '照镜子', '虚像', '全身像', '像与物'], r: [['fanshe', .9], ['qiumianjing', .5]] },
  { id: 'qiumianjing', n: '球面镜', d: '光学', a: ['凸面镜', '凹面镜', '后视镜', '球面镜'], r: [['pingmianjing', .6], ['fanshe', .7]] },
  { id: 'qianwangjing', n: '潜望镜', d: '光学', a: ['潜望镜', '两次反射'], r: [['pingmianjing', .8], ['fanshe', .7]] },
  { id: 'zheshe', n: '光的折射', d: '光学', a: ['折射', '看鱼', '水变浅', '筷子', '折射率', '池水'], r: [['fanshe', .6], ['toujing', .7]] },
  { id: 'sesan', n: '光的色散', d: '光学', a: ['色散', '彩虹', '三棱镜', '光谱', '红外线', '紫外线', '三原色', '色光'], r: [['guangsu', .5]] },
  { id: 'toujing', n: '透镜', d: '光学', a: ['凸透镜', '凹透镜', '焦点', '焦距', '主光轴', '会聚', '发散'], r: [['tujing_chengxiang', .9], ['zheshe', .7]] },
  { id: 'tujing_chengxiang', n: '凸透镜成像', d: '光学', a: ['凸透镜成像', '成像规律', '物距', '像距', '放大', '缩小', '一倍焦距', '二倍焦距'], r: [['toujing', .9], ['shenghuo_toujing', .8], ['yanjing', .7]] },
  { id: 'shenghuo_toujing', n: '生活中的透镜', d: '光学', a: ['照相机', '投影仪', '放大镜', '镜头', '光圈', '对焦'], r: [['tujing_chengxiang', .9]] },
  { id: 'yanjing', n: '眼睛和眼镜', d: '光学', a: ['眼睛', '近视', '远视', '眼镜', '视网膜', '晶状体', '度数', '视力'], r: [['tujing_chengxiang', .8], ['toujing', .7]] },
  { id: 'xianweijing', n: '显微镜和望远镜', d: '光学', a: ['显微镜', '望远镜', '目镜', '物镜'], r: [['tujing_chengxiang', .8], ['toujing', .7]] },

  // ---------- 质量密度 ----------
  { id: 'zhiliang', n: '质量', d: '力学', a: ['质量', '属性', '千克', '物体的质量'], r: [['tianping', .8], ['midu', .7]] },
  { id: 'tianping', n: '托盘天平', d: '力学', a: ['天平', '托盘天平', '砝码', '游码', '平衡螺母', '称量'], r: [['zhiliang', .9]] },
  { id: 'midu', n: '密度', d: '力学', a: ['密度', '物质鉴别', '密度表', '反常膨胀', '质量与体积'], r: [['zhiliang', .7], ['fuli', .7], ['ajmd', .6]] },
  { id: 'celiang_midu', n: '测量物质的密度', d: '力学', a: ['量筒', '排水法', '测密度', '测量密度'], r: [['midu', .9], ['zhiliang', .5]] },

  // ---------- 力 ----------
  { id: 'li', n: '力', d: '力学', a: ['力的作用效果', '三要素', '力的示意图', '相互作用', '施力', '受力'], r: [['zhongli', .6], ['tanli', .6], ['moca', .6]] },
  { id: 'tanli', n: '弹力', d: '力学', a: ['弹力', '弹簧', '胡克定律', '弹性形变', '弹簧测力计'], r: [['li', .6], ['zhongli', .4]] },
  { id: 'zhongli', n: '重力', d: '力学', a: ['重力', '重量', '竖直向下', '重心', '地球吸引'], r: [['zhiliang', .7], ['li', .6]] },
  { id: 'niudun1', n: '牛顿第一定律', d: '力学', a: ['惯性', '牛顿第一定律', '伽利略', '阻力', '刹车', '急刹车', '安全带'], r: [['erli_pingheng', .6], ['moca', .6]] },
  { id: 'erli_hecheng', n: '二力合成', d: '力学', a: ['合力', '二力合成', '同一直线', '等效替代'], r: [['erli_pingheng', .7], ['li', .5]] },
  { id: 'erli_pingheng', n: '二力平衡', d: '力学', a: ['平衡', '二力平衡', '匀速直线', '受力分析', '传送带'], r: [['niudun1', .6], ['moca', .7]] },
  { id: 'moca', n: '摩擦力', d: '力学', a: ['摩擦', '滑动摩擦', '静摩擦', '粗糙', '接触面'], r: [['erli_pingheng', .7], ['li', .6]] },

  // ---------- 压强浮力 ----------
  { id: 'yq', n: '压强', d: '力学', a: ['压力', '受力面积', '压力的作用效果', 'p=F/S'], r: [['yeti_yq', .8], ['daqi_yq', .6]] },
  { id: 'yeti_yq', n: '液体压强', d: '力学', a: ['液体压强', '深度', '连通器', '船闸', '压强计', '液体压力'], r: [['yq', .8], ['fuli', .6], ['daqi_yq', .5]] },
  { id: 'daqi_yq', n: '大气压强', d: '力学', a: ['大气压', '托里拆利', '马德堡', '覆杯', '吸盘', '瓶吞蛋', '注射器', '水银柱'], r: [['yq', .7], ['yeti_yq', .5]] },
  { id: 'liuti_yq', n: '流体压强与流速', d: '力学', a: ['流速', '伯努利', '升力', '机翼', '文丘里', '~飞机', '流线'], r: [['yq', .8], ['daqi_yq', .4]] },
  { id: 'fuli', n: '浮力', d: '力学', a: ['浮力', '浮起来', '称重法', '排开', '浮力产生'], r: [['ajmd', .9], ['fuchen', .9], ['midu', .7], ['yeti_yq', .6]] },
  { id: 'ajmd', n: '阿基米德原理', d: '力学', a: ['阿基米德', '排开液体', '溢水杯', '王冠'], r: [['fuli', .9], ['midu', .7]] },
  { id: 'fuchen', n: '物体的浮沉条件', d: '力学', a: ['浮沉', '漂浮', '悬浮', '下沉', '上浮', '潜水艇', '轮船', '吃水线', '密度计', '~气球', '飞艇'], r: [['fuli', .9], ['midu', .8], ['ajmd', .7]] },

  // ---------- 功和能 ----------
  { id: 'gong', n: '功', d: '力学', a: ['做功', '不做功', '推箱子'], r: [['gonglv', .8], ['jixie_neng', .6]] },
  { id: 'gonglv', n: '功率', d: '力学', a: ['爬楼', '做功快慢'], r: [['gong', .8]] },
  { id: 'dongneng', n: '动能和势能', d: '力学', a: ['动能', '重力势能', '弹性势能', '影响因素'], r: [['jixie_neng', .9], ['gong', .5]] },
  { id: 'jixie_neng', n: '机械能及其转化', d: '力学', a: ['机械能', '能量转化', '滚摆', '单摆', '卫星', '蹦极', '弹簧振子', '魔罐'], r: [['dongneng', .9], ['gong', .5], ['nengliang', .6]] },

  // ---------- 简单机械 ----------
  { id: 'ganggan', n: '杠杆', d: '力学', a: ['力臂', '杠杆平衡', '省力', '杆秤', '跷跷板', '支点', '动力臂', '阻力臂', '最小力'], r: [['huallun', .6], ['gong', .4]] },
  { id: 'huallun', n: '滑轮', d: '力学', a: ['定滑轮', '动滑轮', '滑轮组', '机械效率'], r: [['ganggan', .7], ['gong', .6]] },

  // ---------- 电学 ----------
  { id: 'dianhe', n: '两种电荷', d: '电学', a: ['电荷', '正电荷', '负电荷', '摩擦起电', '验电器', '静电', '莱顿瓶', '同种电荷', '异种电荷'], r: [['daoti', .7], ['dianlu', .6]] },
  { id: 'daoti', n: '导体和绝缘体', d: '电学', a: ['导体', '绝缘体', '导电', '自由电子'], r: [['dianhe', .7], ['dianzu', .7]] },
  { id: 'dianlu', n: '电流和电路', d: '电学', a: ['电路', '电路图', '实物图', '通路', '断路', '短路', '电源', '小灯泡', '手电筒', '电池'], r: [['chuanbing', .8], ['dianliubiao', .7], ['dianya', .7]] },
  { id: 'chuanbing', n: '串联和并联', d: '电学', a: ['串联', '并联', '干路', '支路', '双联开关', '楼梯灯'], r: [['dianlu', .8], ['dianliu_guilv', .8], ['dianya_guilv', .8]] },
  { id: 'dianliubiao', n: '电流的测量', d: '电学', a: ['电流表', '量程', '接线柱'], r: [['dianlu', .7], ['dianliu_guilv', .6]] },
  { id: 'dianliu_guilv', n: '串并联电流规律', d: '电学', a: ['电流规律', '干路电流', '支路电流'], r: [['chuanbing', .8]] },
  { id: 'dianya', n: '电压', d: '电学', a: ['电压表', '伏特', '电压的作用'], r: [['dianlu', .7], ['dianya_guilv', .8], ['dianzu', .7]] },
  { id: 'dianya_guilv', n: '串并联电压规律', d: '电学', a: ['电压规律', '串联分压', '并联同压'], r: [['dianya', .8], ['chuanbing', .8]] },
  { id: 'dianzu', n: '电阻', d: '电学', a: ['电阻大小', '材料', '横截面积', '变阻器', '滑动变阻器'], r: [['oumu', .9], ['fuanfa', .8]] },
  { id: 'oumu', n: '欧姆定律', d: '电学', a: ['欧姆定律', '电流与电压', '电流与电阻'], r: [['dianzu', .9], ['fuanfa', .8]] },
  { id: 'fuanfa', n: '伏安法测电阻', d: '电学', a: ['伏安法', '测电阻'], r: [['oumu', .8], ['dianzu', .8]] },
  { id: 'dianneng', n: '电能与电功', d: '电学', a: ['电能', '电功', '电能表', '电费', '度电', '千瓦时'], r: [['diangonglv', .8]] },
  { id: 'diangonglv', n: '电功率', d: '电学', a: ['额定功率', '实际功率', '灯泡亮度', '变亮', '亮度'], r: [['dianneng', .8], ['jiaoer', .7]] },
  { id: 'jiaoer', n: '焦耳定律', d: '电学', a: ['焦耳定律', '电热', '发热', '高压输电'], r: [['diangonglv', .7], ['dianzu', .6]] },
  { id: 'jiating', n: '家庭电路', d: '电学', a: ['家庭电路', '火线', '零线', '地线', '漏电', '空气开关', '配电箱', '三孔插座', '跳闸'], r: [['dianliu_guoda', .8], ['anquan', .8]] },
  { id: 'dianliu_guoda', n: '电流过大的原因', d: '电学', a: ['过载', '保险丝', '总功率过大', '短路'], r: [['jiating', .8], ['jiaoer', .6]] },
  { id: 'anquan', n: '安全用电', d: '电学', a: ['触电', '安全用电', '接地', '人体电流'], r: [['jiating', .8]] },

  // ---------- 磁学 ----------
  { id: 'cixianxiang', n: '磁现象与磁场', d: '磁学', a: ['磁铁', '磁感线', '磁场', '磁极', '指南针', '条形磁铁', '蹄形磁铁', '地球磁场', '极光', '太阳风'], r: [['cihua', .6], ['dianshengci', .7]] },
  { id: 'cihua', n: '磁化', d: '磁学', a: ['磁化', '磁畴', '退磁', '铁钉'], r: [['cixianxiang', .8]] },
  { id: 'dianshengci', n: '电生磁', d: '磁学', a: ['奥斯特', '电流磁效应', '通电螺线管', '右手螺旋', '安培定则'], r: [['cixianxiang', .7], ['diancitie', .8]] },
  { id: 'diancitie', n: '电磁铁', d: '磁学', a: ['电磁铁', '匝数', '铁芯', '磁性强弱', '大头针'], r: [['dianshengci', .8], ['jidianqi', .8]] },
  { id: 'jidianqi', n: '电磁继电器', d: '磁学', a: ['继电器', '衔铁', '触点', '报警器', '电铃'], r: [['diancitie', .8], ['jiating', .4]] },
  { id: 'diandongji', n: '电动机', d: '磁学', a: ['电动机', '马达', '换向器', '通电线圈'], r: [['cilian', .9], ['cishengdian', .6]] },
  { id: 'cilian', n: '磁场对电流的作用', d: '磁学', a: ['洛伦兹力', '安培力', '通电导体', '左手定则'], r: [['diandongji', .9], ['cixianxiang', .6]] },
  { id: 'cishengdian', n: '磁生电', d: '磁学', a: ['电磁感应', '法拉第', '感应电流', '切割磁感线'], r: [['fadianji', .9], ['cixianxiang', .7]] },
  { id: 'fadianji', n: '发电机', d: '磁学', a: ['发电机', '交流电'], r: [['cishengdian', .9]] },
  { id: 'yangshengqi', n: '扬声器与麦克风', d: '磁学', a: ['扬声器', '喇叭', '麦克风', '话筒'], r: [['diandongji', .7], ['cishengdian', .7]] },

  // ---------- 原子 / 工具 ----------
  { id: 'yuanzi', n: '原子结构', d: '原子', a: ['原子', '原子核', '质子', '中子', '卢瑟福', '核式结构', '元素', '电子壳层'], r: [['fenzi', .6]] },
  { id: 'shuju', n: '实验数据处理', d: '工具', a: ['数据处理', '描点', '连线', '拟合', '数据表'], r: [['changdu', .5]] },
  { id: 'shipin', n: '视频解析', d: '工具', a: ['视频解析', '下载视频', 'B站', '抖音', '快手'], r: [] },

  // ---------- 领域入口（不参与打标） ----------
  { id: 'dom_lx', n: '力学', d: '力学', dom: true, a: ['力学', '机械', '简单机械'], r: [] },
  { id: 'dom_sx', n: '声学', d: '声学', dom: true, a: ['声学', '声音', '音频', '声现象'], r: [] },
  { id: 'dom_rx', n: '热学', d: '热学', dom: true, a: ['热学', '热现象', '物态', '热'], r: [] },
  { id: 'dom_gx', n: '光学', d: '光学', dom: true, a: ['光学', '光现象', '光'], r: [] },
  { id: 'dom_dx', n: '电学', d: '电学', dom: true, a: ['电学', '电', '用电'], r: [] },
  { id: 'dom_cx', n: '磁学', d: '磁学', dom: true, a: ['磁学', '电磁', '磁'], r: [] },
  { id: 'dom_yz', n: '原子', d: '原子', dom: true, a: ['原子物理', '微观世界', '粒子'], r: [] },
];

const byId = new Map(CONCEPTS.map(c => [c.id, c]));
for (const c of CONCEPTS) for (const [rid] of c.r) if (!byId.has(rid)) throw new Error('related 指向不存在: ' + c.id + ' -> ' + rid);

const DOMAIN_ORDER = ['力学', '声学', '热学', '光学', '电学', '磁学', '原子', '工具'];
const GRADE_LABEL = { grade8a: '八年级上册', grade8b: '八年级下册', grade9: '九年级全一册' };

// 自动打标：最长匹配优先，避免「电功率」被「功率」抢走
function autoKp(e) {
  const fields = [
    { w: 1.3, text: e.t, fi: 0 },
    { w: 1.1, text: e.s, fi: 1 },
    { w: .95, text: e.c, fi: 2 },
  ];
  const hits = [];
  for (const c of CONCEPTS) {
    if (c.dom) continue;
    const words = [c.n, ...c.a].filter(w => w && w.length >= 2 && w.charAt(0) !== '~');
    for (const w of words) {
      for (const f of fields) {
        if (!f.text) continue;
        let from = 0, idx;
        while ((idx = f.text.indexOf(w, from)) !== -1) {
          hits.push({ id: c.id, w: f.w, len: w.length, s: idx, e: idx + w.length, fi: f.fi });
          from = idx + 1;
        }
      }
    }
  }
  // 长词优先占位
  hits.sort((a, b) => b.len - a.len || b.w - a.w);
  const taken = [];
  const kp = new Map();
  for (const h of hits) {
    const clash = taken.some(t => t.fi === h.fi && t.id !== h.id && !(h.e <= t.s || h.s >= t.e));
    if (clash) continue;
    taken.push(h);
    kp.set(h.id, Math.max(kp.get(h.id) || 0, h.w));
  }
  return [...kp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
}

function domainOf(e){
  var c = e.c || '', sec = e.s || '';
  if (/声现象/.test(c)) return '声学';
  if (/物态变化|内能|内能的利用/.test(c)) return '热学';
  if (/光现象|透镜/.test(c)) return '光学';
  if (/电与磁/.test(c)) return '磁学';
  if (/电流和电路|电压 电阻|欧姆定律|电功率|生活用电/.test(c)) return '电学';
  if (/原子/.test(c) || /原子/.test(sec)) return '原子';
  if (/机械运动|力$|运动和力|压强|浮力|功和机械能|简单机械|质量与密度/.test(c)) return '力学';
  return '';
}

const experiments = exps.map(e => {
  const k = autoKp(e);
  return {
    u: e.u,
    t: e.t,
    c: e.c,
    s: e.s,
    g: GRADE_LABEL[e.g] || '',
    i: e.i || '',
    v: e.lock ? 1 : 0,
    d: (e.d || '').slice(0, 90),
    k,
    dm: domainOf(e) || (k.length && byId.get(k[0]) ? byId.get(k[0]).d : ''),
  };
}).filter(e => e.t);

// 领域统计（用于「按领域浏览」）
const domains = DOMAIN_ORDER.map(d => ({ n: d, k: experiments.filter(e => (byId.get(e.k[0] || '') || {}).d === d).length })).filter(x => x.k > 0);

const out = `/* 知识点索引 · 由 tools/build-search-index.js 生成，勿手改
   数据源：experiments.html 的实验卡片 + 本文件 concepts 知识图谱
   用途：首页 / 实验列表页的「按知识点相关度」搜索 */
window.PHYS_SEARCH_INDEX = {
  version: '2026-10-18',
  concepts: ${JSON.stringify(CONCEPTS.map(c => ({ id: c.id, n: c.n, d: c.d, a: c.a, r: c.r, dom: !!c.dom })))},
  experiments: ${JSON.stringify(experiments)}
};
`;
fs.writeFileSync(path.join(ROOT, 'search-index.js'), out);
console.log('卡片', exps.length, 'concepts', CONCEPTS.length, 'experiments', experiments.length, 'bytes', out.length);
const noKp = experiments.filter(e => !e.k.length);
console.log('无知识点', noKp.length, noKp.slice(0, 8).map(e => e.t));
for (const e of experiments.slice(0, 5)) console.log(e.t, '=>', e.k.map(id => byId.get(id).n).join('/'));

