/* ================= 音频：全合成，无外部文件 ================= */
"use strict";

var AudioSys = {
  ctx: null,
  master: null,
  muted: false,
  started: false,
  noiseBuf: null,
  drone: null,
  wind: null,

  init: function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.62 * (this.volume === undefined ? 1 : this.volume);
    this.master.connect(ctx.destination);

    // 2 秒白噪声缓冲，全篇复用
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  },

  resume: function () {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  setMuted: function (m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 0.62 * (this.volume === undefined ? 1 : this.volume), this.ctx.currentTime + 0.2);
    }
  },

  toggleMute: function () {
    this.setMuted(!this.muted);
    return this.muted;
  },

  /* 0..1 音量（和静音分开，静音优先） */
  volume: 1,

  setVolume: function (v, save) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.62 * this.volume, this.ctx.currentTime + 0.12);
    }
    if (save) { try { localStorage.setItem("sh_volume", String(this.volume)); } catch (e) { /* 忽略 */ } }
    return this.volume;
  },

  loadVolume: function () {
    var v = 1;
    try {
      var s = localStorage.getItem("sh_volume");
      if (s !== null && !isNaN(parseFloat(s))) v = parseFloat(s);
    } catch (e) { /* 忽略 */ }
    this.setVolume(v, false);
  },

  now: function () { return this.ctx ? this.ctx.currentTime : 0; },

  noiseSource: function () {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  },

  /* ---------------- 环境：低频嗡鸣 + 风 ---------------- */
  startAmbience: function () {
    if (this.started || !this.ctx) return;
    this.started = true;
    var ctx = this.ctx, t = ctx.currentTime;

    var g = ctx.createGain();
    g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.13, t + 2.5);
    g.connect(this.master);

    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.Q.value = 0.6;
    lp.connect(g);

    var o1 = ctx.createOscillator();
    o1.type = "sawtooth"; o1.frequency.value = 55;
    var o2 = ctx.createOscillator();
    o2.type = "sine"; o2.frequency.value = 82.4;
    var o3 = ctx.createOscillator();
    o3.type = "sine"; o3.frequency.value = 55.6;

    var g1 = ctx.createGain(); g1.gain.value = 0.5;
    var g2 = ctx.createGain(); g2.gain.value = 0.32;
    var g3 = ctx.createGain(); g3.gain.value = 0.26;
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(lp); g2.connect(lp); g3.connect(lp);

    // 缓慢起伏
    var lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 0.07;
    var lfoG = ctx.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);

    o1.start(t); o2.start(t); o3.start(t); lfo.start(t);

    // 风
    var windSrc = this.noiseSource();
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 480; bp.Q.value = 0.5;
    var wg = ctx.createGain(); wg.gain.value = 0.022;
    var wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.11;
    var wlg = ctx.createGain(); wlg.gain.value = 240;
    wlfo.connect(wlg); wlg.connect(bp.frequency);
    windSrc.connect(bp); bp.connect(wg); wg.connect(this.master);
    windSrc.start(t); wlfo.start(t);

    this.drone = g;
    this.wind = wg;
  },

  /* ---------------- 背景音乐：稀疏的木箱音 + 低频铺底 ---------------- */
  startMusic: function () {
    if (this.musicStarted || !this.ctx) return;
    this.musicStarted = true;
    var ctx = this.ctx, t = ctx.currentTime;

    var out = ctx.createGain();
    out.gain.value = 0.0;
    out.gain.linearRampToValueAtTime(1.0, t + 5);
    out.connect(this.master);

    // 空间：短延迟 + 反馈，听起来像空教室里的回声
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2400;
    out.connect(lp); lp.connect(this.master);

    var dl = ctx.createDelay(1.5);
    dl.delayTime.value = 0.46;
    var fb = ctx.createGain(); fb.gain.value = 0.34;
    var wet = ctx.createGain(); wet.gain.value = 0.36;
    lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master);

    // 极低踏板音，缓慢漂移
    var ped = ctx.createOscillator();
    ped.type = "sine"; ped.frequency.value = 36.7;
    var pg = ctx.createGain(); pg.gain.value = 0.06;
    var plfo = ctx.createOscillator(); plfo.frequency.value = 0.045;
    var plg = ctx.createGain(); plg.gain.value = 1.5;
    plfo.connect(plg); plg.connect(ped.frequency);
    ped.connect(pg); pg.connect(out);
    ped.start(t); plfo.start(t);

    this.musicOut = out;
    this.musicPed = pg;
    this.musicT = 3.0;
  },

  /* 四个阶段：0 微恐 → 1 加低音弦 → 2 加敲击 → 3 急促追逐
     每层都是 16 格循环；bell = 音乐盒，bass = 低音，pad = 长音弦，knock = 木质敲击 */
  MUSIC_STAGES: [
    {
      step: 0.62, name: "微恐",
      bell: [[0, 440.00, 2.2, 0.082], [3, 349.23, 1.6, 0.052], [7, 293.66, 2.0, 0.070],
             [11, 329.63, 1.8, 0.048], [14, 220.00, 2.6, 0.058]],
      bass: [[0, 73.42], [8, 82.41]],
      pad: [],
      knock: []
    },
    {
      step: 0.56, name: "低音弦进来",
      bell: [[0, 440.00, 2.0, 0.082], [2, 523.25, 1.6, 0.048], [3, 349.23, 1.6, 0.056],
             [6, 293.66, 1.8, 0.060], [8, 392.00, 1.8, 0.058], [11, 329.63, 1.6, 0.048],
             [13, 293.66, 1.9, 0.052]],
      bass: [[0, 73.42], [4, 73.42], [8, 98.00], [12, 87.31]],
      pad: [[0, 110.00], [8, 98.00]],
      knock: []
    },
    {
      step: 0.50, name: "敲击进来",
      bell: [[0, 440.00, 1.8, 0.078], [2, 466.16, 1.4, 0.048], [3, 349.23, 1.4, 0.054],
             [5, 392.00, 1.4, 0.050], [6, 293.66, 1.6, 0.058], [8, 523.25, 1.6, 0.058],
             [10, 466.16, 1.4, 0.046], [11, 440.00, 1.4, 0.050], [13, 349.23, 1.5, 0.046],
             [14, 329.63, 1.7, 0.050]],
      bass: [[0, 73.42], [3, 73.42], [6, 82.41], [8, 98.00], [11, 98.00], [14, 87.31]],
      pad: [[0, 110.00], [6, 110.00], [8, 98.00]],
      knock: [0, 3, 6, 8, 11, 14]
    },
    {
      step: 0.31, name: "它在追",
      bell: [[0, 587.33, 0.9, 0.070], [1, 440.00, 0.7, 0.044], [2, 523.25, 0.8, 0.052],
             [3, 466.16, 0.7, 0.042], [4, 440.00, 0.8, 0.050], [5, 392.00, 0.7, 0.040],
             [6, 349.23, 0.8, 0.048], [7, 329.63, 0.7, 0.040], [8, 587.33, 0.9, 0.070],
             [9, 440.00, 0.7, 0.044], [10, 523.25, 0.8, 0.052], [11, 466.16, 0.7, 0.042],
             [12, 493.88, 0.8, 0.050], [13, 392.00, 0.7, 0.040], [14, 349.23, 0.8, 0.048],
             [15, 311.13, 0.7, 0.042]],
      bass: [[0, 73.42], [2, 73.42], [4, 82.41], [6, 73.42], [8, 98.00], [10, 98.00],
             [12, 87.31], [14, 73.42]],
      pad: [[0, 110.00], [8, 110.00]],
      knock: [0, 2, 4, 6, 8, 10, 12, 14]
    }
  ],

  /* 当前阶段（0-3），由 Game 根据线索数 / 是否被追设置 */
  musicStageIdx: 0,

  setMusicStage: function (i) {
    i = Math.max(0, Math.min(this.MUSIC_STAGES.length - 1, i | 0));
    if (i === this.musicStageIdx) return;
    this.musicStageIdx = i;
    this.musicStep = 0;
    this.musicStepT = 0.05;
  },

  /* 音乐盒：一个基音 + 一个微弱的八度泛音，快起慢落 */
  musicBell: function (freq, dur, vol, bright) {
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.musicOut;
    if (!out) return;
    var o = ctx.createOscillator();
    o.type = bright ? "triangle" : "sine";
    o.frequency.value = freq;
    var o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 2.002;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(vol * 0.28, t + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.55);
    o.connect(g); o2.connect(g2);
    g.connect(out); g2.connect(out);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  },

  /* 低音铺底的一击 */
  musicBass: function (freq) {
    var ctx = this.ctx, t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = "sine"; o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g); g.connect(this.musicOut);
    o.start(t); o.stop(t + 3.3);
  },

  /* 长音弦：两个微失谐的正弦 + 低通，慢起慢落 */
  musicPad: function (freq, dur) {
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.musicOut;
    if (!out) return;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 620; lp.Q.value = 0.6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq * (1 + (i - 1) * 0.004);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    }
    lp.connect(g); g.connect(out);
  },

  /* 木质敲击：一小段带通噪声 + 低频撞击 */
  musicKnock: function () {
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.musicOut;
    if (!out || !this.noiseBuf) return;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 3.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.11);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.14);
    var o = ctx.createOscillator();
    o.type = "sine"; o.frequency.value = 128;
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.1, t);
    g2.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    o.connect(g2); g2.connect(out);
    o.start(t); o.stop(t + 0.18);
  },

  /* 一个音符格 = 0.44 秒；循环 16 格 */
  musicTick: function (dt, intensity) {
    if (!this.ctx || !this.musicStarted) return;
    intensity = intensity || 0;
    var st = this.MUSIC_STAGES[this.musicStageIdx] || this.MUSIC_STAGES[0];
    if (this.musicStepT === undefined) this.musicStepT = 0.6;
    this.musicStepT -= dt;
    if (this.musicStepT > 0) return;
    // 越危险越快，但保留每个阶段自己的基准速度
    this.musicStepT = Math.max(st.step * 0.62, st.step - intensity * 0.06);

    var step = this.musicStep || 0;
    var bump = 1 + intensity * 0.45;
    var i, n;

    for (i = 0; i < st.bell.length; i++) {
      n = st.bell[i];
      if (n[0] !== step) continue;
      if (Math.random() < (this.musicStageIdx >= 3 ? 0.03 : 0.08)) break;   // 偶尔漏一拍
      this.musicBell(n[1], n[2], n[3] * bump, this.musicStageIdx >= 3);
    }
    for (i = 0; i < st.bass.length; i++) {
      if (st.bass[i][0] === step) this.musicBass(st.bass[i][1]);
    }
    for (i = 0; i < st.pad.length; i++) {
      if (st.pad[i][0] === step) this.musicPad(st.pad[i][1], st.step * 8);
    }
    for (i = 0; i < st.knock.length; i++) {
      if (st.knock[i] === step) this.musicKnock();
    }

    this.musicStep = (step + 1) % 16;

    // 每两轮（32 格）在远处补一声不协和的“回声”
    if (this.musicStep === 0) {
      this.musicLoop = (this.musicLoop || 0) + 1;
      if (this.musicLoop % 2 === 0) {
        var f = [587.33, 622.25, 466.16, 698.46][Math.floor(Math.random() * 4)];
        this.musicBell(f, 3.6, 0.03 + intensity * 0.03, false);
      }
    }
  },

  /* 危险时把音乐整体推近一点 */
  musicLevel: function (v) {
    if (!this.ctx || !this.musicPed) return;
    this.musicPed.gain.linearRampToValueAtTime(0.06 + v * 0.05, this.now() + 1.2);
  },

  /* 环境音量随热度/危险变化 */
  ambienceLevel: function (v) {
    if (!this.ctx || !this.drone) return;
    this.drone.gain.linearRampToValueAtTime(0.1 + v * 0.16, this.now() + 0.6);
  },

  /* ---------------- 脚步 ---------------- */
  step: function (running, hidden) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = running ? 1.5 : 1.1;

    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = hidden ? 220 : (running ? 1300 : 820);
    bp.Q.value = 1.2;

    var g = ctx.createGain();
    var peak = hidden ? 0.05 : (running ? 0.24 : 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (running ? 0.14 : 0.11));

    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.2);
  },

  /* ---------------- 心跳 ---------------- */
  heart: function (intensity) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.master;
    var beat = function (delay, vol) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(62, t + delay);
      o.frequency.exponentialRampToValueAtTime(34, t + delay + 0.13);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.2);
      o.connect(g); g.connect(out);
      o.start(t + delay); o.stop(t + delay + 0.24);
    };
    beat(0, 0.16 * intensity);
    beat(0.19, 0.11 * intensity);
  },

  /* ---------------- 惊悚音效 ---------------- */
  stinger: function (kind, intensity) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    intensity = intensity || 1;

    if (kind === "see") {
      // 忽然看见它：高频噪声 + 下坠
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      var hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.setValueAtTime(2400, t);
      hp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2 * intensity, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 1.1);

      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(41, t + 0.75);
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.13 * intensity, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + 0.85);
    } else if (kind === "locker") {
      // 它在摸柜门
      var s2 = ctx.createBufferSource();
      s2.buffer = this.noiseBuf; s2.playbackRate.value = 0.55;
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 340;
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.33 * intensity, t + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      s2.connect(lp); lp.connect(g2); g2.connect(this.master);
      s2.start(t); s2.stop(t + 0.6);
    } else if (kind === "dead") {
      // 被抓：全频爆响 + 长尾
      var s3 = ctx.createBufferSource();
      s3.buffer = this.noiseBuf; s3.loop = true;
      var bpf = ctx.createBiquadFilter();
      bpf.type = "bandpass"; bpf.frequency.value = 700; bpf.Q.value = 0.4;
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.0001, t);
      g3.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
      g3.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      s3.connect(bpf); bpf.connect(g3); g3.connect(this.master);
      s3.start(t); s3.stop(t + 2.5);

      var deadOut = this.master;
      [98, 103, 146, 155].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f, t);
        var og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.09, t + 0.03 + i * 0.01);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(og); og.connect(deadOut);
        o.start(t); o.stop(t + 1.7);
      });
    } else if (kind === "wake") {
      // 她醒了
      var o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(880, t);
      o2.frequency.exponentialRampToValueAtTime(110, t + 2.2);
      var og2 = ctx.createGain();
      og2.gain.setValueAtTime(0.0001, t);
      og2.gain.exponentialRampToValueAtTime(0.1, t + 0.4);
      og2.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o2.connect(og2); og2.connect(this.master);
      o2.start(t); o2.stop(t + 2.5);
    } else if (kind === "door") {
      var s4 = ctx.createBufferSource();
      s4.buffer = this.noiseBuf; s4.playbackRate.value = 0.8;
      var bp4 = ctx.createBiquadFilter();
      bp4.type = "bandpass";
      bp4.frequency.setValueAtTime(1200, t);
      bp4.frequency.linearRampToValueAtTime(300, t + 0.6);
      bp4.Q.value = 3;
      var g4 = ctx.createGain();
      g4.gain.setValueAtTime(0.0001, t);
      g4.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
      g4.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      s4.connect(bp4); bp4.connect(g4); g4.connect(this.master);
      s4.start(t); s4.stop(t + 1.0);
    }
  },

  /* ---------------- 小品音效 ---------------- */
  ui: function () {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = "square"; o.frequency.value = 620;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  },

  pickup: function () {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    [523.25, 622.25, 783.99].forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = f;
      var g = ctx.createGain();
      var st = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.07, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.1);
      o.connect(g); g.connect(AudioSys.master);
      o.start(st); o.stop(st + 1.2);
    });
  },

  hide: function (closing) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.playbackRate.value = 0.5;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = closing ? 700 : 420;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    s.connect(lp); lp.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.3);

    var o = ctx.createOscillator();
    o.type = "sine"; o.frequency.value = closing ? 96 : 130;
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.4);
  },

  /* 慢鬼的脚步：拖沓、闷、带一点摩擦 */
  heavyStep: function (near) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.42;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = near ? 420 : 300;
    var g = ctx.createGain();
    var peak = near ? 0.3 : 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.5);

    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(52, t);
    o.frequency.exponentialRampToValueAtTime(33, t + 0.3);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(near ? 0.18 : 0.08, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.4);
  },

  /* 对讲机的电流声 */
  radio: function (lost) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.6;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = lost ? 900 : 1600;
    bp.Q.value = 1.4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lost ? 0.05 : 0.075, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.3);
  },

  staticBurst: function () {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    var hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.2);
  },

  /* 手机震动（人气太高时弹幕提示音） */
  buzz: function () {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 78;
      var g = ctx.createGain();
      var st = t + i * 0.19;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.07, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
      o.connect(g); g.connect(this.master);
      o.start(st); o.stop(st + 0.15);
    }
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 260;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    src.connect(lp); lp.connect(ng); ng.connect(this.master);
    src.start(t); src.stop(t + 0.4);
  },

  breath: function () {    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 560; bp.Q.value = 1.6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.95);
    s.connect(bp); bp.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 1.0);
  }
};
