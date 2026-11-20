/* ================= 渲染 ================= */
"use strict";

var Renderer = {
  ctx: null,
  cv: null,
  light: null,
  lctx: null,
  mapCv: null,
  mapCtx: null,
  T: 32,
  time: 0,
  hiddenMode: false,
  shake: 0,

  init: function (cv) {
    this.cv = cv;
    this.ctx = cv.getContext("2d");
    this.light = document.createElement("canvas");
    this.light.width = CFG.VIEW_W;
    this.light.height = CFG.VIEW_H;
    this.lctx = this.light.getContext("2d");
    this.mapCv = document.createElement("canvas");
    this.mapCv.width = CFG.MAP_W * CFG.TILE;
    this.mapCv.height = CFG.MAP_H * CFG.TILE;
    this.mapCtx = this.mapCv.getContext("2d");
    this.T = CFG.TILE;
  },

  setViewSize: function (w, h) {
    this.cv.width = w;
    this.cv.height = h;
    this.light.width = w;
    this.light.height = h;
    CFG.VIEW_W = w;
    CFG.VIEW_H = h;
  },

  /* 稳定伪随机 */
  hash: function (x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  },

  /* ================= 静态场景烘焙 ================= */
  bake: function () {
    var c = this.mapCtx, T = this.T, W = CFG.MAP_W, H = CFG.MAP_H;
    c.clearRect(0, 0, this.mapCv.width, this.mapCv.height);
    c.fillStyle = "#000";
    c.fillRect(0, 0, this.mapCv.width, this.mapCv.height);

    /* --- 地板 --- */
    for (var j = 0; j < H; j++) {
      for (var i = 0; i < W; i++) {
        if (World.grid[j][i] !== 1) continue;
        var room = World.roomAt(i * T + T / 2, j * T + T / 2);
        var base = room ? room.tint : "#181510";
        c.fillStyle = base;
        c.fillRect(i * T, j * T, T, T);

        // 地砖缝
        c.fillStyle = "rgba(0,0,0,0.30)";
        c.fillRect(i * T, j * T, T, 1);
        c.fillRect(i * T, j * T, 1, T);

        // 污渍
        var r1 = this.hash(i, j), r2 = this.hash(j + 3.1, i + 7.7);
        if (r1 > 0.72) {
          c.fillStyle = "rgba(0,0,0,0.30)";
          c.beginPath();
          c.ellipse(i * T + r2 * T, j * T + r1 * T, 4 + r2 * 9, 3 + r1 * 7, r1 * 3, 0, 6.283);
          c.fill();
        } else if (r1 < 0.10) {
          c.fillStyle = "rgba(120,110,90,0.035)";
          c.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
        }
        // 裂纹
        if (r2 > 0.955) {
          c.strokeStyle = "rgba(0,0,0,0.5)";
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(i * T + 4, j * T + 6);
          c.lineTo(i * T + 14, j * T + 18);
          c.lineTo(i * T + 11, j * T + 28);
          c.stroke();
        }
      }
    }

    /* --- 门洞地面 --- */
    World.level.doorways.forEach(function (d) {
      var w = (d.w || 1) * T;
      c.fillStyle = "#241f19";
      c.fillRect(d.x * T, d.y * T, w, T);
      c.strokeStyle = "rgba(0,0,0,0.5)";
      c.strokeRect(d.x * T + 0.5, d.y * T + 0.5, w - 1, T - 1);
    });

    /* --- 墙 --- */
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (World.grid[y][x] !== 0) continue;
        // 只画贴着地板的墙
        var near = false;
        for (var dy = -1; dy <= 1 && !near; dy++) {
          for (var dx = -1; dx <= 1 && !near; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && World.grid[ny][nx] === 1) near = true;
          }
        }
        if (!near) continue;
        var px = x * T, py = y * T;
        c.fillStyle = "#2f2922";
        c.fillRect(px, py, T, T);
        // 顶部亮边 + 底部阴影
        c.fillStyle = "rgba(150,132,104,0.18)";
        c.fillRect(px, py, T, 3);
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(px, py + T - 5, T, 5);
        // 墙面颗粒
        var r = this.hash(x * 1.7, y * 2.3);
        if (r > 0.6) {
          c.fillStyle = "rgba(0,0,0,0.25)";
          c.fillRect(px + r * 20, py + 6, 3, 8);
        }
        // 踢脚线
        c.fillStyle = "rgba(0,0,0,0.22)";
        c.fillRect(px, py + T - 7, T, 2);
      }
    }

    /* --- 物件（门和钥匙是动态的，画在每帧） --- */
    for (var p = 0; p < World.props.length; p++) {
      var pr = World.props[p];
      if (pr.dynamic || pr.t === "key") continue;
      this.bakeProp(c, pr);
    }
  },

  bakeProp: function (c, p) {
    var T = this.T;
    var x = p.x * T, y = p.y * T, w = p.w * T, h = p.h * T;

    switch (p.t) {
      case "locker":
        c.fillStyle = "#2b3034";
        c.fillRect(x + 1, y + 1, w - 2, h - 2);
        c.fillStyle = "#333a3f";
        c.fillRect(x + 2, y + 2, w - 4, 3);
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(x + 5, y + h * 0.28, w - 10, 2);
        c.fillRect(x + 5, y + h * 0.42, w - 10, 2);
        c.fillRect(x + 5, y + h * 0.56, w - 10, 2);
        c.fillStyle = "#151719";
        c.fillRect(x + w - 8, y + h * 0.6, 3, 6);
        break;

      case "desk":
        c.fillStyle = "#3a2c20";
        c.fillRect(x + 2, y + 4, w - 4, h - 12);
        c.fillStyle = "#4a382a";
        c.fillRect(x + 2, y + 4, w - 4, 3);
        c.fillStyle = "#211a13";
        c.fillRect(x + 5, y + h - 9, 3, 8);
        c.fillRect(x + w - 8, y + h - 9, 3, 8);
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(x + 2, y + h - 12, w - 4, 2);
        break;

      case "counter":
        c.fillStyle = "#33291f";
        c.fillRect(x, y, w, h);
        c.fillStyle = "#4b3d2d";
        c.fillRect(x, y, w, 4);
        c.fillStyle = "rgba(0,0,0,0.4)";
        c.fillRect(x + 4, y + 8, w - 8, 1);
        break;

      case "box":
        c.fillStyle = "#3a3226";
        c.fillRect(x + 1, y + 2, w - 2, h - 3);
        c.fillStyle = "#4a4030";
        c.fillRect(x + 1, y + 2, w - 2, 2);
        c.strokeStyle = "rgba(0,0,0,0.45)";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + w / 2, y + 2); c.lineTo(x + w / 2, y + h - 1);
        c.stroke();
        break;

      case "board":
        c.fillStyle = "#1b2a24";
        c.fillRect(x, y + 2, w, h - 3);
        c.strokeStyle = "#3b3226";
        c.lineWidth = 2;
        c.strokeRect(x, y + 2, w, h - 3);
        c.strokeStyle = "rgba(200,205,190,0.10)";
        c.lineWidth = 1;
        for (var s = 0; s < w / 26; s++) {
          c.beginPath();
          c.moveTo(x + 8 + s * 26, y + 9);
          c.lineTo(x + 20 + s * 26, y + 9);
          c.stroke();
          c.beginPath();
          c.moveTo(x + 8 + s * 26, y + 16);
          c.lineTo(x + 16 + s * 26, y + 16);
          c.stroke();
        }
        break;

      case "banner":
        c.fillStyle = "#4a1a20";
        c.fillRect(x, y + 3, w, h - 4);
        c.fillStyle = "rgba(220,190,150,0.16)";
        c.fillRect(x + 4, y + h * 0.4, w - 8, 2);
        break;

      case "sink":
        c.fillStyle = "#2a2c2b";
        c.fillRect(x, y, w, h);
        c.fillStyle = "#8f9090";
        for (var i = 0; i < p.w; i++) {
          c.beginPath();
          c.ellipse(x + i * T + T / 2, y + h / 2, 7, 4, 0, 0, 6.283);
          c.fill();
        }
        c.fillStyle = "rgba(0,0,0,0.35)";
        c.fillRect(x, y + h - 4, w, 4);
        break;

      case "stall":
        c.fillStyle = "#2a2724";
        c.fillRect(x, y, w, h);
        c.fillStyle = "rgba(150,135,110,0.10)";
        c.fillRect(x, y, 2, h);
        c.fillStyle = "rgba(0,0,0,0.35)";
        c.fillRect(x + w - 2, y, 2, h);
        break;

      case "exit":
        c.fillStyle = "#0a0908";
        c.fillRect(x, y, w, h);
        c.fillStyle = "#3a2f24";
        c.fillRect(x + 2, y, w - 4, h - 2);
        c.fillStyle = "#241c15";
        c.fillRect(x + w / 2 - 1, y + 2, 2, h - 6);
        c.fillStyle = "#6b6a63";
        c.fillRect(x + 10, y + h * 0.5, w - 20, 3);
        c.fillStyle = "rgba(120,150,170,0.10)";
        c.fillRect(x + 2, y + h - 3, w - 4, 2);
        break;

      case "stairs":
        // 台阶 + 扶手 + 向上箭头
        c.fillStyle = "#1d1915";
        c.fillRect(x, y, w, h);
        var steps = 8;
        for (var st = 0; st < steps; st++) {
          var sy = y + 5 + st * (h - 12) / steps;
          c.fillStyle = st % 2 ? "#302a24" : "#3a332c";
          c.fillRect(x + 4, sy, w - 9, (h - 12) / steps - 1.5);
          c.fillStyle = "rgba(160,142,112,0.14)";
          c.fillRect(x + 4, sy, w - 9, 1);
        }
        // 扶手
        c.fillStyle = "#4a423a";
        c.fillRect(x + w - 5, y + 4, 3, h - 8);
        // 向上箭头
        c.fillStyle = "rgba(200,220,200,0.22)";
        c.beginPath();
        c.moveTo(x + 11, y + h * 0.32);
        c.lineTo(x + 18, y + h * 0.16);
        c.lineTo(x + 25, y + h * 0.32);
        c.closePath();
        c.fill();
        break;
    }
  },

  /* ================= 主绘制 ================= */
  draw: function (g) {
    var c = this.ctx, VW = CFG.VIEW_W, VH = CFG.VIEW_H;
    var t = g.time;
    this.time = t;

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, VW, VH);
    c.fillStyle = "#000";
    c.fillRect(0, 0, VW, VH);

    var cam = g.cam;
    var ox = Math.round(cam.x), oy = Math.round(cam.y);

    // 屏幕抖动
    if (this.shake > 0.1) {
      ox += (Math.random() - 0.5) * this.shake * 8;
      oy += (Math.random() - 0.5) * this.shake * 8;
    }

    // 地图
    c.drawImage(this.mapCv, ox, oy, VW, VH, 0, 0, VW, VH);

    // 世界坐标换算
    var toS = function (wx, wy) { return { x: wx - ox, y: wy - oy }; };

    // 动态物件：门 / 锁 / 钥匙
    this.drawDynamicProps(c, g, toS);

    // 线索微光
    for (var i = 0; i < World.props.length; i++) {
      var p = World.props[i];
      var isKey = p.t === "key";
      if (isKey) { if (!p.revealed) continue; }
      else if (!p.clue || g.clues[p.clue]) continue;
      if (!World.los(g.player.x, g.player.y, p.px, p.py)) continue;
      var s = toS(p.px, p.py);
      if (s.x < -60 || s.y < -60 || s.x > VW + 60 || s.y > VH + 60) continue;
      var pulse = 0.55 + 0.45 * Math.sin(t * 3 + i);
      var r = 13 + pulse * 5;
      var gr = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      gr.addColorStop(0, "rgba(216,162,74," + (0.30 + pulse * 0.18) + ")");
      gr.addColorStop(1, "rgba(216,162,74,0)");
      c.fillStyle = gr;
      c.beginPath(); c.arc(s.x, s.y, r, 0, 6.283); c.fill();
      c.fillStyle = "rgba(230,205,160,0.85)";
      c.beginPath(); c.arc(s.x, s.y, 2.2, 0, 6.283); c.fill();
    }

    // 互动高亮
    if (g.target && !g.player.hidden) {
      var ts = toS(g.target.px, g.target.py);
      var rr = 15 + Math.sin(t * 4) * 1.5;
      c.strokeStyle = "rgba(216,162,74,0.5)";
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(ts.x, ts.y, rr, 0, 6.283); c.stroke();
    }

    // 怪物
    if (g.ghost && g.ghost.active) this.drawGhost(c, g, toS);
    if (g.slow && g.slow.active && g.slow.arriveT <= 0) this.drawSlowGhost(c, g, toS);

    // 玩家
    if (!g.player.hidden) this.drawPlayer(c, g, toS);

    // 光照
    this.drawLight(g);

    // 灰尘
    this.drawMotes(c, g);

    // 隐藏视线遮挡
    if (g.player.hidden) this.drawHiddenOverlay(c, g);

    // 死亡闪红
    if (g.flashRed > 0.01) {
      c.fillStyle = "rgba(120,10,20," + (g.flashRed * 0.5) + ")";
      c.fillRect(0, 0, VW, VH);
    }
  },

  drawPlayer: function (c, g, toS) {
    var p = g.player;
    var s = toS(p.x, p.y);
    var ang = p.face;
    c.save();
    c.translate(s.x, s.y);

    // 影子
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.beginPath(); c.ellipse(0, 9, 11, 5, 0, 0, 6.283); c.fill();

    // 背光晕：让角色在黑里也能读出来
    var halo = c.createRadialGradient(0, 0, 2, 0, 0, 22);
    halo.addColorStop(0, "rgba(210,196,160,0.16)");
    halo.addColorStop(1, "rgba(210,196,160,0)");
    c.fillStyle = halo;
    c.beginPath(); c.arc(0, 0, 22, 0, 6.283); c.fill();

    // 身体
    c.fillStyle = "#45434f";
    c.beginPath(); c.arc(0, 0, 11, 0, 6.283); c.fill();
    c.fillStyle = "#545162";
    c.beginPath(); c.arc(-1.5, -2, 8.2, 0, 6.283); c.fill();

    // 头/兜帽
    c.fillStyle = "#302f39";
    c.beginPath(); c.arc(0, -1, 6.8, 0, 6.283); c.fill();

    // 轮廓描边
    c.strokeStyle = "rgba(226,214,186,0.42)";
    c.lineWidth = 1.1;
    c.beginPath(); c.arc(0, 0, 11, 0, 6.283); c.stroke();

    // 朝向
    c.strokeStyle = "rgba(200,190,170,0.35)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(Math.cos(ang) * 6, Math.sin(ang) * 6);
    c.lineTo(Math.cos(ang) * 11, Math.sin(ang) * 11);
    c.stroke();

    c.restore();

    // 胸前的直播红点
    if (g.live.on) {
      var blink = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 2.4));
      c.fillStyle = "rgba(230,50,70," + blink + ")";
      c.beginPath(); c.arc(s.x + 2, s.y - 3, 1.8, 0, 6.283); c.fill();
    }

    // 体力条
    if (p.stamina < 99) {
      var bw = 26;
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(s.x - bw / 2, s.y + 16, bw, 3);
      c.fillStyle = p.stamina > 30 ? "rgba(200,190,160,0.75)" : "rgba(200,70,80,0.9)";
      c.fillRect(s.x - bw / 2, s.y + 16, bw * (p.stamina / 100), 3);
    }
  },

  /* ================= 动态物件：防火门 / 锁门 / 钥匙 ================= */
  drawDynamicProps: function (c, g, toS) {
    var T = this.T, t = this.time;
    for (var i = 0; i < World.props.length; i++) {
      var p = World.props[i];
      if (p.t === "firedoor") {
        var s = toS(p.x * T, p.y * T);
        var w = p.w * T, h = p.h * T;
        if (p.state === "closed") {
          c.fillStyle = "#332c26";
          c.fillRect(s.x + 1, s.y, w - 2, h);
          c.fillStyle = "rgba(0,0,0,0.45)";
          c.fillRect(s.x + w - 4, s.y, 3, h);
          // 横向推杠
          c.fillStyle = "#5a5248";
          c.fillRect(s.x + 2, s.y + h * 0.48, w - 4, 6);
          // 警示条
          c.fillStyle = "rgba(190,150,60,0.16)";
          for (var k = 0; k < h; k += 26) c.fillRect(s.x + 3, s.y + k + 6, w - 6, 4);
        } else if (p.state === "broken") {
          // 废门：门板歪着，铰链处裂开
          c.fillStyle = "#2b251f";
          c.fillRect(s.x + w - 9, s.y, 8, h * 0.72);
          c.fillRect(s.x + 2, s.y + h * 0.28, 7, h * 0.72);
          c.strokeStyle = "rgba(0,0,0,0.6)";
          c.lineWidth = 1;
          for (var q2 = 0; q2 < 5; q2++) {
            c.beginPath();
            c.moveTo(s.x + 2 + q2 * 2, s.y + h * 0.3);
            c.lineTo(s.x + 4 + q2 * 2, s.y + h * 0.34);
            c.stroke();
          }
          c.fillStyle = "rgba(120,140,150,0.06)";
          c.fillRect(s.x, s.y, w - 9, h);
        } else {
          // 开了：贴在一边
          c.fillStyle = "#2b251f";
          c.fillRect(s.x + w - 7, s.y, 6, h);
          c.fillStyle = "rgba(120,140,150,0.10)";
          c.fillRect(s.x, s.y, w - 7, h * 0.16);
          c.fillRect(s.x, s.y + h * 0.84, w - 7, h * 0.16);
        }
      } else if (p.t === "lock") {
        var s2 = toS(p.x * T, p.y * T);
        var w2 = p.w * T, h2 = p.h * T;
        if (p.state === "closed") {
          // 金属卷帘门：两扇门板 + 中缝 + 读卡器
          c.fillStyle = "#2a251f";
          c.fillRect(s2.x, s2.y, w2, h2);
          c.fillStyle = "#35302a";
          c.fillRect(s2.x + 2, s2.y + 2, w2 - 4, h2 - 4);
          c.fillStyle = "rgba(0,0,0,0.55)";
          c.fillRect(s2.x + w2 / 2 - 1, s2.y, 2, h2);
          c.fillRect(s2.x, s2.y + h2 * 0.42, w2, 2);
          // 刷卡器
          c.fillStyle = "#15130f";
          c.fillRect(s2.x + w2 - 9, s2.y + h2 * 0.44, 7, 12);
          var led = 0.45 + 0.55 * Math.abs(Math.sin(t * 2.2));
          c.fillStyle = "rgba(220,60,70," + led + ")";
          c.beginPath(); c.arc(s2.x + w2 - 5.5, s2.y + h2 * 0.44 + 3, 1.8, 0, 6.283); c.fill();
          // 把手
          c.fillStyle = "#6b645a";
          c.fillRect(s2.x + 3, s2.y + h2 * 0.62, 3, 14);
        } else {
          // 开了：两扇门收在两侧
          c.fillStyle = "#241f19";
          c.fillRect(s2.x, s2.y, 4, h2);
          c.fillRect(s2.x + w2 - 4, s2.y, 4, h2);
          c.fillStyle = "rgba(90,190,150,0.55)";
          c.beginPath(); c.arc(s2.x + w2 - 5.5, s2.y + h2 * 0.44 + 3, 2.2, 0, 6.283); c.fill();
        }
      } else if (p.t === "barricade") {
        var s4 = toS(p.x * T, p.y * T);
        var w4 = p.w * T, h4 = p.h * T;
        if (p.state === "blocking") {
          // 横在走廊里的一堆桌椅
          c.fillStyle = "#3a2c20";
          c.fillRect(s4.x, s4.y - 4 * T, w4, 5 * T);
          c.fillStyle = "#2a1f16";
          for (var q = 0; q < 5; q++) {
            c.fillRect(s4.x + 1, s4.y - 4 * T + q * T + 6, w4 - 2, T - 10);
          }
          c.fillStyle = "#5a4835";
          c.fillRect(s4.x, s4.y - 4 * T + 4, w4, 3);
          c.fillRect(s4.x + 2, s4.y - T - 4, w4 - 4, 3);
        } else if (p.state === "used") {
          c.fillStyle = "#2b2118";
          c.fillRect(s4.x + 2, s4.y + 4, w4 - 4, h4 - 8);
          c.fillStyle = "#1d1610";
          c.fillRect(s4.x + 6, s4.y + 10, w4 - 12, h4 - 18);
        } else {
          // ready：靠墙堆着的桌椅，等着被推过去
          c.fillStyle = "#3a2c20";
          c.fillRect(s4.x + 3, s4.y + 6, w4 - 6, h4 - 12);
          c.fillStyle = "#241a12";
          c.fillRect(s4.x + 3, s4.y + 6, w4 - 6, 3);
          c.fillStyle = "#5a4835";
          c.fillRect(s4.x + 6, s4.y + 11, w4 - 12, 2);
          c.fillStyle = "rgba(216,162,74,0.22)";
          c.fillRect(s4.x + 3, s4.y + h4 - 8, w4 - 6, 2);
        }
      } else if (p.t === "key" && p.revealed) {
        var s3 = toS(p.px, p.py);
        var pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
        // 竖直光柱：隔着半个房间也能看到
        var beam = c.createLinearGradient(s3.x, s3.y - 80, s3.x, s3.y + 8);
        beam.addColorStop(0, "rgba(226,196,120,0)");
        beam.addColorStop(0.65, "rgba(226,196,120,0.10)");
        beam.addColorStop(1, "rgba(240,214,150," + (0.24 + pulse * 0.14) + ")");
        c.fillStyle = beam;
        c.fillRect(s3.x - 8, s3.y - 80, 16, 88);
        // 光晕
        var g3 = c.createRadialGradient(s3.x, s3.y, 0, s3.x, s3.y, 28);
        g3.addColorStop(0, "rgba(240,214,150," + (0.36 + pulse * 0.2) + ")");
        g3.addColorStop(1, "rgba(240,214,150,0)");
        c.fillStyle = g3;
        c.beginPath(); c.arc(s3.x, s3.y, 28, 0, 6.283); c.fill();
        // 钥匙本体（比线索大一圈）
        c.save();
        c.translate(s3.x, s3.y);
        c.rotate(-0.5);
        c.fillStyle = "rgba(244,220,160,0.96)";
        c.strokeStyle = "rgba(24,18,12,0.85)";
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, -8, 4.6, 0, 6.283); c.fill(); c.stroke();
        c.fillRect(-1.5, -4, 3, 14);
        c.fillRect(1.2, 5.5, 4.2, 2);
        c.fillRect(1.2, 9, 3.4, 2);
        c.restore();
      } else if (p.t === "battery" && !p.taken) {
        // 备用电池：一小节发亮的圆柱
        var s5 = toS(p.px, p.py);
        var pul = 0.55 + 0.45 * Math.sin(t * 2.6);
        var gr = c.createRadialGradient(s5.x, s5.y, 0, s5.x, s5.y, 16);
        gr.addColorStop(0, "rgba(150,200,170," + (0.16 + pul * 0.12) + ")");
        gr.addColorStop(1, "rgba(150,200,170,0)");
        c.fillStyle = gr;
        c.beginPath(); c.arc(s5.x, s5.y, 16, 0, 6.283); c.fill();
        c.fillStyle = "#4a5a50";
        c.fillRect(s5.x - 3, s5.y - 6, 6, 12);
        c.fillStyle = "#9fd0b0";
        c.fillRect(s5.x - 3, s5.y - 6, 6, 2);
      }
    }
  },

  /* 慢鬼：高、瘦、歪着头，走得很慢 */
  drawSlowGhost: function (c, g, toS) {
    var sp = g.slow;
    var s = toS(sp.x, sp.y);
    var t = this.time;
    var sway = Math.sin(t * 1.15) * 3.2;
    var bob = Math.sin(t * 2.1) * 1.6;

    c.save();
    c.translate(s.x, s.y);

    // 地面阴影
    c.fillStyle = "rgba(0,0,0,0.6)";
    c.beginPath(); c.ellipse(0, 20, 16, 7, 0, 0, 6.283); c.fill();

    // 长长的身体
    c.fillStyle = "rgba(3,3,4,0.96)";
    c.beginPath();
    c.moveTo(-10 + sway * 0.4, 22);
    c.quadraticCurveTo(-15, 2, -8 + sway, -28 - bob);
    c.quadraticCurveTo(0, -36 - bob, 8 - sway, -28 - bob);
    c.quadraticCurveTo(15, 2, 10 - sway * 0.4, 22);
    c.closePath();
    c.fill();

    // 垂下来的长发
    c.strokeStyle = "rgba(2,2,3,0.85)";
    c.lineWidth = 2.4;
    for (var k = 0; k < 6; k++) {
      var hx = -9 + k * 3.6;
      c.beginPath();
      c.moveTo(hx, -30);
      c.quadraticCurveTo(hx + Math.sin(t * 1.4 + k) * 4, -6, hx + Math.sin(t * 1.1 + k) * 5, 14);
      c.stroke();
    }

    // 歪着的头
    c.save();
    c.translate(0, -30 - bob);
    c.rotate(0.24);
    c.fillStyle = "#020203";
    c.beginPath(); c.ellipse(0, 0, 9, 11, 0, 0, 6.283); c.fill();
    // 一条发白的眼缝
    c.fillStyle = "rgba(228,222,206,0.75)";
    c.fillRect(-4.5, -1.5, 9, 1.6);
    c.restore();

    // 手：垂着，破门时抬起
    c.strokeStyle = "rgba(2,2,3,0.95)";
    c.lineWidth = 4;
    c.lineCap = "round";
    var armLift = sp.state === "break" ? -26 + Math.sin(t * 9) * 6 : 10;
    c.beginPath();
    c.moveTo(-9, -12);
    c.quadraticCurveTo(-19, -2, -16 + sway, armLift);
    c.stroke();
    c.beginPath();
    c.moveTo(9, -12);
    c.quadraticCurveTo(19, -2, 16 - sway, 12);
    c.stroke();

    // 数门的时候，脚下有一圈极淡的红
    if (sp.countT > 0) {
      var a = 0.06 + 0.09 * Math.abs(Math.sin(t * 3));
      c.strokeStyle = "rgba(200,60,70," + a + ")";
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, 26 + sp.countT * 2, 0, 6.283); c.stroke();
    }

    c.restore();
  },

  drawGhost: function (c, g, toS) {
    var gh = g.ghost;
    var s = toS(gh.x, gh.y);
    var t = this.time;
    var chasing = gh.state === "chase";

    // 拖影
    if (chasing) {
      for (var i = gh.trail.length - 1; i >= 0; i--) {
        var tr = gh.trail[i];
        var a = (1 - i / gh.trail.length) * 0.16;
        var ts = toS(tr.x, tr.y);
        c.fillStyle = "rgba(0,0,0,0.9)";
        c.globalAlpha = a;
        c.beginPath(); c.ellipse(ts.x, ts.y, 12, 20, 0, 0, 6.283); c.fill();
        c.globalAlpha = 1;
      }
    }

    c.save();
    c.translate(s.x, s.y);
    var wob = Math.sin(t * (chasing ? 11 : 2.3)) * (chasing ? 2.2 : 1.1);

    // 地面阴影
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.beginPath(); c.ellipse(0, 16, 14, 6, 0, 0, 6.283); c.fill();

    // 身体：不规则黑团
    c.fillStyle = chasing ? "#000" : "rgba(4,4,6,0.94)";
    c.beginPath();
    c.moveTo(-11 + wob, 18);
    c.quadraticCurveTo(-16 + wob, -2, -7 + wob * 0.4, -16);
    c.quadraticCurveTo(0 + wob, -24, 7 - wob * 0.4, -16);
    c.quadraticCurveTo(16 - wob, -2, 11 - wob, 18);
    c.closePath();
    c.fill();

    // 手臂（细长）
    c.strokeStyle = "rgba(2,2,3,0.95)";
    c.lineWidth = 3.5;
    c.lineCap = "round";
    var armSwing = Math.sin(t * (chasing ? 9 : 2)) * 4;
    c.beginPath();
    c.moveTo(-9, -4);
    c.quadraticCurveTo(-18, 4 + armSwing, -14, 16 + armSwing);
    c.stroke();
    c.beginPath();
    c.moveTo(9, -4);
    c.quadraticCurveTo(18, 4 - armSwing, 14, 16 - armSwing);
    c.stroke();

    // 长发
    c.strokeStyle = "rgba(3,3,4,0.9)";
    c.lineWidth = 2;
    for (var k = 0; k < 5; k++) {
      var hx = -8 + k * 4 + wob * 0.3;
      c.beginPath();
      c.moveTo(hx, -14);
      c.quadraticCurveTo(hx + Math.sin(t * 2 + k) * 3, 0, hx + Math.sin(t * 2 + k) * 4 - 1, 12);
      c.stroke();
    }

    // 眼睛
    var glow = chasing ? 1 : 0.55;
    c.fillStyle = "rgba(226,222,210," + glow + ")";
    c.beginPath(); c.ellipse(-3.6, -13, 1.5, 2.4, 0, 0, 6.283); c.fill();
    c.beginPath(); c.ellipse(3.6, -13, 1.5, 2.4, 0, 0, 6.283); c.fill();

    c.restore();
  },

  /* 射线可见多边形（屏幕坐标）：光被墙和门切断
     clampY > 0 时把纵向位移钳制在 ±clampY，做“柜门缝”的横向带视野 */
  rayPolygon: function (wx, wy, cam, maxD, a0, a1, n, clampY) {
    var pts = [];
    var full = (a1 - a0) >= Math.PI * 1.99;
    var py = wy - cam.y;
    for (var i = 0; i <= n; i++) {
      var ang = full ? (i / n) * Math.PI * 2 : a0 + (a1 - a0) * (i / n);
      var d = World.rayDist(wx, wy, ang, maxD);
      var ex = wx + Math.cos(ang) * d - cam.x;
      var ey = wy + Math.sin(ang) * d - cam.y;
      if (clampY) ey = py + Math.max(-clampY, Math.min(clampY, ey - py));
      pts.push({ x: ex, y: ey });
    }
    return pts;
  },

  fillPoly: function (ctx, pts, cx, cy, r, op) {
    var grd = ctx.createRadialGradient(cx, cy, 6, cx, cy, r);
    grd.addColorStop(0, "rgba(0,0,0," + (0.98 * op) + ")");
    grd.addColorStop(0.45, "rgba(0,0,0," + (0.85 * op) + ")");
    grd.addColorStop(0.78, "rgba(0,0,0," + (0.34 * op) + ")");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  },

  /* ================= 光照 ================= */
  drawLight: function (g) {
    var c = this.ctx, L = this.lctx, VW = CFG.VIEW_W, VH = CFG.VIEW_H;
    var p = g.player;
    var s = { x: p.x - g.cam.x, y: p.y - g.cam.y };

    var hidden = p.hidden;
    var baseR = hidden ? 150 : (g.lightOn ? g.lightRadius() : CFG.LIGHT_OFF);
    var flick = 0.92 + Math.sin(this.time * 7.3) * 0.03 + Math.sin(this.time * 21.7) * 0.02;
    var R = baseR * flick * (g.lightFlicker ? 0.72 : 1);
    var dark = hidden ? 0.93 : 0.90;

    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = "source-over";
    L.clearRect(0, 0, VW, VH);
    L.fillStyle = "rgba(0,0,0," + dark + ")";
    L.fillRect(0, 0, VW, VH);

    L.globalCompositeOperation = "destination-out";

    var conePoly = null;
    if (hidden) {
      // 躲藏时：柜门缝视野 —— 同样做射线遮挡，只是纵向压扁
      var hp = p.hidingProp;
      if (hp) World.ignoreRect = { x0: hp.x, y0: hp.y, x1: hp.x + hp.w, y1: hp.y + hp.h };
      var slit = this.rayPolygon(p.x, p.y, g.cam, 340, 0, Math.PI * 2, 150, 66);
      this.fillPoly(L, slit, s.x, s.y, 340, 1);
      World.ignoreRect = null;
    } else {
      // 身周微光：被墙与门切断
      var poly = this.rayPolygon(p.x, p.y, g.cam, R, 0, Math.PI * 2, 180);
      this.fillPoly(L, poly, s.x, s.y, R, 1);

      // 手电筒锥形：同样被切断
      if (g.lightOn) {
        var len = 380 * (g.lightRadius() / CFG.LIGHT_ON), half = 0.46;
        conePoly = this.rayPolygon(p.x, p.y, g.cam, len, p.face - half, p.face + half, 64);
        this.fillPoly(L, conePoly, s.x, s.y, len, 0.85);
        // 外侧柔光
        var fringePoly = this.rayPolygon(p.x, p.y, g.cam, len * 0.92, p.face - half * 1.45, p.face + half * 1.45, 56);
        this.fillPoly(L, fringePoly, s.x, s.y, len, 0.32);
      }
    }

    // 附近光源：线索、钥匙、门缝
    for (var i = 0; i < World.props.length; i++) {
      var pr = World.props[i];
      var glowR = 0;
      if (pr.clue && !g.clues[pr.clue]) glowR = 62;
      else if (pr.t === "key" && pr.revealed) glowR = 74;
      else if (pr.t === "battery" && !pr.taken) glowR = 40;
      else if (pr.t === "exit") glowR = 96;
      if (!glowR) continue;
      if (!World.los(g.player.x, g.player.y, pr.px, pr.py)) continue;
      var ps = { x: pr.px - g.cam.x, y: pr.py - g.cam.y };
      if (ps.x < -glowR || ps.y < -glowR || ps.x > VW + glowR || ps.y > VH + glowR) continue;
      var g2 = L.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, glowR);
      g2.addColorStop(0, "rgba(0,0,0,0.65)");
      g2.addColorStop(1, "rgba(0,0,0,0)");
      L.fillStyle = g2;
      L.beginPath(); L.arc(ps.x, ps.y, glowR, 0, 6.283); L.fill();
    }

    L.globalCompositeOperation = "source-over";
    c.drawImage(this.light, 0, 0);

    // 手电筒暖色叠加（同样被遮挡）
    if (!hidden && g.lightOn && conePoly) {
      c.globalCompositeOperation = "lighter";
      var wg = c.createRadialGradient(s.x, s.y, 10, s.x, s.y, 380);
      wg.addColorStop(0, "rgba(120,104,70,0.10)");
      wg.addColorStop(1, "rgba(120,104,70,0)");
      c.fillStyle = wg;
      c.beginPath();
      c.moveTo(s.x, s.y);
      for (var k = 0; k < conePoly.length; k++) c.lineTo(conePoly[k].x, conePoly[k].y);
      c.closePath();
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
  },

  /* 灰尘颗粒 */
  MOTES: null,
  initMotes: function () {
    this.MOTES = [];
    for (var i = 0; i < 44; i++) {
      this.MOTES.push({
        x: Math.random() * CFG.VIEW_W,
        y: Math.random() * CFG.VIEW_H,
        vx: (Math.random() - 0.5) * 8,
        vy: -4 - Math.random() * 10,
        r: 0.6 + Math.random() * 1.3,
        a: 0.06 + Math.random() * 0.14
      });
    }
  },

  drawMotes: function (c, g) {
    if (!this.MOTES) this.initMotes();
    var dt = g.dt;
    c.save();
    for (var i = 0; i < this.MOTES.length; i++) {
      var m = this.MOTES[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y < -10) { m.y = CFG.VIEW_H + 10; m.x = Math.random() * CFG.VIEW_W; }
      if (m.x < -10) m.x = CFG.VIEW_W + 10;
      if (m.x > CFG.VIEW_W + 10) m.x = -10;
      c.fillStyle = "rgba(210,200,180," + m.a + ")";
      c.beginPath(); c.arc(m.x, m.y, m.r, 0, 6.283); c.fill();
    }
    c.restore();
  },

  drawHiddenOverlay: function (c, g) {
    var VW = CFG.VIEW_W, VH = CFG.VIEW_H;
    var s = { x: g.player.x - g.cam.x, y: g.player.y - g.cam.y };
    c.save();

    // 柜门缝上下压暗（缝口更宽一点，别把视野切碎）
    var top = c.createLinearGradient(0, s.y - 120, 0, s.y - 54);
    top.addColorStop(0, "rgba(0,0,0,1)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = top;
    c.fillRect(0, s.y - 120, VW, 66);

    var bot = c.createLinearGradient(0, s.y + 54, 0, s.y + 120);
    bot.addColorStop(0, "rgba(0,0,0,0)");
    bot.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = bot;
    c.fillRect(0, s.y + 54, VW, 66);

    // 门缝的金属亮边
    c.strokeStyle = "rgba(150,132,102,0.20)";
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, s.y - 70); c.lineTo(VW, s.y - 70); c.stroke();
    c.beginPath(); c.moveTo(0, s.y + 70); c.lineTo(VW, s.y + 70); c.stroke();

    // 黑暗里的呼吸
    c.fillStyle = "rgba(0,0,0," + (0.04 + 0.04 * Math.sin(this.time * 1.6)) + ")";
    c.fillRect(0, 0, VW, VH);

    c.restore();
  }
};
