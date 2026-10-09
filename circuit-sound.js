/* 电路实验沙盒 · 音效引擎 circuit-sound.js
 *
 * 全部音色【现场合成】，不带任何音频素材文件。理由有三条：
 *   ① 沙盒页是单文件、离线可用的教具，多一个 .mp3 就多一个 404 的可能，
 *      也躲不开「学生机上没声音」这类查不出来的问题；
 *   ② 真实器材的声音本来就该跟着状态变 —— 电铃的敲击快慢、开关闭合与断开
 *      的低沉与清脆，用素材只能拼，用合成可以按状态连续调；
 *   ③ 一个 .js 文件（~10KB）比一串音频文件好维护，也没有版权问题。
 *
 * 三个必须守住的边界：
 *   · 【不碰仿真】这个模块只读状态、只出声。它拿不到 scene / results 的写权，
 *     页面传进来的也只是一句「铃在响」的布尔量。音效出了任何问题，物理必须照旧。
 *   · 【不碰画面】不注册任何绘制，不改任何 canvas。
 *   · 【浏览器自动播放策略】AudioContext 一律懒创建 —— 页面载入时不建，
 *     等第一次真实手势（pointerdown / keydown）才建。载入即建会被 Chrome 挂在
 *     suspended 上，还可能记一条控制台警告，把「页面无报错」这条自检弄红。
 *     载入之前发生的动作照旧【记账】但不排声，返回值是 'locked' 而不是装作播过。
 *
 * 对外只暴露 create()，实例上的 trigger() 是所有一次性音效的唯一入口，
 * setState() 是持续音（电铃）的唯一入口。自检靠 stats() 看账，不靠听。
 */
(function (root) {
  'use strict';

  var VERSION = '1.1.0';

  // 电铃每秒敲击次数。真实电铃是衔铁被电磁铁吸住、触点断开、弹回、再吸住……
  // 这样一个自激振动，几十赫兹。低于 15 次/秒就听成一下一下的敲钟，
  // 高过 40 次/秒就糊成一片蜂鸣 —— 26 正好是「铃」而不是「钟」也不是「蜂鸣器」。
  var BELL_RATE = 26;
  var BELL_BASE = 690;                                  // 铃碗基频
  // 金属圆盘的分音【不是整数倍】。用 1:2:3:4 会听成钢琴上的一个音，
  // 一点都不像铃；下面这组（1 : 1.87 : 2.61 : 3.42 : 4.51）是钟/铃碗的典型比例。
  var BELL_RATIOS = [1, 1.87, 2.61, 3.42, 4.51];
  var BELL_AMPS = [0.50, 0.30, 0.20, 0.13, 0.08];
  var BELL_PEAK = 0.42;

  var PUMP_MS = 25;        // 调度器轮询间隔
  var LOOKAHEAD = 0.10;    // 提前排声的时间窗（秒）
  var BELL_TAIL = 0.052;   // 一次敲击的余韵（秒）

  function create(opts) {
    opts = opts || {};
    var AC = root.AudioContext || root.webkitAudioContext;

    var ctx = null, out = null, noiseBuf = null;
    var enabled = opts.enabled !== false;
    var volume = opts.volume == null ? 0.6 : opts.volume;

    // 账本：actions = 有几次「该响」，plays = 真的排了几次声。
    // 两者分开记，是为了让「没响」这件事可查 —— 分不清「没触发」和「触发了没排声」，
    // 自检就只能靠耳朵。
    var actions = {}, plays = {}, lastRes = {};

    var wantBell = false;    // 电路状态要求铃响
    var bellTimer = null;    // 调度器句柄（非 null = 持续音在跑）
    var bellNext = 0;
    var strikes = 0;
    var wasShorted = false;
    var hidden = false;

    // ── 音频上下文 ───────────────────────────────────────────
    function ensure() {
      if (ctx) return ctx;
      if (!AC) return null;
      try {
        ctx = new AC();
        out = ctx.createGain();
        out.gain.value = volume;
        // 限幅器：电铃每秒排 26 组、每组 5 个分音，再叠上开关声，峰值很容易顶到
        // 削波。削波听上去是「噼」的一声杂音，比小声难听得多。
        if (ctx.createDynamicsCompressor) {
          var comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -12;
          comp.knee.value = 12;
          comp.ratio.value = 6;
          comp.attack.value = 0.003;
          comp.release.value = 0.12;
          out.connect(comp); comp.connect(ctx.destination);
        } else {
          out.connect(ctx.destination);
        }
      } catch (e) { ctx = null; out = null; }
      return ctx;
    }

    // 第一次真实手势时调用。幂等 —— 手势监听器一直挂着，是为了 AudioContext
    // 被系统挂起（长时间无操作、来电）之后还能被下一次手势救回来。
    function unlock() {
      if (!ensure()) return false;
      try {
        var pr = (ctx.state === 'suspended' && ctx.resume) ? ctx.resume() : null;
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
      syncBell();            // 解锁前电路要是本来就该响铃，补上
      return true;
    }

    // ── 小工具：一段带包络的振荡器 ───────────────────────────
    // attack 一律很短：打击声不是拉弦，起音慢了就不像「敲」。
    // 衰减走指数：线性衰减听上去像被人掐掉了尾巴。
    // 收尾一律 onended 断开：铃每秒排 26 组、每组 5 个分音，一节课下来是几万个
    // 节点。不显式断的话全靠 GC 兜底，而这条链路正好是「一节课挂着不管」的用法。
    function tone(t0, f0, f1, dur, type, peak) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && Math.abs(f1 - f0) > 1e-6)
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      var atk = Math.min(0.005, dur * 0.25);
      g.gain.setValueAtTime(1e-4, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak), t0 + atk);
      g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
      o.connect(g); g.connect(out);
      o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
      o.start(t0); o.stop(t0 + dur + 0.03);
    }

    // ── 小工具：一段过滤波器的噪声 ───────────────────────────
    // 金属撞击的「脆」全在这上面。只用振荡器做打击声，出来的是电子游戏音。
    function burst(t0, dur, peak, f) {
      var s = ctx.createBufferSource();
      s.buffer = noise(); s.loop = true;
      var node = s;
      if (f) {
        var bq = ctx.createBiquadFilter();
        bq.type = f.type || 'bandpass';
        bq.frequency.setValueAtTime(Math.max(20, f.freq || 2000), t0);
        if (f.freq1) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f.freq1), t0 + dur);
        bq.Q.value = f.Q == null ? 1 : f.Q;
        s.connect(bq); node = bq;
      }
      var g = ctx.createGain();
      g.gain.setValueAtTime(1e-4, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak), t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
      node.connect(g); g.connect(out);
      s.onended = function () { try { s.disconnect(); node.disconnect(); g.disconnect(); } catch (e) {} };
      s.start(t0); s.stop(t0 + dur + 0.03);
    }

    function noise() {
      if (noiseBuf) return noiseBuf;
      var n = Math.max(1, Math.floor(ctx.sampleRate * 0.4));
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    // ── 音色 ────────────────────────────────────────────────
    // 开关闭合 / 断开。两个方向必须【听得出来不一样】—— 学生闭眼操作时得能靠
    // 声音知道现在是通还是断。闭合：刀片撞到底，更沉更实；断开：刀片被弹起，
    // 略高、略短、带一点金属弹开的上滑。
    function vSwitch(t0, closed) {
      burst(t0, closed ? 0.034 : 0.026, closed ? 0.50 : 0.36,
            { type: 'bandpass', freq: closed ? 2400 : 3300,
              freq1: closed ? 800 : 1500, Q: 0.9 });
      tone(t0, closed ? 200 : 265, closed ? 92 : 140,
           closed ? 0.085 : 0.06, 'sine', closed ? 0.34 : 0.24);
      tone(t0 + 0.004, closed ? 3100 : 3900, closed ? 2500 : 3300, 0.045, 'triangle', 0.09);
    }

    // 插头推进接线柱：闷而短的「咔」。
    function vPlug(t0) {
      burst(t0, 0.026, 0.40, { type: 'bandpass', freq: 1700, freq1: 620, Q: 1.2 });
      tone(t0, 150, 86, 0.05, 'sine', 0.26);
      tone(t0 + 0.003, 2300, 1900, 0.028, 'triangle', 0.08);
    }

    // 从接线柱拔出来：先一声轻「啵」，尾巴往上滑（摩擦力松开的那一下）。
    function vUnplug(t0) {
      burst(t0, 0.030, 0.34, { type: 'bandpass', freq: 850, freq1: 2500, Q: 1.2 });
      tone(t0, 118, 205, 0.05, 'sine', 0.20);
      tone(t0 + 0.002, 1850, 2800, 0.032, 'triangle', 0.10);
    }

    // 元件放到实验台上：木头/塑料的「笃」。
    function vPlace(t0) {
      burst(t0, 0.028, 0.26, { type: 'lowpass', freq: 1300, freq1: 480, Q: 0.7 });
      tone(t0, 330, 155, 0.085, 'sine', 0.28);
    }

    // 元件从台上拿走：同一个「笃」但往下走、更轻。
    function vRemove(t0) {
      burst(t0, 0.045, 0.20, { type: 'lowpass', freq: 1500, freq1: 320, Q: 0.8 });
      tone(t0, 270, 110, 0.095, 'sine', 0.20);
    }

    // 撤销：一声往下滑的轻响，和「放上去」区分开。
    function vUndo(t0) {
      burst(t0, 0.10, 0.16, { type: 'lowpass', freq: 2600, freq1: 420, Q: 1.4 });
      tone(t0, 620, 300, 0.10, 'triangle', 0.10);
    }

    // 短路打火：一串长短不一的爆裂。整齐的一声「啪」听起来像按了个按钮，
    // 不像电弧 —— 电弧本来就是断续、不均匀的。
    function vSpark(t0) {
      for (var i = 0; i < 6; i++) {
        var dt = i * 0.012 + Math.random() * 0.010;
        burst(t0 + dt, 0.012 + Math.random() * 0.022, 0.20 * (1 - i * 0.12),
              { type: 'highpass', freq: 2000 + Math.random() * 2000, Q: 0.7 });
      }
      tone(t0, 96, 58, 0.16, 'square', 0.09);
    }

    // 「警告」：两声【下行】的短鸣。这是整页唯一一个「操作错了」的声音，
    // 必须和别的音效在【第一耳朵】上就分得开 —— 前面那些都是撞击/摩擦类的
    // 瞬态（一声就完），而这个是两声、有音高、还往下走：往下走是「不行」，
    // 往上走会听成「完成」。用 triangle 而不是 square：方波在这套合成器里
    // 是打火用的，混起来会以为是电路又短了。
    // 两声之间留 0.16 s：再密就听成一声长鸣，再疏就不像一句话了。
    function vWarn(t0) {
      tone(t0, 988, 988, 0.085, 'triangle', 0.26);
      tone(t0 + 0.16, 740, 740, 0.13, 'triangle', 0.24);
      // 每声底下垫一点带通噪声，像表壳里那只小蜂鸣片的沙音
      burst(t0, 0.075, 0.10, { type: 'bandpass', freq: 2600, freq1: 1900, Q: 1.6 });
      burst(t0 + 0.16, 0.12, 0.09, { type: 'bandpass', freq: 2100, freq1: 1500, Q: 1.6 });
    }

    // 电铃的「一次敲击」：铃碗的分音 + 铃锤打在碗上的那一下「嗒」。
    function strike(t0, peak) {
      strikes++;
      for (var i = 0; i < BELL_RATIOS.length; i++) {
        var f = BELL_BASE * BELL_RATIOS[i];
        tone(t0, f, f * 0.995, BELL_TAIL + i * 0.004, 'sine', peak * BELL_AMPS[i]);
      }
      burst(t0, 0.012, peak * 0.30, { type: 'bandpass', freq: 4200, freq1: 2600, Q: 0.8 });
    }

    var VOICES = {
      'switch': vSwitch,
      plug: vPlug,
      unplug: vUnplug,
      place: vPlace,
      remove: vRemove,
      undo: vUndo,
      spark: vSpark,
      warn: vWarn,
    };

    // ── 一次性音效的唯一入口 ─────────────────────────────────
    // 返回值是要点：'played' / 'muted'（音效被关）/ 'locked'（还没有手势解锁）/
    // 'unknown'（名字打错）。自检靠它区分「没响」的三种原因。
    function trigger(name, detail) {
      if (!VOICES[name]) return 'unknown';
      actions[name] = (actions[name] || 0) + 1;
      var res = !enabled ? 'muted' : (!ctx ? 'locked' : 'played');
      lastRes[name] = res;
      if (res !== 'played') return res;
      try {
        VOICES[name](ctx.currentTime + 0.005, detail);
        plays[name] = (plays[name] || 0) + 1;
      } catch (e) { lastRes[name] = 'error'; return 'error'; }
      return res;
    }

    // ── 持续音（电铃）的调度 ─────────────────────────────────
    // 用电平采样（setInterval + 提前排声）而不是「每帧排一声」：页面一帧可能
    // 60 帧/秒，而敲击是 26 次/秒，跟着帧走就会忽快忽慢，还依赖 rAF —— 本机
    // headless 一帧 rAF 都不回调，铃就永远不响。
    function syncBell() {
      var want = wantBell && enabled && !!ctx && !hidden;
      if (want === (bellTimer != null)) return;
      if (want) {
        bellNext = ctx.currentTime + 0.02;
        bellTimer = setInterval(pump, PUMP_MS);
        pump();
      } else {
        clearInterval(bellTimer); bellTimer = null;
      }
    }

    function pump() {
      if (!ctx || !bellTimer) return;
      var t = ctx.currentTime;
      // 掉队了就重新对齐。不这么做的话，标签页切到后台一会儿再回来，
      // 攒下的几百次敲击会在同一瞬间全部排出去 —— 一声爆响。
      if (bellNext < t) bellNext = t + 0.02;
      var look = t + LOOKAHEAD, guard = 0;
      while (bellNext < look && guard++ < 64) {
        strike(bellNext, BELL_PEAK);
        bellNext += 1 / BELL_RATE;
      }
    }

    // 页面每帧（每次重算）喂一次状态。传进来的只有两个布尔量。
    function setState(s) {
      if (!s) return;
      if (s.bell !== undefined) { wantBell = !!s.bell; syncBell(); }
      if (s.shorted !== undefined) {
        var now = !!s.shorted;
        // 只在【刚变成短路】的那一帧响一次。一直短着就持续尖叫的话，
        // 学生第一个动作就是把音效关掉 —— 那这一整套音效就白做了。
        if (now && !wasShorted) trigger('spark');
        wasShorted = now;
      }
    }

    function setEnabled(v) {
      enabled = !!v;
      syncBell();          // 关掉时把正在响的铃停掉；打开时若电路还短着/还响着要接回去
      return enabled;
    }

    function setVolume(v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      if (out) out.gain.value = volume;
      return volume;
    }

    // 标签页切到后台就停掉持续音：setInterval 在后台被压到 1 次/秒，
    // 电铃会变成一顿一顿的怪声，不如安静。
    if (root.document && root.document.addEventListener) {
      root.document.addEventListener('visibilitychange', function () {
        hidden = !!root.document.hidden;
        syncBell();
      });
    }

    function stats() {
      return {
        version: VERSION,
        enabled: enabled, ready: !!ctx, volume: volume,
        actions: JSON.parse(JSON.stringify(actions)),
        plays: JSON.parse(JSON.stringify(plays)),
        last: JSON.parse(JSON.stringify(lastRes)),
        wantBell: wantBell, bellRunning: bellTimer != null,
        strikes: strikes, shorted: wasShorted, hidden: hidden,
      };
    }

    // 清账（自检用）。持续音本身的状态不动 —— 那是电路状态，不是账。
    function reset() {
      actions = {}; plays = {}; lastRes = {}; strikes = 0;
    }

    return {
      version: VERSION,
      unlock: unlock,
      resume: unlock,
      isReady: function () { return !!ctx; },
      isEnabled: function () { return enabled; },
      setEnabled: setEnabled,
      getVolume: function () { return volume; },
      setVolume: setVolume,
      trigger: trigger,
      setState: setState,
      stats: stats,
      reset: reset,
      bellWanted: function () { return wantBell; },
      bellRunning: function () { return bellTimer != null; },
      last: function (name) { return lastRes[name] == null ? null : lastRes[name]; },
      // 音频时钟。自检用它判断「本机音频时钟到底走不走」—— 不走的时候，
      // 「铃一直在敲」这件事根本无法验证，必须明着报「未验证」而不是当绿。
      audioTime: function () { return ctx ? ctx.currentTime : null; },
    };
  }

  root.CircuitSound = { create: create, version: VERSION, BELL_RATE: BELL_RATE };
})(typeof window !== 'undefined' ? window : this);
