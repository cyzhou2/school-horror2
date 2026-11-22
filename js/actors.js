/* ================= 角色：玩家 与 影子 ================= */
"use strict";

var Player = {
  x: 0, y: 0, r: 11,
  face: -Math.PI / 2,
  stamina: 100,
  hidden: false,
  hidingProp: null,
  moving: false,
  running: false,
  stepTimer: 0,
  noiseTimer: 0,
  breatheTimer: 0,

  reset: function (px, py) {
    this.x = px; this.y = py;
    this.face = -Math.PI / 2;
    this.stamina = 100;
    this.hidden = false;
    this.hidingProp = null;
    this.stepTimer = 0;
    this.noiseTimer = 0;
    this.breatheTimer = 0;
  },

  update: function (dt, g) {
    if (!this.hidden && World.circleHits(this.x, this.y, this.r)) {
      var f = World.nearestFree(this.x, this.y, this.r);
      this.x = f.x; this.y = f.y;
    }
    if (this.hidden) {
      this.moving = false;
      this.running = false;
      this.stamina = Math.min(100, this.stamina + 26 * dt);
      this.breatheTimer -= dt;
      if (this.breatheTimer <= 0) {
        this.breatheTimer = 3.6 + Math.random() * 2;
        AudioSys.breath();
      }
      return;
    }

    var v = Input.vector();
    var wantRun = Input.wantsRun() && (v.x !== 0 || v.y !== 0);
    var canRun = this.stamina > 1;
    var running = wantRun && canRun;

    this.moving = !!(v.x || v.y);
    this.running = running && this.moving;

    if (this.moving) this.face = Math.atan2(v.y, v.x);

    var speed = running ? CFG.PLAYER_RUN : CFG.PLAYER_SPEED;
    if (g.slowWalk) speed *= 0.62;

    if (this.moving) {
      var dx = v.x * speed * dt, dy = v.y * speed * dt;
      var np = World.moveCircle(this.x, this.y, this.r, dx, dy);
      // 走路推进的"摩擦感"：贴墙滑动后仍算移动
      this.x = np.x; this.y = np.y;
    }

    // 体力
    if (running && this.moving) {
      this.stamina = Math.max(0, this.stamina - CFG.STAMINA_DRAIN * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + CFG.STAMINA_REGEN * dt);
    }

    // 脚步声与噪音
    if (this.moving) {
      this.stepTimer -= dt;
      this.noiseTimer -= dt;
      var interval = running ? 0.27 : 0.46;
      if (this.stepTimer <= 0) {
        this.stepTimer = interval;
        AudioSys.step(running, false);
        if (running) AudioSys.step(true, false);
      }
      if (this.noiseTimer <= 0) {
        this.noiseTimer = running ? 0.3 : 0.62;
        g.emitNoise(this.x, this.y, running ? CFG.NOISE_RUN : CFG.NOISE_WALK, running);
      }
    } else {
      this.stepTimer = 0;
      this.noiseTimer = 0;
    }
  },

  hide: function (prop) {
    this.hidden = true;
    this.hidingProp = prop;
    this.x = prop.px;
    this.y = prop.py;
    prop.hiddenInside = true;
  },

  unhide: function () {
    var p = this.hidingProp;
    if (p) {
      // 从柜子旁边出来
      var dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      var T = CFG.TILE;
      for (var i = 0; i < dirs.length; i++) {
        var nx = p.px + dirs[i][0] * (T + 10);
        var ny = p.py + dirs[i][1] * (T + 10);
        if (!World.circleHits(nx, ny, this.r)) { this.x = nx; this.y = ny; break; }
      }
      p.hiddenInside = false;
    }
    this.hidden = false;
    this.hidingProp = null;
  }
};

/* ================= 影子 ================= */
var Ghost = {
  x: 0, y: 0, r: 13,
  active: false,
  state: "sleep",
  path: [], pathI: 0,
  repathT: 0,
  perceiveT: 0,
  target: { x: 0, y: 0 },
  lastSeen: { x: 0, y: 0 },
  lostT: 0,
  searchT: 0,
  trail: [],
  trailT: 0,
  spawnX: 0, spawnY: 0,
  huntProp: null,
  huntT: 0,
  barrierProp: null,
  freezeT: 0,
  breakT: 0,
  breaking: null,
  stuckT: 0,
  lastX: 0, lastY: 0,
  waypoint: null,

  spawn: function (px, py) {
    this.x = px; this.y = py;
    this.spawnX = px; this.spawnY = py;
    this.active = false;
    this.state = "sleep";
    this.path = [];
    this.trail = [];
    this.huntProp = null;
    this.barrierProp = null;
    this.freezeT = 0;
  },

  wake: function () {
    this.active = true;
    this.state = "patrol";
    this.path = [];
    this.waypoint = null;
  },

  speedOf: function (g) {
    // 粉丝越多越快，但有上限：2/(1+e^(-v/K))-1 = tanh(v/2K)，0→0，∞→1
    var v = Math.max(0, g.live.viewers || 0);
    var k = CFG.VIEWER_K || 2200;
    var t = 2 / (1 + Math.exp(-v / k)) - 1;
    var base = CFG.GHOST_FAST_MIN + (CFG.GHOST_FAST_MAX - CFG.GHOST_FAST_MIN) * t;

    if (g.diffCfg && g.diffCfg.speed) base *= g.diffCfg.speed;
    if (this.state === "chase") return base;
    if (this.state === "hunt") return base * 0.92;
    if (this.state === "alert" || this.state === "search") return base * 0.8;
    return base * 0.6;
  },

  sightRange: function (g) {
    var r = CFG.GHOST_SIGHT + g.live.heat * 0.55;
    if (g.diffCfg && g.diffCfg.sight) r *= g.diffCfg.sight;
    if (!g.player.hidden) r += g.lightOn ? 80 : -50;
    return r;
  },

  hear: function (g, evt) {
    if (!this.active) return;
    var dx = evt.x - this.x, dy = evt.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > evt.r) return;
    if (this.state === "chase" || this.state === "hunt") return;
    this.target.x = evt.x; this.target.y = evt.y;
    if (this.state !== "alert") {
      this.state = "alert";
      this.path = [];
    }
    this.alertT = 8;
  },

  /* 它看见你躲进去了 */
  witnessedHide: function (g, prop) {
    if (!this.active) return;
    this.huntProp = prop;
    this.huntT = 0;
    this.state = "hunt";
    this.path = [];
    this.target.x = prop.px; this.target.y = prop.py;
    prop.danger = true;
    prop.dangerT = 0;
  },

  /* 它亲眼看见你把门关上 / 把桌椅推过去 */
  sawBarrier: function (g, prop) {
    if (!this.active) return;
    if (this.state === "chase" || this.state === "hunt") return;
    this.barrierProp = prop;
    this.path = [];
    this.breaking = null;
  },

  update: function (dt, g) {
    if (!this.active) return;
    if (World.circleHits(this.x, this.y, this.r)) {
      var fz = World.nearestFree(this.x, this.y, this.r);
      this.x = fz.x; this.y = fz.y; this.path = [];
    }
    var p = g.player;

    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.18;
      this.perceive(g);
    }

    // 状态处理
    switch (this.state) {
      case "patrol":
        if (!this.path.length) this.pickWaypoint(g);
        break;
      case "alert":
        this.alertT -= dt;
        if (this.alertT <= 0) { this.state = "patrol"; this.path = []; }
        break;
      case "chase":
        break;
      case "search":
        this.searchT -= dt;
        // 没亲眼看见你躲进去：它不会在柜子边傻站着，直接回去巡逻
        if (g.player.hidden || this.searchT <= 0) {
          this.state = "patrol";
          this.path = [];
          this.waypoint = null;
        }
        break;
      case "hunt":
        var hp = this.huntProp;
        if (!hp) { this.state = "chase"; break; }
        var dxh = hp.px - this.x, dyh = hp.py - this.y;
        var dh = Math.sqrt(dxh * dxh + dyh * dyh);
        if (dh < 46) {
          this.huntT += dt;
          if (this.huntT > 1.4) g.die("它拉开了柜门");
        } else {
          this.huntT = 0;
          this.target.x = hp.px; this.target.y = hp.py;
          this.repathT -= dt;
          if (!this.path.length || this.repathT <= 0) {
            this.path = World.findPath(this.x, this.y, hp.px, hp.py);
            this.pathI = 0;
            this.repathT = 0.4;
          }
        }
        break;
    }

    // 追逐时持续重算路径 —— 目标是"影子"：你若干秒前站的地方
    if (this.state === "chase") {
      this.repathT -= dt;
      if (!this.path.length || this.repathT <= 0) {
        var lagS = g.lagFor ? g.lagFor("fast") : CFG.GHOST_LAG_FAST;
        var lt = g.lagPos ? g.lagPos(lagS) : { x: p.x, y: p.y };
        this.path = World.findPath(this.x, this.y, lt.x, lt.y);
        this.pathI = 0;
        this.repathT = 0.32;
      }
    }

    // 刚发现你的那一瞬：它会停住，直直地看着你
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.trail.length = 0;
      return;
    }

    // 门 / 桌椅挡路：巡逻、搜寻、追人时都会去砸
    if (this.barrierProp && (this.barrierProp.state === "broken" || this.barrierProp.state === "used" || this.barrierProp.state === "open")) {
      this.barrierProp = null;
    }
    var blk = this.barrierProp;
    if (!blk) {
      var aim = null;
      if (this.state === "chase") aim = (g.lagPos ? g.lagPos(g.lagFor ? g.lagFor("fast") : CFG.GHOST_LAG_FAST) : p);
      else if (!this.path.length) aim = this.waypoint || this.target;
      if (aim) blk = World.blockerBetween(this.x, this.y, aim.x, aim.y);
    }
    if (blk) {
      var br = blk.block || { x: blk.x, y: blk.y, w: blk.w, h: blk.h };
      var bcx = (br.x + br.w / 2) * CFG.TILE;
      var bcy = (br.y + br.h / 2) * CFG.TILE;
      var bd = Math.sqrt((bcx - this.x) * (bcx - this.x) + (bcy - this.y) * (bcy - this.y));
      if (bd > 76) {
        // 先走到门前
        this.breaking = null;
        this.repathT -= dt;
        if (!this.path.length || this.repathT <= 0) {
          this.path = World.findPath(this.x, this.y, bcx, bcy);
          this.pathI = 0;
          this.repathT = 0.5;
        }
      } else {
        this.breaking = blk;
        this.path = [];
        this.breakT += dt;
        if (this.breakT > 3.0) {
          if (blk.t === "barricade") {
            blk.state = "used";
            g.doorStates[blk.barId] = "used";
          } else {
            blk.state = "broken";
            g.doorStates[blk.doorId] = "broken";
          }
          World.refreshDoors();
          AudioSys.stinger("locker", 1);
          g.shake = Math.min(1, g.shake + 0.4);
          this.breakT = 0;
          this.breaking = null;
          this.barrierProp = null;
        }
        return;
      }
    } else {
      this.breakT = 0;
      this.breaking = null;
    }

    this.moveAlong(dt, g);

    // 拉得太远就脱战
    if (this.state === "chase") {
      var dl = Math.sqrt((p.x - this.x) * (p.x - this.x) + (p.y - this.y) * (p.y - this.y));
      if (dl > CFG.GHOST_LEASH) this.lostT += dt * 2.2;
    }

    // 追逐 -> 丢失
    if (this.state === "chase" && this.lostT > 2.6) {
      this.state = "search";
      this.searchT = 6.5;
      this.path = World.findPath(this.x, this.y, this.lastSeen.x, this.lastSeen.y);
      this.pathI = 0;
    }

    // 拖影
    this.trailT -= dt;
    if (this.trailT <= 0 && this.state === "chase") {
      this.trailT = 0.05;
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 6) this.trail.pop();
    } else if (this.state !== "chase" && this.trail.length) {
      this.trail.pop();
    }

    // 卡住检测
    var moved = Math.abs(this.x - this.lastX) + Math.abs(this.y - this.lastY);
    this.lastX = this.x; this.lastY = this.y;
    if (moved < 0.6) {
      this.stuckT += dt;
      if (this.stuckT > 1.4) {
        this.stuckT = 0;
        this.path = [];
        if (this.state === "patrol") this.waypoint = null;
      }
    } else this.stuckT = 0;

    // 抓到
    var dx = p.x - this.x, dy = p.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (!p.hidden && d < CFG.GHOST_CATCH) g.die("它碰到了你的肩膀");
  },

  perceive: function (g) {
    var p = g.player;
    // 刚换层：它跟丢了（上楼/下楼就是甩脱）
    if (g.graceT > 0) {
      if (this.state === "chase" || this.state === "hunt") {
        this.state = "patrol";
        this.path = [];
        this.huntProp = null;
        this.lostT = 0;
      }
      return;
    }
    if (!p.hidden) {
      var dx = p.x - this.x, dy = p.y - this.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var sight = this.sightRange(g);
      if (d < sight && World.los(this.x, this.y, p.x, p.y)) {
        var wasChasing = this.state === "chase";
        this.state = "chase";
        this.lostT = 0;
        this.lastSeen.x = p.x; this.lastSeen.y = p.y;
        this.huntProp = null;
        if (!wasChasing) {
          // 首帧察觉：停顿 + 提示音，给玩家反应时间
          this.freezeT = 0.55;
          this.path = [];
          if (!this.spotSoundT || g.time - this.spotSoundT > 2.5) {
            this.spotSoundT = g.time;
            AudioSys.stinger("see", 0.85);
            g.shake = Math.min(1, g.shake + 0.5);
          }
        }
        if (g.hideWitnessed) { g.hideWitnessed = false; }
        // 发现瞬间：心跳音效由游戏层处理
      } else if (this.state === "chase") {
        this.lostT += 0.18;
      }
    } else {
      // 玩家躲在柜子里：只有被"看见"过才会来找
      if (this.state === "chase" || this.state === "hunt") {
        this.lostT += 0.18;
      }
    }
  },

  moveAlong: function (dt, g) {
    if (!this.path.length) {
      // hunt 时直着走
      if (this.state === "hunt" && this.huntProp) {
        var dx = this.huntProp.px - this.x, dy = this.huntProp.py - this.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 30) {
          var sp = this.speedOf(g) * dt;
          this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
        }
      }
      return;
    }
    var node = this.path[this.pathI];
    if (!node) { this.path = []; return; }
    var dx = node.x - this.x, dy = node.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var sp = this.speedOf(g) * dt;
    if (d < sp) {
      this.stepTo(node.x, node.y);
      this.pathI++;
      if (this.pathI >= this.path.length) this.path = [];
    } else {
      this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
    }
  },

  stepTo: function (nx, ny) {
    var np = World.moveCircle(this.x, this.y, this.r, nx - this.x, ny - this.y);
    this.x = np.x; this.y = np.y;
  },

  nearestBarrier: function (g) {
    var best = null, bd = 1e9;
    for (var i = 0; i < World.props.length; i++) {
      var p = World.props[i];
      var isDoor = p.t === "firedoor" && p.state === "closed";
      var isBar = p.t === "barricade" && p.state === "blocking";
      if (!isDoor && !isBar) continue;
      var d = Math.sqrt((p.px - this.x) * (p.px - this.x) + (p.py - this.y) * (p.py - this.y));
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  pickWaypoint: function (g) {
    // 附近有堵着的门 / 桌椅：先把它砸开（14 格内算“路上遇到”）
    var bar = this.nearestBarrier(g);
    if (bar) {
      var bd = Math.sqrt((bar.px - this.x) * (bar.px - this.x) + (bar.py - this.y) * (bar.py - this.y));
      if (bd < 460) {
        this.barrierProp = bar;
        this.path = [];
        this.waypoint = null;
        return;
      }
    }
    var pts = [
      { x: 10 * 32, y: 18 * 32 },
      { x: 30 * 32, y: 18 * 32 },
      { x: 50 * 32, y: 18 * 32 },
      { x: 30 * 32, y: 31 * 32 },
      { x: 50 * 32, y: 31 * 32 },
      { x: 10 * 32, y: 31 * 32 },
      { x: 5 * 32, y: 24 * 32 },
      { x: 58 * 32, y: 24 * 32 },
      { x: 56 * 32, y: 12 * 32 },
      { x: 6 * 32, y: 37 * 32 }
    ];
    var best = null, bestD = -1;
    for (var i = 0; i < 6; i++) {
      var c = pts[Math.floor(Math.random() * pts.length)];
      var dx = c.x - this.x, dy = c.y - this.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > bestD && d > 160) { bestD = d; best = c; }
    }
    if (!best) best = pts[0];
    this.waypoint = best;
    this.target.x = best.x; this.target.y = best.y;
    this.path = World.findPath(this.x, this.y, best.x, best.y);
    this.pathI = 0;
  }
};

/* ================= 慢鬼：甩不掉，只会一直走 ================= */
var SlowGhost = {
  x: 0, y: 0, r: 14,
  active: false,
  floor: 0,
  state: "idle",          // walk / break / arrive
  path: [], pathI: 0,
  repathT: 0,
  freezeT: 0,
  arriveT: 0,
  breakT: 0,
  breaking: null,
  hitT: 0,
  countT: 0,
  stepT: 0,
  stuckT: 0,
  trail: [],

  spawn: function (x, y, floor) {
    this.x = x; this.y = y;
    this.floor = floor;
    this.active = true;
    this.state = "walk";
    this.path = [];
    this.pathI = 0;
    this.repathT = 0;
    this.freezeT = 1.2;
    this.arriveT = 0;
    this.breakT = 0;
    this.breaking = null;
    this.countT = 0;
    this.stepT = 0;
    this.trail = [];
  },

  reset: function () {
    this.active = false;
    this.floor = 0;
    this.state = "idle";
    this.path = [];
    this.breaking = null;
    this.breakT = 0;
    this.countT = 0;
    this.arriveT = 0;
    this.trail = [];
  },

  /* 玩家换了楼层：它要慢慢走过来 */
  followFloor: function (floor) {
    if (!this.active) return;
    if (this.floor === floor) return;
    this.floor = floor;
    this.arriveT = 7.0;
    this.state = "arrive";
    this.path = [];
    this.breaking = null;
    this.breakT = 0;
    this.countT = 0;
  },

  update: function (dt, g) {
    if (!this.active) return;
    if (World.circleHits(this.x, this.y, this.r)) {
      var fz = World.nearestFree(this.x, this.y, this.r);
      this.x = fz.x; this.y = fz.y; this.path = [];
    }
    var p = g.player;

    // 换层途中
    if (this.arriveT > 0) {
      this.arriveT -= dt;
      if (this.arriveT <= 0) {
        // 从离你最远的那座楼梯口出现，不会刷在脸上
        var ap = (g.findSpawnPoint && g.findSpawnPoint(true)) || { x: 56, y: 12 };
        this.x = ap.x * CFG.TILE; this.y = ap.y * CFG.TILE;
        this.state = "walk";
        this.path = [];
        this.freezeT = 0.9;
        AudioSys.heavyStep(true);
        g.toast("", "楼梯口传来很慢的脚步声", 2200);
        g.shake = Math.min(1, g.shake + 0.3);
      }
      return;
    }

    if (this.freezeT > 0) { this.freezeT -= dt; return; }

    var hidden = p.hidden && p.hidingProp;
    var lt2 = (!hidden && g.lagPos) ? g.lagPos(g.lagFor ? g.lagFor("slow") : CFG.GHOST_LAG_SLOW) : null;
    var tx = hidden ? p.hidingProp.px : (lt2 ? lt2.x : p.x);
    var ty = hidden ? p.hidingProp.py : (lt2 ? lt2.y : p.y);

    // 先处理挡路的门
    var blocker = World.blockerBetween(this.x, this.y, tx, ty);
    if (blocker) {
      var bd = Math.hypot(blocker.px - this.x, blocker.py - this.y);
      if (bd > 46) {
        // 门把路堵死了，寻路必然为空：直接朝门走
        this.walkStraight(blocker.px, blocker.py, dt, g);
        this.state = "walk";
      } else {
        this.state = "break";
        this.breaking = blocker;
        this.breakT += dt;
        this.hitT -= dt;
        if (this.hitT <= 0) {
          this.hitT = 0.42;
          AudioSys.stinger("locker", 1);
          g.shake = Math.min(1, g.shake + 0.18);
        }
        var need = blocker.t === "barricade" ? CFG.BARRICADE_HOLD : CFG.FIREDOOR_BREAK;
        if (this.breakT >= need) this.breakThrough(g, blocker);
      }
      return;
    }

    this.breaking = null;
    this.breakT = 0;
    this.state = "walk";
    this.walkTo(tx, ty, dt, g);

    // 实在走不过去（比如被锁门隔开）：它从楼梯绕过来
    var distTarget = Math.hypot(tx - this.x, ty - this.y);
    if (!this.path.length && distTarget > 64) {
      this.stuckT += dt;
      if (this.stuckT > 3) {
        this.stuckT = 0;
        var sp2 = (g.findSpawnPoint && g.findSpawnPoint(true)) || { x: 56, y: 12 };
        this.x = sp2.x * CFG.TILE; this.y = sp2.y * CFG.TILE;
        this.path = [];
        this.freezeT = 0.8;
        AudioSys.heavyStep(true);
        g.toast("", "脚步声从楼梯口过来了", 2000);
      }
    } else {
      this.stuckT = 0;
    }

    // 躲在柜子里：它直接把柜门扯开
    if (hidden) {
      var dd = Math.hypot(p.hidingProp.px - this.x, p.hidingProp.py - this.y);
      if (dd < 54) {
        this.countT += dt;
        this.hitT -= dt;
        if (this.hitT <= 0) {
          this.hitT = 0.85;
          AudioSys.heart(1);
          AudioSys.stinger("locker", 0.7);
          AudioSys.staticBurst();
          g.shake = Math.min(1, g.shake + 0.18);
          if (this.countT > 0.8) {
            g.toast("", "柜门被从外面抓住了", 1500);
          }
        }
        if (this.countT >= CFG.SLOW_HIDE_COUNT) g.die("它把柜门扯开了");
      } else {
        this.countT = 0;
      }
    } else {
      this.countT = 0;
      var d2 = Math.hypot(p.x - this.x, p.y - this.y);
      if (d2 < CFG.SLOW_CATCH && !(g.graceT > 0)) g.die("它抓住了你");
    }

    // 脚步与拖影
    var dist = Math.hypot(p.x - this.x, p.y - this.y);
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = 0.72;
      if (dist < 520) AudioSys.heavyStep(dist < 240);
    }
    if (Math.random() < dt * 8) {
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 5) this.trail.pop();
    }
  },

  walkTo: function (tx, ty, dt, g) {
    this.repathT -= dt;
    if (!this.path.length || this.repathT <= 0) {
      this.path = World.findPath(this.x, this.y, tx, ty);
      this.pathI = 0;
      this.repathT = 0.5;
    }
    var node = this.path[this.pathI];
    if (!node) return;
    var dx = node.x - this.x, dy = node.y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var sp = CFG.SLOW_SPEED * ((g && g.diffCfg && g.diffCfg.speed) || 1) * dt;
    if (d < sp) {
      this.stepTo(node.x, node.y);
      this.pathI++;
      if (this.pathI >= this.path.length) this.path = [];
    } else {
      this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
    }
  },

  walkStraight: function (tx, ty, dt, g) {
    var dx = tx - this.x, dy = ty - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    var fs2 = (g && g.diffCfg && g.diffCfg.speed) || 1;
    var sp = CFG.SLOW_SPEED * fs2 * dt;
    this.stepTo(this.x + dx / d * sp, this.y + dy / d * sp);
  },

  stepTo: function (nx, ny) {
    var np = World.moveCircle(this.x, this.y, this.r, nx - this.x, ny - this.y);
    this.x = np.x; this.y = np.y;
  },

  breakThrough: function (g, prop) {
    if (prop.t === "barricade") {
      prop.state = "used";
      g.doorStates[prop.barId] = "used";
      g.toast("", "桌椅被它推开了", 2000);
    } else {
      prop.state = "broken";
      g.doorStates[prop.doorId] = "broken";
      g.toast("", "防火门被撞开了 —— 合不上了", 2000);
    }
    World.refreshDoors();
    AudioSys.stinger("dead", 1);
    g.shake = Math.min(1, g.shake + 0.5);
    this.breakT = 0;
    this.breaking = null;
    this.freezeT = 0.5;
    this.path = [];
  }
};
