/* ================= 游戏主控 v2 ================= */
"use strict";

var Game = {
  state: "title",
  inGame: false,
  time: 0,
  dt: 0,
  last: 0,
  cam: { x: 0, y: 0 },
  player: Player,
  ghost: Ghost,
  slow: SlowGhost,
  live: Live,

  clues: {},
  clueCount: 0,
  keys: {},
  doorStates: {},
  revealedKeys: {},
  floor: 0,

  lightOn: true,
  buzzT: 10,
  buzzFlash: 0,
  buzzHinted: false,
  lightFlicker: false,
  flickerT: 0,
  flashRed: 0,
  shake: 0,
  target: null,
  noises: [],
  slowWalk: false,
  heartT: 0,
  checkpoint: { x: 0, y: 0, floor: 0 },
  curRoom: null,
  ghostWoken: false,
  liveOnTime: 0,
  deadReason: "",
  heatHinted: false,
  pendingWake: false,
  fKeyLock: false,
  toastT: null,
  roomT: null,
  pauseEl: null,

  /* ================= 启动 ================= */
  init: function () {
    this.cv = document.getElementById("view");
    Renderer.init(this.cv);
    World.build(0);
    Renderer.bake();
    Live.initDom();
    Input.init();
    this.bindUi();
    this.buildPauseEl();
    this.showVersion();
    this.fitCanvas();
    var self = this;
    window.addEventListener("resize", function () { self.fitCanvas(); });
    this.last = performance.now();
    requestAnimationFrame(function (ts) { self.loop(ts); });
  },

  fitCanvas: function () {
    var w = window.innerWidth, h = window.innerHeight;
    var aspect = w / h;
    var vw, vh;
    if (aspect >= 1) {
      // 横屏：高度固定 540，宽度跟着视口走（最多 1180）
      vh = 540;
      vw = Math.round(Math.min(1180, 540 * aspect));
    } else {
      // 竖屏：宽度固定 340，高度跟着视口（最多 780）——
      // 手电筒的光能填满大半个屏幕，而不是浮在一大片黑里
      vw = 340;
      vh = Math.round(Math.min(780, 340 / aspect));
    }
    if (vw !== CFG.VIEW_W || vh !== CFG.VIEW_H) {
      Renderer.setViewSize(vw, vh);
    }
    var scale = Math.min(w / CFG.VIEW_W, h / CFG.VIEW_H);
    this.cv.style.width = Math.floor(CFG.VIEW_W * scale) + "px";
    this.cv.style.height = Math.floor(CFG.VIEW_H * scale) + "px";
  },

  bindUi: function () {
    var self = this;
    var on = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", function (e) {
        e.preventDefault();
        AudioSys.resume();
        AudioSys.ui();
        fn();
      });
    };
    on("btnStart", function () { self.startRun(); });

    var diffBtns = document.querySelectorAll(".diff-btn");
    for (var di = 0; di < diffBtns.length; di++) {
      (function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          AudioSys.resume();
          AudioSys.ui();
          self.diff = btn.getAttribute("data-diff");
          self.diffCfg = DIFFS[self.diff] || DIFFS.normal;
          var all = document.querySelectorAll(".diff-btn");
          for (var k = 0; k < all.length; k++) all[k].classList.toggle("on", all[k] === btn);
          var bt = document.getElementById("buildTag");
          if (bt) bt.textContent = (typeof GAME_VERSION !== "undefined" ? GAME_VERSION : "") + " · " + self.diffCfg.name;
        });
      })(diffBtns[di]);
    }
    on("btnDocClose", function () { self.advanceDoc(); });
    on("btnRetry", function () { self.retry(); });
    on("btnGiveUp", function () { self.toTitle(); });
    on("btnPublish", function () { self.publishEvidence(); });
    on("btnCut", function () { self.showEnding("half"); });
    on("btnDelete", function () { self.showEnding("black"); });
    on("btnRethink", function () { self.closeChoice(); });
    on("btnEndBack", function () { self.toTitle(); });
    on("btnStairUp", function () { self.useStairs(1); });
    on("btnStairDown", function () { self.useStairs(-1); });
    on("btnStairClose", function () { self.closeStairs(); });

    // 证据页：空格 / E / 回车都能继续
    window.addEventListener("keydown", function (e) {
      if (self.state !== "doc") return;
      var k = (e.key || "").toLowerCase();
      if (k === " " || k === "spacebar" || k === "e" || k === "enter") {
        e.preventDefault();
        self.advanceDoc();
      }
    });
  },

  buildPauseEl: function () {
    var d = document.createElement("div");
    d.className = "overlay dark hidden";
    d.id = "pauseScreen";
    d.innerHTML = '<div class="title-wrap"><div class="ending-label">暂停</div>' +
      '<p class="choice-body">直播还在继续，观众在等你回来。<br><br>按 ESC 或 P 继续。</p>' +
      '<div class="build-tag">' + (typeof GAME_VERSION !== "undefined" ? GAME_VERSION : "") + '</div></div>';
    document.getElementById("app").appendChild(d);
    this.pauseEl = d;
  },

  /* 构建号：显式显示 + 打到控制台，排查“到底跑的是哪一版”全靠它 */
  showVersion: function () {
    var v = (typeof GAME_VERSION !== "undefined") ? GAME_VERSION : "dev";
    var el = document.getElementById("buildTag");
    if (el) el.textContent = v;
    try { console.log("[封校第七十三天] build " + v); } catch (e) { /* 忽略 */ }
  },

  /* ================= 开关局 ================= */
  startRun: function () {
    AudioSys.resume();
    AudioSys.startAmbience();
    AudioSys.startMusic();

    this.hideAllOverlays();
    this.clues = {};
    this.clueOrder = {};
    this.trail = [];
    this.clueCount = 0;
    this.keys = {};
    this.doorStates = {};
    this.revealedKeys = {};
    this.openedLocks = {};
    this.lightOn = true;
    this.flashRed = 0;
    this.shake = 0;
    this.noises = [];
    this.curRoom = null;
    this.ghostWoken = false;
    this.liveOnTime = 0;
    this.heatHinted = false;
    this.pendingWake = false;
    this.busy = false;
    this.barTimers = {};
    this.slowSpawned = false;
    this.slowHinted = false;
    this.slow.reset();
    this.buzzT = 10;
    this.buzzFlash = 0;
    this.buzzHinted = false;
    this.diff = this.diff || "normal";
    this.diffCfg = DIFFS[this.diff] || DIFFS.normal;
    this.deathCount = 0;
    this.updateBlood();
    this.peakViewers = this.live.viewers;
    this.explored = [{}, {}, {}];
    this.exploreT = 0;

    this.floor = 0;
    this.pickRun();
    World.build(0, this.levelExtra(0));
    Renderer.bake();

    var sp = LEVELS[0].spawn;
    var sx = sp.x * CFG.TILE, sy = sp.y * CFG.TILE;
    this.player.reset(sx, sy);
    this.checkpoint = { x: sx, y: sy, floor: 0 };

    var gs = LEVELS[0].ghostSpawn;
    this.ghost.spawn(gs.x * CFG.TILE, gs.y * CFG.TILE);

    this.live.reset();
    this.applyLevelState();
    this.updateClueUi();
    this.updateObjective();
    this.updateFloorUi();
    Input.clear();

    this.radioInit();
    this.radioQ = [];
    this.radioT = 0;
    this.radioLost = false;
    this.radioLostPending = 0;
    this.radioNext = 40;
    if (this.radioBox) this.radioBox.classList.remove("show");
    var self0 = this;
    setTimeout(function () {
      if (self0.inGame) self0.radioPlay("start");
    }, 1600);

    this.cam.x = this.clampCamX(sx - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(sy - CFG.VIEW_H / 2);

    this.state = "play";
    this.inGame = true;
    this.showRoom(LEVELS[0].name);
    var self = this;
    setTimeout(function () {
      if (self.inGame) self.toast("23:47 · 一层大厅", "每层找齐 2 件线索，才能拿到下一层的钥匙");
    }, 700);
  },

  toTitle: function () {
    this.state = "title";
    this.inGame = false;
    AudioSys.ambienceLevel(0);
    this.hideAllOverlays();
    document.getElementById("titleScreen").classList.remove("hidden");
  },

  hideAllOverlays: function () {
    ["titleScreen", "docScreen", "deadScreen", "endingScreen", "choiceScreen", "stairsScreen"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    if (this.pauseEl) this.pauseEl.classList.add("hidden");
  },

  togglePause: function () {
    if (this.state === "play") {
      this.state = "paused";
      this.pauseEl.classList.remove("hidden");
    } else if (this.state === "paused") {
      this.state = "play";
      this.pauseEl.classList.add("hidden");
      this.last = performance.now();
    }
  },

  /* ================= 主循环 ================= */
  loop: function (ts) {
    // 先把下一帧排上：这样即使本帧抛错，游戏也不会“卡死”
    var self = this;
    requestAnimationFrame(function (t) { self.loop(t); });

    var dt = (ts - this.last) / 1000;
    this.last = ts;
    if (dt > 0.06) dt = 0.06;
    if (dt < 0) dt = 0;
    this.dt = dt;

    try {
      if (this.state === "play" || this.state === "title") this.time += dt;

      if (this.state === "play") this.update(dt);
      else if (this.state === "title") this.updateIdle(dt);
      else if (this.state === "paused") {
        // 暂停时逻辑停住，但背景音乐继续（暂停不该是一屋子死寂）
        AudioSys.musicTick(dt, 0);
      }

      if (this.inGame) { Renderer.draw(this); Renderer.drawMinimap(this); }
      else this.drawTitleBg();
    } catch (err) {
      this.frameErrors = (this.frameErrors || 0) + 1;
      if (this.frameErrors <= 3 && window.console) console.error("[frame]", err);
      // 出错时至少把状态拉回能继续跑的样子
      if (this.state === "play" && this.frameErrors > 20) this.state = "paused";
    }
  },

  drawTitleBg: function () {
    var c = Renderer.ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#050505";
    c.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
  },

  updateIdle: function (dt) {
    this.live.update(dt, this);
  },

  update: function (dt) {
    var p = this.player, g = this.ghost;

    this.autoMove(dt);
    p.update(dt, this);

    this.target = p.hidden ? p.hidingProp : World.nearestProp(p.x, p.y, 52);
    this.updatePrompt();

    if (Input.takeAction()) this.doAction();
    if (Input.takeLive()) this.live.toggle(this);
    if (Input.keys["f"] && !this.fKeyLock) {
      this.fKeyLock = true;
      this.lightOn = !this.lightOn;
      this.toast(this.lightOn ? "手电筒：开" : "手电筒：关",
        this.lightOn ? "" : "看不见路，但它也很难发现你", 1800);
      AudioSys.step(false, false);
    }
    if (!Input.keys["f"]) this.fKeyLock = false;

    this.pushTrail();
    g.update(dt, this);
    this.slow.update(dt, this);
    this.live.update(dt, this);
    this.radioUpdate(dt);
    if (this.live.on) this.liveOnTime += dt;

    // 人气太高：手机不停震动，每次震动都是一次噪音 —— 直接把鬼引过来
    this.buzzFlash = Math.max(0, this.buzzFlash - dt);
    if (this.live.on && this.live.silenceT <= 0 && this.live.heat > 32) {
      this.buzzT -= dt;
      if (this.buzzT <= 0) {
        this.buzzT = Math.max(2.8, 11 - this.live.heat * 0.08);
        this.buzzFlash = 2.2;
        AudioSys.buzz();
        this.emitNoise(this.player.x, this.player.y, CFG.NOISE_ACT * 1.4, true);
        this.shake = Math.min(1, this.shake + 0.12);
        // 不出文字：屏幕抖一下 + 手机真震一下（支持震动才震）
        this.vibrate(this.buzzHinted ? [18] : [30, 55, 30]);
        if (!this.buzzHinted) {
          this.buzzHinted = true;
          this.shake = Math.min(1.3, this.shake + 0.45);
        }
      }
    }
    // LIVE 角标自己抖，不用文字解释
    var lb = document.getElementById("liveBadge");
    if (lb) lb.classList.toggle("buzzing", this.buzzFlash > 0 && this.live.on && this.live.silenceT <= 0);

    // 队友失联
    if (this.radioLostPending > 0) {
      this.radioLostPending -= dt;
      if (this.radioLostPending <= 0) {
        this.radioLostPending = 0;
        this.radioLost = true;
        this.radioPlay("lost");
        this.radioNext = 30;
        AudioSys.staticBurst();
        var selfR = this;
        setTimeout(function () {
          if (selfR.inGame && selfR.state === "play") selfR.toast("对讲机没声了", "只剩电流，还有你一个人的呼吸", 3200);
        }, 900);
      }
    }

    // 房间
    var room = World.roomAt(p.x, p.y);    if (room && (!this.curRoom || room.id !== this.curRoom.id)) {
      this.curRoom = room;
      this.checkpoint = { x: p.x, y: p.y, floor: this.floor };
      this.showRoom(room.name);
      if (this.ghostWoken) this.live.say(room.name + "……进这里干嘛", "hot");
    }

    // 摄像机
    var tx = this.clampCamX(p.x - CFG.VIEW_W / 2);
    var ty = this.clampCamY(p.y - CFG.VIEW_H / 2);
    var k = Math.min(1, dt * 9);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;

    // 记录已探索区域（给小地图）
    this.exploreT -= dt;
    if (this.exploreT <= 0) {
      this.exploreT = 0.18;
      var ex = this.explored[this.floor];
      var cx = Math.floor(p.x / CFG.TILE), cy = Math.floor(p.y / CFG.TILE), R = 7;
      for (var ey = cy - R; ey <= cy + R; ey++) {
        for (var exx = cx - R; exx <= cx + R; exx++) {
          if (exx < 0 || ey < 0 || exx >= CFG.MAP_W || ey >= CFG.MAP_H) continue;
          if (World.grid[ey][exx] !== 1) continue;
          var ddx = exx - cx, ddy = ey - cy;
          if (ddx * ddx + ddy * ddy > R * R) continue;
          ex[exx + "," + ey] = 1;
        }
      }
    }

    // 心跳：取两只鬼里最近的那只，越近越急越响
    var nearestGhost = 1e9, nearKind = null;
    if (g.active && g.arriveT !== undefined) {
      var d1 = Math.sqrt((p.x - g.x) * (p.x - g.x) + (p.y - g.y) * (p.y - g.y));
      nearestGhost = d1; nearKind = "fast";
    }
    if (this.slow.active && this.slow.arriveT <= 0) {
      var d2 = Math.sqrt((p.x - this.slow.x) * (p.x - this.slow.x) + (p.y - this.slow.y) * (p.y - this.slow.y));
      if (d2 < nearestGhost) { nearestGhost = d2; nearKind = "slow"; }
    }
    if (nearestGhost < 460) {
      var near = 1 - nearestGhost / 460;
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = Math.max(0.34, 1.5 - near * 1.25);
        AudioSys.heart(0.35 + near * 0.9);
        if (near > 0.55 && Math.random() < 0.4) AudioSys.breath();
        this.shake = Math.min(1, this.shake + near * 0.05);
      }
    }

    // 背景音乐：线索越多乐器越多；被追 / 鬼在身边时切到急促版
    var musI = nearestGhost < 620 ? Math.max(0, 1 - nearestGhost / 620) : 0;
    var clueStage = Math.min(3, Math.floor(this.clueCount / 2));
    var chased = this.ghost.active && (this.ghost.state === "chase" || nearestGhost < 300);
    AudioSys.setMusicStage(chased ? 3 : clueStage);
    AudioSys.musicTick(dt, musI);
    AudioSys.musicLevel(musI);

    // 上楼缓冲：这段时间它“跟丢”了你
    if (this.graceT > 0) this.graceT = Math.max(0, this.graceT - dt);

    // 峰值观众（结局结算用）
    this.peakViewers = Math.max(this.peakViewers || 0, this.live.viewers);
    if (g.active) {
      this.flickerT -= dt;
      if (this.flickerT <= 0) {
        this.flickerT = 2.2 + Math.random() * 4;
        this.lightFlicker = Math.random() < (0.15 + this.live.heat / 260);
        var self = this;
        setTimeout(function () { self.lightFlicker = false; }, 90 + Math.random() * 160);
      }
    }

    this.flashRed = Math.max(0, this.flashRed - dt * 0.9);
    this.shake = Math.max(0, this.shake - dt * 0.85);
    Renderer.shake = this.shake;
    AudioSys.ambienceLevel(this.live.heat / 100);

    // 鬼醒着的时候才计时：没鬼的时候不该教玩家“关播降温”
    if (this.ghost.active) this.ghostWakeT = (this.ghostWakeT || 0) + dt;

    if (!this.heatHinted && this.live.heat > 62 && this.ghost.active && this.ghostWakeT > 5) {
      this.heatHinted = true;
      this.toast("热度上来了", "人越多，它越兴奋 —— 按 L 可以关播降温", 3200);
    }

    for (var i = this.noises.length - 1; i >= 0; i--) {
      this.noises[i].ttl -= dt;
      if (this.noises[i].ttl <= 0) this.noises.splice(i, 1);
    }

  },

  clampCamX: function (x) {
    return Math.max(0, Math.min(CFG.MAP_W * CFG.TILE - CFG.VIEW_W, x));
  },
  clampCamY: function (y) {
    return Math.max(0, Math.min(CFG.MAP_H * CFG.TILE - CFG.VIEW_H, y));
  },

  emitNoise: function (x, y, r, strong) {
    if (this.ghost.active) this.ghost.hear(this, { x: x, y: y, r: r });
    this.noises.push({ x: x, y: y, r: r, ttl: 0.5 });
    if (this.noises.length > 24) this.noises.shift();
  },

  /* ================= 楼层状态 ================= */
  /* 手电筒亮度：死亡会掉一档，备用电池能补回来 */
  lightRadius: function () { return CFG.LIGHT_ON; },

  /* 每次死亡，画面就更猩红一分 */
  updateBlood: function () {
    var el = document.getElementById("blood");
    if (!el) return;
    var n = Math.min(this.deathCount || 0, CFG.MAX_DEATHS);
    el.style.opacity = String(Math.min(0.92, n * 0.3));
    el.classList.toggle("heavy", n >= 2);
  },

  /* 光照缓存的签名：线索/钥匙/电池状态变了才重画遮罩 */
  glowSig: function () {
    var s = "";
    for (var id in this.clues) s += this.clues[id] ? "1" : "0";
    return s + Object.keys(this.revealedKeys).length + Object.keys(this.keys).length;
  },

  applyLevelState: function () {
    var self = this;
    World.props.forEach(function (p) {
      if (p.dynamic) {
        var id = p.t === "firedoor" ? p.doorId : (p.t === "lock" ? p.lock : p.barId);
        var st = self.doorStates[id];
        if (p.t === "firedoor") p.state = st === "closed" ? "closed" : (st === "broken" ? "broken" : "open");
        else if (p.t === "lock") p.state = st === "open" ? "open" : "closed";
        else p.state = st || "ready";
      }
      if (p.t === "key") p.revealed = !!self.revealedKeys[p.key];
    });
    World.refreshDoors();
  },

  floorClueCount: function (f) {
    var n = 0;
    for (var id in CLUES) if (CLUES[id].floor === f && this.clues[id]) n++;
    return n;
  },

  updateFloorUi: function () {
    var el = document.getElementById("floorLabel");
    if (el) el.textContent = LEVELS[this.floor].floorLabel;
  },

  /* 真机震动：不支持就静默跳过 */
  vibrate: function (pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 忽略 */ }
  },

  /* ================= 楼梯 ================= */
  /* 上楼要本层的“门禁/钥匙”；没有就禁用，有就直接在楼梯口刷开 */
  stairLockId: function (floor) {
    return ["lock1", "lock2", "lock3"][floor];
  },

  openStairs: function (prop) {
    this.pendingStair = prop || null;
    this.state = "stairs";
    var locked = this.doorStates[this.stairLockId(this.floor)] !== "open";

    // 走到楼梯口、身上有钥匙：直接开
    if (locked) {
      var L = LOCKS[this.stairLockId(this.floor)];
      if (this.keys[L.key]) {
        this.doorStates[this.stairLockId(this.floor)] = "open";
        World.refreshDoors();
        AudioSys.stinger("door", 1);
        this.live.addHeat(6);
        this.toast(L.name + "开了", L.open, 3000);
        this.updateObjective();
        locked = false;
      } else {
        AudioSys.stinger("locker", 0.7);
        this.toast("上不去", L.need, 3200);
      }
    }

    var up = document.getElementById("btnStairUp");
    var down = document.getElementById("btnStairDown");
    if (up) {
      var needClues = this.floor >= 2 && this.clueCount < 6;
      var label = this.floor >= 2 ? "上天台" : "上楼（" + LEVELS[this.floor + 1].floorLabel + "）";
      if (locked) label += " · 锁着";
      if (needClues) label += " · 证据不够";
      up.textContent = label;
      up.disabled = locked || needClues;
      up.classList.toggle("disabled", locked || needClues);
    }
    if (down) down.classList.toggle("hidden", this.floor <= 0);
    var info = document.getElementById("stairInfo");
    if (info) {
      var side = prop && prop.stairId === "south" ? "南侧" : "北侧";
      info.textContent = LEVELS[this.floor].name + " · " + side + "楼梯间";
    }
    var el = document.getElementById("stairsScreen");
    if (el) el.classList.remove("hidden");
  },

  closeStairs: function () {
    var el = document.getElementById("stairsScreen");
    if (el) el.classList.add("hidden");
    this.state = "play";
    this.last = performance.now();
    Input.clear();
  },

  useStairs: function (dir) {
    var stairId = (this.pendingStair && this.pendingStair.stairId) || "north";
    // 上楼：每层都有本层的门锁 —— 一楼消防门、二楼门禁、三楼就是天台门
    if (dir > 0 && this.doorStates[this.stairLockId(this.floor)] !== "open") {
      AudioSys.stinger("locker", 0.7);
      this.toast(this.floor >= 2 ? "天台门打不开" : "门禁没开",
        LOCKS[this.stairLockId(this.floor)].need, 3000);
      return;
    }
    if (dir > 0 && this.floor >= 2 && this.clueCount < 6) {
      this.toast("证据还不够", "现在上去，等于把这一夜白送。还差 " + (6 - this.clueCount) + " 件。", 3200);
      return;
    }
    this.closeStairs();
    if (dir > 0) {
      if (this.floor >= 2) { this.openChoice(); return; }
      this.changeFloor(this.floor + 1, stairId);
    } else {
      if (this.floor <= 0) return;
      this.changeFloor(this.floor - 1, stairId);
    }
  },

  changeFloor: function (target, stairId) {
    stairId = stairId || "north";
    this.lastStair = stairId;
    this.floor = target;
    World.load(target, this.levelExtra(target));
    Renderer.bake();
    this.applyLevelState();

    // 从同一侧楼梯间出来，站在锁的南/下侧
    var land = stairId === "south" ? { x: 6, y: 38.5 } : { x: 56, y: 11.5 };
    var px = land.x * CFG.TILE, py = land.y * CFG.TILE;
    this.player.x = px; this.player.y = py;
    this.player.hidden = false;
    this.player.hidingProp = null;
    this.player.stamina = Math.max(this.player.stamina, 40);
    this.player.face = -Math.PI / 2;

    this.curRoom = null;
    this.checkpoint = { x: px, y: py, floor: target };
    this.syncHooded();
    this.cancelAutoMove();

    // 快鬼不跟着“传送”：换层后它也在这一层重新落位，且不会在你附近
    if (this.ghost.active) this.resetGhostPosition(18, stairId);
    // 上楼就是甩脱：给你一段“它找不到你”的缓冲
    this.graceT = 3.0;
    this.trail = [];

    this.cam.x = this.clampCamX(px - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(py - CFG.VIEW_H / 2);
    this.updateFloorUi();
    this.updateObjective();
    this.showRoom(LEVELS[target].name);
    AudioSys.stinger("door", 0.6);
    this.emitNoise(px, py, CFG.NOISE_ACT, true);
    this.toast("", LEVELS[target].name, 2200);

    if (this.slow.active) this.slow.followFloor(target);
    if (target === 0) this.radioPlay("f1");
    if (target === 1) this.radioPlay("f2");
    if (target === 2) { this.radioPlay("f3"); this.onEnterThirdFloor(); }
  },

  /* ================= 影子轨迹 ================= */
  /* 每帧记一点位置，最多留 8 秒；Ghost 追的是 this.lagPos(sec) */
  pushTrail: function () {
    this.trail = this.trail || [];
    var now = this.time;
    var last = this.trail[this.trail.length - 1];
    // 30Hz 足够，站定时不重复记
    if (last && now - last.t < 1 / 30) return;
    if (last && Math.abs(last.x - this.player.x) < 0.4 && Math.abs(last.y - this.player.y) < 0.4) return;
    this.trail.push({ x: this.player.x, y: this.player.y, t: now });
    while (this.trail.length && now - this.trail[0].t > 8) this.trail.shift();
  },

  /* sec 秒前你在哪 —— 鬼的“影子目标” */
  lagPos: function (sec) {
    var tr = this.trail;
    if (!tr || !tr.length || sec <= 0) return { x: this.player.x, y: this.player.y };
    var target = this.time - sec;
    if (target <= tr[0].t) return { x: tr[0].x, y: tr[0].y };
    for (var i = tr.length - 1; i > 0; i--) {
      var a = tr[i - 1], b = tr[i];
      if (a.t <= target && b.t >= target) {
        var k = (target - a.t) / Math.max(0.0001, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    var l = tr[tr.length - 1];
    return { x: l.x, y: l.y };
  },

  /* ================= 钥匙与线索 ================= */
  /* 每局开局抽取：每层 2 个线索（不同房间）+ 1 个钥匙点，全部随机 */
  pickRun: function () {
    var self = this;
    this.floorClues = {};
    this.floorSpots = {};
    this.keyPick = {};
    this.clueOrder = {};
    var order = 1;
    for (var f = 0; f < LEVELS.length; f++) {
      var lv = LEVELS[f];
      var spots = (lv.clueSpots || []).slice();
      // 洗牌
      for (var i = spots.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = spots[i]; spots[i] = spots[j]; spots[j] = tmp;
      }
      var chosen = [], used = {};
      for (var s = 0; s < spots.length && chosen.length < 2; s++) {
        if (used[spots[s].room]) continue;
        used[spots[s].room] = 1;
        chosen.push(spots[s]);
      }
      chosen.forEach(function (c) {
        CLUES[c.id].order = order;
        self.clueOrder[c.id] = order;
        order++;
      });
      this.floorSpots[f] = chosen;
      this.floorClues[f] = chosen.map(function (c) { return c.id; });

      // 钥匙：随机一个点，且不要和这一层的线索重叠
      var ks = (lv.keySpots || []).slice();
      var pick = ks[Math.floor(Math.random() * ks.length)] || { x: 6.5, y: 5.4, room: "保安室" };
      for (var t2 = 0; t2 < ks.length; t2++) {
        var cand = ks[(Math.floor(Math.random() * ks.length) + t2) % ks.length];
        var bad = chosen.some(function (c) { return Math.abs(c.x - cand.x) < 1.5 && Math.abs(c.y - cand.y) < 1.5; });
        if (!bad) { pick = cand; break; }
      }
      var kid = ["key1", "key2", "key3"][f];
      this.keyPick[f] = { x: pick.x, y: pick.y, room: pick.room, id: kid, label: "拿走" + KEYS[kid].name };
    }
  },

  /* 交给 World.load 的“本局额外物件” */
  levelExtra: function (f) {
    return {
      clues: this.floorSpots[f] || [],
      key: this.keyPick[f] || null
    };
  },

  clueReady: function (need) {
    for (var i = 0; i < need.length; i++) if (!this.clues[need[i]]) return false;
    return true;
  },

  revealKeysIfReady: function () {
    for (var k in KEYS) {
      if (this.keys[k] || this.revealedKeys[k]) continue;
      var f = KEYS[k].floor;
      var ids = this.floorClues[f] || [];
      if (!ids.length || !this.clueReady(ids)) continue;
      this.revealedKeys[k] = true;
      World.props.forEach(function (p) {
        if (p.t === "key" && p.key === k) p.revealed = true;
      });
      var K = KEYS[k];
      var room = (this.keyPick[f] && this.keyPick[f].room) || K.room;
      this.toast("想起来了", K.toast + " —— 回" + room + "去拿" + K.name, 4200);
      this.live.say(room + "！钥匙在" + room + "！", "hot");
      this.live.say(K.name + "！别漏了", "hot");
      if (!this.radioLost) this.radioSay("灵灵", room + "，快拿。", 4);
      this.updateObjective();
    }
  },

  pickupKey: function (p) {
    this.keys[p.key] = true;
    p.revealed = false;
    AudioSys.pickup();
    this.live.addHeat(5);
    this.toast("已取得：" + KEYS[p.key].name, "", 2600);
    this.updateObjective();

    if (p.key === "key2" && !this.radioLost) {
      this.radioLostPending = 3.2;
    }
  },

  /* ================= 门 ================= */
  /* 防火门：只能关一次。硬拉开或撞开之后就是废门，关不上了 */
  toggleFireDoor: function (p) {
    if (p.state === "broken") {
      this.toast("", "门框被撞变形了，合不上", 1600);
      return;
    }
    var T = CFG.TILE;
    var rx = p.x * T, ry = p.y * T, rw = p.w * T, rh = p.h * T;
    var px = this.player.x, py = this.player.y, r = this.player.r + 2;
    var over = px + r > rx && px - r < rx + rw && py + r > ry && py - r < ry + rh;

    if (p.state === "closed") {
      // 硬拉开 = 铰链报废，这次之后再也关不上
      p.state = "broken";
      this.doorStates[p.doorId] = "broken";
      World.refreshDoors();
      AudioSys.hide(true);
      this.emitNoise(p.px, p.py, CFG.NOISE_ACT, true);
      this.toast("", "你把门硬拉开了 —— 铰链坏了，这扇门关不上了", 2800);
      return;
    }

    // open -> closed（一次性）
    if (over) { this.toast("", "你正站在门里，关不上", 1500); return; }
    p.state = "closed";
    this.doorStates[p.doorId] = "closed";
    AudioSys.hide(true);
    this.emitNoise(p.px, p.py, CFG.NOISE_ACT, true);
    this.toast("", "防火门关上 —— 只能挡这一次", 2200);
    World.refreshDoors();
    this.ghostSawBarrier(p);
  },

  /* 它看到了吗：看得见你关门，就会主动来砸 */
  ghostSawBarrier: function (prop) {
    var g = this.ghost;
    if (!g.active) return;
    var p = this.player;
    var d = Math.sqrt((p.x - g.x) * (p.x - g.x) + (p.y - g.y) * (p.y - g.y));
    if (d > g.sightRange(this)) return;
    if (!World.los(g.x, g.y, p.x, p.y)) return;
    g.sawBarrier(this, prop);
    this.toast("", "它看见你关门了", 1800);
    AudioSys.stinger("see", 0.5);
  },

  pushBarricade: function (p) {
    if (p.state === "used") return;

    // 已经堵上了：再按一次就是把桌椅挪开
    if (p.state === "blocking") {
      p.state = "ready";
      this.doorStates[p.barId] = "ready";
      World.refreshDoors();
      AudioSys.stinger("door", 0.5);
      this.emitNoise(p.px, p.py, CFG.NOISE_ACT, true);
      this.toast("", "你把桌椅挪回墙边 —— 还能再推一次", 2000);
      return;
    }

    // 你正站在要堵的那一列里：先把自己挪开
    var T = CFG.TILE;
    if (Math.floor(this.player.x / T) === p.x && this.player.y / T >= 16.5 && this.player.y / T <= 33.5) {
      var f = World.nearestFree(this.player.x + T, this.player.y, this.player.r);
      this.player.x = f.x; this.player.y = f.y;
      this.toast("", "你把桌椅推过去，自己退开了一步", 1800);
    }
    p.state = "blocking";
    this.doorStates[p.barId] = "blocking";
    World.refreshDoors();
    AudioSys.stinger("door", 0.7);
    this.emitNoise(p.px, p.py, CFG.NOISE_RUN, true);
    this.toast("", "桌椅横在走廊里 —— 它得撞一阵子", 2400);
    this.ghostSawBarrier(p);
  },

  tryLock: function (p) {
    var L = LOCKS[p.lock];
    if (this.keys[L.key]) {
      // 同一把锁可能有两处（南北楼梯间），一起开
      World.props.forEach(function (p2) {
        if (p2.t === "lock" && p2.lock === p.lock) p2.state = "open";
      });
      this.doorStates[p.lock] = "open";
      World.refreshDoors();
      AudioSys.stinger("door", 1);
      this.live.addHeat(7);
      this.toast(L.name + "开了", L.open, 3000);
      this.updateObjective();
    } else {
      AudioSys.stinger("locker", 0.6);
      this.toast(L.name, L.need, 2800);
    }  },

  /* ================= 互动 ================= */
  updatePrompt: function () {
    var el = document.getElementById("prompt");
    if (!el) return;
    var p = this.player;
    var key = Input.touchMode ? "互动" : "空格";
    if (p.hidden) {
      var txt = "<b>" + key + "</b> 钻出来";
      if (p.hidingProp && p.hidingProp.danger) txt = "它就在柜门外 —— <b>" + key + "</b> 出来跑！";
      el.innerHTML = txt;
      el.classList.remove("hidden");
      return;
    }
    var t = this.target;
    if (!t) { el.classList.add("hidden"); return; }
    var label = t.label || "互动";
    if (t.clue) {
      if (this.clues[t.clue]) { el.classList.add("hidden"); return; }
    } else if (t.t === "key" && this.keys[t.key]) {
      el.classList.add("hidden"); return;
    } else if (t.t === "firedoor") {
      label = t.state === "closed" ? "拉开防火门" : "关上防火门";
    } else if (t.t === "lock") {
      label = t.state === "open" ? "门已经开了" : (t.label || "检查锁");
    }
    el.innerHTML = "<b>" + key + "</b> " + label;
    el.classList.remove("hidden");
  },

  doAction: function () {
    var p = this.player, t = this.target;
    if (this.state !== "play") return;

    if (p.hidden) {
      var prop = p.hidingProp;
      p.unhide();
      AudioSys.hide(false);
      this.flashRed = 0.25;
      this.emitNoise(p.x, p.y, CFG.NOISE_ACT, true);
      if (prop) prop.danger = false;
      this.ghost.huntProp = null;
      if (this.ghost.state === "hunt") { this.ghost.state = "chase"; this.ghost.path = []; }
      return;
    }

    if (!t) return;

    if (t.clue) {
      if (!this.clues[t.clue]) this.collectClue(t);
      return;
    }
    if (t.t === "key") { this.pickupKey(t); return; }
    if (t.t === "firedoor") { this.toggleFireDoor(t); return; }
    if (t.t === "lock") {
      if (t.state !== "open") this.tryLock(t);
      return;
    }
    if (t.t === "barricade") { this.pushBarricade(t); return; }
    if (t.t === "stairs") { this.openStairs(t); return; }
    if (t.t === "hooded") { this.talkHooded(); return; }
    if (t.hide) { this.doHide(t); return; }
    if (t.decor) { this.sayFlavor(t); return; }
  },

  doHide: function (prop) {
    var p = this.player, g = this.ghost;
    var seen = false;
    if (g.active) {
      var dx = p.x - g.x, dy = p.y - g.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < Math.min(g.sightRange(this), 260) && World.los(g.x, g.y, p.x, p.y)) seen = true;
    }
    p.hide(prop);
    AudioSys.hide(true);
    this.emitNoise(p.x, p.y, CFG.NOISE_ACT * 0.7, true);
    prop.danger = false;

    if (seen) {
      g.witnessedHide(this, prop);
      AudioSys.stinger("locker", 1);
      this.toast("它看见你躲进去了", "快出来！躲着只会让它找上门", 2600);
      this.live.say("它看见了！！", "panic");
      this.live.addHeat(6);
    } else {
      this.toast("别出声", "空格 / 互动 起身", 2200);
    }
  },

  /* 六件齐了，一楼大厅会站着一个人（不给任何提示 —— 撞见才算） */
  syncHooded: function () {
    var on = this.clueCount >= 6;
    World.props.forEach(function (p) { if (p.t === "hooded") p.active = on; });
  },

  /* 把证据交给他 = 隐藏结局 */
  talkHooded: function () {
    if (this.clueCount < 6) {
      this.toast("", "他把脸别开了，好像不想说太多", 2400);
      return;
    }
    this.state = "ending";
    AudioSys.stinger("wake", 0.7);
    this.showEnding("hidden");
  },

  collectClue: function (prop) {
    var id = prop.clue;
    var clue = CLUES[id];
    this.clues[id] = true;
    this.clueCount++;
    AudioSys.pickup();
    this.live.event("clue");
    this.updateClueUi();
    this.showDoc(id);
    this.toast(clue.toast, "", 2400);
    this.revealKeysIfReady();

    if (this.clueCount === 6) {
      this.radioSay("灵灵", "……我知道了。六件都在你手上。", 4);
      this.radioSay("灵灵", "别剪，一条一条发出去。", 4);
    }

    // 第 3 件线索开始，慢鬼就上楼了（不再等到最后）
    if (this.clueCount >= 3) this.spawnSlowGhost();
    this.syncHooded();

    if (!this.ghostWoken) {
      this.ghostWoken = true;
      this.pendingWake = true;
    }
  },

  showDoc: function (id) {
    var c = CLUES[id];
    this.state = "doc";
    document.getElementById("docKind").textContent =
      LEVELS[c.floor].floorLabel + " · 线索 " + c.order + " / 6";
    document.getElementById("docTitle").textContent = c.title;
    var body = c.body.map(function (t) { return "<p>" + t + "</p>"; }).join("");
    document.getElementById("docBody").innerHTML = body;
    document.getElementById("docBody").scrollTop = 0;
    document.getElementById("docScreen").classList.remove("hidden");
    AudioSys.resume();
  },

  /* 证据页的“继续”：正文还没到底就先滚到底，到底了才关掉 */
  advanceDoc: function () {
    var body = document.getElementById("docBody");
    if (body) {
      var more = body.scrollHeight - body.clientHeight;
      if (more > 30 && body.scrollTop < more - 30) {
        body.scrollTop = body.scrollHeight;
        return;
      }
    }
    this.closeDoc();
  },

  closeDoc: function () {
    document.getElementById("docScreen").classList.add("hidden");
    this.state = "play";
    this.last = performance.now();
    Input.clear();
    if (this.pendingWake) {
      this.pendingWake = false;
      this.wakeGhost();
    }
  },

  /* 找一个“看不见的地方”刷鬼：离得远、且被墙挡住视线 */
  findSpawnPoint: function (preferStairs) {
    var T = CFG.TILE, p = this.player;
    var cands = [];
    if (preferStairs) {
      cands = [{ x: 56, y: 12 }, { x: 6, y: 38 }];
    } else {
      for (var y = 2; y < CFG.MAP_H - 2; y += 2) {
        for (var x = 2; x < CFG.MAP_W - 2; x += 2) {
          if (World.grid[y][x] === 1) cands.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
    }
    var hidden = [], far = [];
    for (var i = 0; i < cands.length; i++) {
      var wx = cands[i].x * T, wy = cands[i].y * T;
      var d = Math.sqrt((wx - p.x) * (wx - p.x) + (wy - p.y) * (wy - p.y));
      if (d < 420) continue;
      far.push(cands[i]);
      if (!World.los(p.x, p.y, wx, wy)) hidden.push(cands[i]);
    }
    var pool = hidden.length ? hidden : far;
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  wakeGhost: function () {
    if (this.ghost.active) return;
    var g = this.ghost;
    var T = CFG.TILE;
    this.ghostWakeT = 0;
    var sp = LEVELS[this.floor].ghostSpawn;
    var pt = this.placeGhostAway(15) || { x: 30, y: 18 };
    g.spawn(pt.x * T, pt.y * T);
    g.wake();
    g.freezeT = 2.4;
    AudioSys.stinger("wake");
    this.live.event("wake");
    var self = this;
    setTimeout(function () {
      if (self.inGame && self.state === "play") {
        self.toast("她醒了", "很远的地方，有门被推开了");
      }
    }, 1200);
    this.shake = 0.6;
  },

  /* 三层：先给一个征兆，不放出鬼 */
  onEnterThirdFloor: function () {
    if (this.slowHinted) return;
    if (this.diffCfg && this.diffCfg.noSlow) return;
    this.slowHinted = true;
    if (this.slowSpawned) return;
    this.toast("楼上有东西在走", "很慢，但没有停", 3400);
    AudioSys.stinger("wake", 0.7);
    AudioSys.heavyStep(true);
    var self = this;
    setTimeout(function () {
      if (self.state === "play") self.live.say("这脚步声明明在楼上", "panic");
    }, 2500);
  },

  /* 证据过半：它从看不见的那座楼梯间走上来 */
  spawnSlowGhost: function () {
    if (this.slowSpawned) return;
    if (this.diffCfg && this.diffCfg.noSlow) return;
    this.slowSpawned = true;
    var T = CFG.TILE;
    // 七成从楼梯间上来（有“爬上来”的暗示），三成在别的角落——不固定
    var pt = Math.random() < 0.7 ? this.findSpawnPoint(true) : null;
    if (!pt) pt = this.findSpawnPoint(false);
    if (!pt) pt = { x: 56, y: 12 };
    this.slow.spawn(pt.x * T, pt.y * T, this.floor);
    AudioSys.heavyStep(true);
    AudioSys.stinger("dead", 0.8);
    this.shake = 0.7;
    this.toast("楼梯上有东西上来了", "它不会跑，也不会停", 3600);
    var self = this;
    setTimeout(function () {
      if (self.state === "play") {
        self.live.say("那脚步声是冲着这边来的", "panic");
        self.live.addHeat(12);
      }
    }, 2200);
  },

  /* ================= 对讲机 ================= */
  radioInit: function () {
    this.radioBox = document.getElementById("radio");
    this.radioText = document.getElementById("radioText");
  },

  radioPlay: function (key) {
    var lines = STORY.radio[key] || [];
    for (var i = 0; i < lines.length; i++) {
      this.radioQ.push({ who: lines[i].who, text: lines[i].text, dur: 3.6 });
    }
  },

  radioSay: function (who, text, dur) {
    this.radioQ.push({ who: who, text: text, dur: dur || 3.6 });
  },

  radioUpdate: function (dt) {
    if (!this.radioBox) return;
    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0) this.radioBox.classList.remove("show");
      return;
    }
    if (this.radioQ.length) {
      var m = this.radioQ.shift();
      this.radioText.textContent = m.who + "：" + m.text;
      this.radioBox.classList.toggle("lost", this.radioLost);
      this.radioBox.classList.remove("hidden");
      this.radioBox.classList.add("show");
      this.radioT = m.dur;
      if (AudioSys.radio) AudioSys.radio(this.radioLost);
      return;
    }
    // 失联之后，偶尔冒出一段电流
    if (this.radioLost) {
      this.radioNext -= dt;
      if (this.radioNext <= 0) {
        this.radioNext = 26 + Math.random() * 20;
        var junk = [
          "……能听到吗……",
          "……别关……",
          "……三楼……",
          "……她一直……"
        ];
        this.radioSay("？", junk[Math.floor(Math.random() * junk.length)], 2.4);
      }
    }
  },

  sayFlavor: function (prop) {    var map = {
      board: STORY.flavor.board,
      banner: STORY.flavor.banner,
      sink: STORY.flavor.sink,
      box: STORY.flavor.box
    };
    var txt = map[prop.t] || "没什么特别的。";
    if (prop.t === "board" && prop.y === 17) txt = STORY.flavor.wallPhoto;
    if (prop.t === "banner" && prop.x === 40) txt = STORY.flavor.reward;
    if (prop.t === "box" && prop.y === 19) txt = STORY.flavor.ceiling;
    if (prop.t === "banner" && prop.x === 41) txt = STORY.flavor.police;
    this.toast("", txt, 4200);
  },

  /* ================= 死亡 / 复活 ================= */
  die: function (reason) {
    if (this.state !== "play") return;
    this.state = "dead";
    this.deadReason = reason || "";
    this.deathCount = (this.deathCount || 0) + 1;
    this.updateBlood();
    this.flashRed = 1;
    this.shake = 1.4;
    Renderer.shake = 1.4;
    AudioSys.stinger("dead");

    var peak = Math.floor(Math.max(90, this.live.viewers + 120 + this.live.heat * 3));
    if (this.live.on) this.live.viewers = peak;
    this.live.event("death");
    this.emitNoise(this.player.x, this.player.y, 400, true);

    var dv = document.getElementById("deadViewers");
    if (dv) dv.textContent = peak.toLocaleString("en-US");

    var chatBox = document.getElementById("deadChat");
    if (chatBox) {
      var lines = STORY.deadChat.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 5);
      chatBox.innerHTML = lines.map(function (l) { return "<div>" + l + "</div>"; }).join("");
    }


    var self = this;
    setTimeout(function () {
      if (self.state !== "dead") return;
      // 第三次死亡：自己也消失，直接进入坏结局
      if (self.deathCount >= CFG.MAX_DEATHS) {
        self.showEnding("vanish");
        return;
      }
      var el = document.getElementById("deadScreen");
      if (el) el.classList.remove("hidden");
      self.live.sayPool("death");
      self.live.sayPool("death");
    }, 850);
  },

  retry: function () {
    var cp = this.checkpoint || { x: LEVELS[0].spawn.x * 32, y: LEVELS[0].spawn.y * 32, floor: 0 };
    this.hideAllOverlays();

    if (cp.floor !== this.floor) {
      this.floor = cp.floor;
      World.load(cp.floor, this.levelExtra(cp.floor));
      Renderer.bake();
      this.applyLevelState();
      this.updateFloorUi();
    }

    this.player.reset(cp.x, cp.y);
    this.player.stamina = 100;

    var g = this.ghost;
    this.resetGhostPosition(15);
    g.state = this.ghostWoken ? "patrol" : "sleep";
    g.active = this.ghostWoken;
    g.stuckT = 0;
    g.freezeT = 1.5;

    for (var i = 0; i < World.props.length; i++) {
      World.props[i].danger = false;
      World.props[i].hiddenInside = false;
    }

    this.target = null;
    this.curRoom = null;
    this.live.heat = Math.min(this.live.heat, 30);
    if (this.slow.active) {
      var rp = this.findSpawnPoint(false) || { x: 30, y: 18 };
      this.slow.x = rp.x * CFG.TILE;
      this.slow.y = rp.y * CFG.TILE;
      this.slow.floor = this.floor;
      this.slow.path = [];
      this.slow.freezeT = 2.2;
      this.slow.arriveT = 0;
      this.slow.countT = 0;
      this.slow.breakT = 0;
      this.slow.breaking = null;
    }
    this.cam.x = this.clampCamX(cp.x - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(cp.y - CFG.VIEW_H / 2);
    this.flashRed = 0;
    this.shake = 0;
    this.state = "play";
    this.last = performance.now();
    this.updatePrompt();
    this.updateObjective();
    Input.clear();
    this.toast("重新连接", "它记住了你的味道，但没记住你从哪来", 2600);
  },

  /* 换层 / 复活 / 天台暂停：把快鬼放到离玩家足够远、且看不见的地方 */
  placeGhostAway: function (minTiles) {
    var g = this.ghost, T = CFG.TILE, p = this.player;
    minTiles = minTiles || 13;
    var best = null, bestD = 0;
    for (var k = 0; k < 30; k++) {
      var pt = this.findSpawnPoint(false);
      if (!pt) break;
      var wx = pt.x * T, wy = pt.y * T;
      var d = Math.sqrt((wx - p.x) * (wx - p.x) + (wy - p.y) * (wy - p.y)) / T;
      if (d >= minTiles && !World.los(p.x, p.y, wx, wy)) return pt;
      if (d > bestD) { bestD = d; best = pt; }
    }
    // 兜底：四条走廊腿里最远的那个点
    var fb = [{ x: 30, y: 18 }, { x: 30, y: 31 }, { x: 5, y: 24 }, { x: 58, y: 24 }, { x: 50, y: 18 }, { x: 10, y: 31 }];
    var pick = fb[0], pd = -1;
    for (var i = 0; i < fb.length; i++) {
      var dx = fb[i].x * T - p.x, dy = fb[i].y * T - p.y;
      var dd = dx * dx + dy * dy;
      if (dd > pd) { pd = dd; pick = fb[i]; }
    }
    if (best && Math.sqrt(bestD * bestD) > Math.sqrt(pd) / T) return best;
    return pick;
  },

  /* 重新落位：位置、状态、路径一起重置 */
  /* 重新落位。
     oppositeStair：玩家是从哪一侧楼梯上来的 —— 鬼就硬性放到“对面那侧楼梯间”。
     这是硬规则，不参与随机，保证“上楼必定甩开”。 */
  resetGhostPosition: function (minTiles, oppositeStair) {
    var g = this.ghost, T = CFG.TILE, p = this.player;
    minTiles = minTiles || 15;
    var pt = null;

    if (oppositeStair) {
      // 硬规则：南边上楼 → 北楼梯间；北边上楼 → 南楼梯间。
      // 但具体落点是“那个楼梯间里随机一格”，不是固定坐标，避免每次都同一像素。
      var area = oppositeStair === "south"
        ? { x0: 50, y0: 8, x1: 59, y1: 13 }   // 北楼梯间的下半段（梯段在 y3..5）
        : { x0: 4, y0: 36, x1: 13, y1: 41 };  // 南楼梯间的上半段（梯段在 y43..45）
      for (var att = 0; att < 40; att++) {
        var rx = area.x0 + Math.floor(Math.random() * (area.x1 - area.x0 + 1));
        var ry = area.y0 + Math.floor(Math.random() * (area.y1 - area.y0 + 1));
        if (!World.inBounds(rx, ry) || World.blocked(rx, ry)) continue;
        var cx2 = (rx + 0.5) * T, cy2 = (ry + 0.5) * T;
        var d2 = Math.sqrt((cx2 - p.x) * (cx2 - p.x) + (cy2 - p.y) * (cy2 - p.y)) / T;
        if (d2 < minTiles) continue;
        if (World.los(p.x, p.y, cx2, cy2)) continue;
        pt = { x: rx + 0.5, y: ry + 0.5 };
        break;
      }
    }
    if (!pt) pt = this.placeGhostAway(minTiles);

    g.x = pt.x * T;
    g.y = pt.y * T;
    g.path = []; g.pathI = 0;
    g.state = "patrol";
    g.waypoint = null;
    g.huntProp = null;
    g.barrierProp = null;
    g.breaking = null;
    g.breakT = 0;
    g.lostT = 0;
    g.trail.length = 0;
    g.freezeT = 2.0;
  },

  /* ================= 点击寻路 ================= */
  moveTo: function (wx, wy) {
    if (this.state !== "play" || this.player.hidden) return;
    var p = this.player;
    // 隔着关着的门 / 堵着的桌椅：直接说走不到，不做绕一圈的寻路
    if (World.blockerBetween(p.x, p.y, wx, wy)) {
      this.movePath = null;
      this.moveGoal = { x: wx, y: wy, ok: false };
      AudioSys.stinger("locker", 0.4);
      this.toast("", "过不去 —— 中间隔着一扇关着的门", 2200);
      return;
    }
    var path = World.findPath(p.x, p.y, wx, wy);
    if (!path || !path.length) {
      this.movePath = null;
      this.moveGoal = { x: wx, y: wy, ok: false };
      this.toast("", "那边走不到", 1600);
      return;
    }
    this.movePath = path;
    this.moveGoal = { x: wx, y: wy, ok: true };
    // 点的是“可以自动处理”的东西（楼梯/锁/线索/钥匙/兜帽人）才记住；
    // 防火门、桌椅、柜子这些要玩家自己决定，绝不自动碰
    var cand = World.nearestProp(wx, wy, 90);
    if (cand) {
      var autoOk = (cand.clue && !this.clues[cand.clue]) || cand.t === "key" ||
        cand.t === "hooded" || cand.t === "stairs" || cand.t === "lock";
      this.moveTarget = autoOk ? cand : null;
    } else {
      this.moveTarget = null;
    }
    this.moveStuck = 0;
  },

  cancelAutoMove: function () {
    if (!this.movePath && !this.moveGoal) return;
    this.movePath = null;
    this.moveGoal = null;
    this.releaseAutoKeys = true;
  },

  /* 自动走动 + 路过互动点自动互动 */
  autoMove: function (dt) {
    if (this.state !== "play") return;
    var p = this.player;

    // 离开一段距离后，同一个互动点才能再次触发
    if (this.autoLast) {
      var lp = World.props[this.autoLast.idx];
      if (!lp || Math.sqrt((lp.px - p.x) * (lp.px - p.x) + (lp.py - p.y) * (lp.py - p.y)) > 74) this.autoLast = null;
    }

    if (!this.movePath || !this.movePath.length) {
      if (this.moveGoal && this.moveGoal.ok) { this.moveGoal = null; }
      // 自动走路结束时，把注入的方向键清掉，否则人物会一直走
      if (this.releaseAutoKeys || this.autoKeysOn) {
        this.releaseAutoKeys = false;
        this.autoKeysOn = false;
        if (!this.player.keysByUser) Input.keys = Object.create(null);
      }
      return;
    }

    var node = this.movePath[0];
    var dx = node.x - p.x, dy = node.y - p.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 9) {
      this.movePath.shift();
      if (!this.movePath.length) {
        this.movePath = null;
        this.moveGoal = null;
        this.arriveInteract();
      }
      return;
    }

    Input.keys = Object.create(null);
    this.autoKeysOn = true;
    if (Math.abs(dx) > 3) Input.keys[dx > 0 ? "d" : "a"] = true;
    if (Math.abs(dy) > 3) Input.keys[dy > 0 ? "s" : "w"] = true;

    // 卡住就停
    var moved = Math.abs(p.x - (this.autoPX || 0)) + Math.abs(p.y - (this.autoPY || 0));
    this.autoPX = p.x; this.autoPY = p.y;
    if (moved < 0.5) {
      this.moveStuck = (this.moveStuck || 0) + dt;
      if (this.moveStuck > 1.0) {
        this.moveStuck = 0;
        this.movePath = null;
        this.moveGoal = null;
        this.arriveInteract();
        if (this.state === "play") this.toast("", "路被挡住了", 1600);
      }
    } else {
      this.moveStuck = 0;
    }

    // 路过可互动的东西就顺手触发
    this.autoInteract();
  },

  /* 到达后：优先对付点击时选中的那个东西 */
  arriveInteract: function () {
    var mt = this.moveTarget;
    this.moveTarget = null;
    if (mt) {
      if (mt.t === "hooded" && !mt.active) mt = null;
      else if (mt.t === "lock" && mt.state === "open") mt = null;
      else if (mt.clue && this.clues[mt.clue]) mt = null;
    }    if (mt) {
      if (this.autoLast && this.autoLast.idx === mt.idx) return;
      this.autoLast = { idx: mt.idx };
      this.target = mt;
      this.doAction();
      return;
    }
    this.autoInteract(96);
  },

  autoInteract: function (radius) {
    if (this.state !== "play") return;
    var p = this.player;
    var t = World.nearestProp(p.x, p.y, radius || 54);
    if (!t) return;
    // 只自动触发“该自动”的：线索、钥匙、兜帽人、楼梯、锁
    var want = (t.clue && !this.clues[t.clue]) || t.t === "key" || t.t === "hooded" ||
      t.t === "stairs" || t.t === "lock";
    if (!want) return;
    if (this.autoLast && this.autoLast.idx === t.idx) return;
    this.autoLast = { idx: t.idx };
    this.doAction();
  },

  /* ================= 天台抉择 / 结局 ================= */
  openChoice: function () {
    this.state = "choice";
    AudioSys.stinger("door");
    // 这是叙事暂停：把鬼挪远，免得“再想想”回来时它就在你脸上
    this.resetGhostPosition(15);
    if (this.slow.active) {
      var sp = this.placeGhostAway(10);
      this.slow.x = sp.x * CFG.TILE;
      this.slow.y = sp.y * CFG.TILE;
      this.slow.path = [];
      this.slow.freezeT = 2.0;
    }
    // 隐藏结局现在走“一楼兜帽人”，这里不再提供
    var hb = document.getElementById("btnHidden");
    if (hb) hb.classList.add("hidden");
    var cnt = document.getElementById("choiceCount");
    if (cnt) cnt.textContent = this.clueCount + " / 6";
    var el = document.getElementById("choiceScreen");
    if (el) el.classList.remove("hidden");
    this.live.heat = Math.max(this.live.heat, 62);
    this.live.syncHud();
  },

  /* 上天台前反悔：什么都不选，回到楼里 */
  closeChoice: function () {
    var el = document.getElementById("choiceScreen");
    if (el) el.classList.add("hidden");
    this.state = "play";
    this.last = performance.now();
    Input.clear();
    this.toast("再想想", "门还开着。你可以回去，也可以再上来", 3200);
  },

  publishEvidence: function () {
    this.showEnding(this.clueCount >= 6 ? "good" : "half");
  },

  showEnding: function (kind) {
    var e = STORY.endings[kind];
    this.hideAllOverlays();
    this.state = "ending";

    // 结算用的真实数字（下播那一刻是多少就是多少）
    var peak = Math.floor(this.peakViewers || this.live.viewers);
    var fin = Math.floor(this.live.viewers);
    var mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
    var grew = Math.floor(fin - 127);
    var fmt = function (n) { return Math.max(0, Math.round(n)).toLocaleString("en-US"); };
    // 涨粉 / 掉粉都按真实数字说话（下播那一刻多少就是多少）
    var gained = grew >= 0;
    var fanLine;
    if (grew >= 50000) fanLine = "数据炸了：一夜涨了 " + fmt(grew) + " 粉";
    else if (grew >= 5000) fanLine = "数据好得离谱：一夜涨了 " + fmt(grew) + " 粉";
    else if (grew >= 500) fanLine = "数据比预想的好：一夜涨了 " + fmt(grew) + " 粉";
    else if (grew > 0) fanLine = "没爆，但确实涨了 " + fmt(grew) + " 粉";
    else if (grew === 0) fanLine = "数据很平：一夜下来一个人没多";
    else fanLine = "数据很平：一夜过去还掉了 " + fmt(Math.abs(grew)) + " 粉";
    var fanTail = grew >= 5000 ? "，私信塞满了商务合作。" : grew >= 500 ? "，私信多了几条。" : "，没什么人私信。";
    var fill = function (t) {
      return String(t).replace(/\{fanLine\}/g, fanLine).replace(/\{fanTail\}/g, fanTail)
        .replace(/\{grew\}/g, fmt(Math.abs(grew)))
        .replace(/\{grewAbs\}/g, fmt(Math.abs(grew)))
        .replace(/\{gainWord\}/g, gained ? "涨了" : "掉了")
        .replace(/\{peak\}/g, fmt(peak))
        .replace(/\{fin\}/g, fmt(fin));
    };
    document.getElementById("endingLabel").textContent = e.label;
    document.getElementById("endingTitle").textContent = e.title;
    var html = e.paras.map(function (p) { return "<p>" + fill(p) + "</p>"; }).join("");
    html += '<div class="final">' + fill(e.final) + "</div>";

    var rows = "";
    function row(k, v, cls) {
      return '<div class="settle-row"><span>' + k + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>';
    }
    if (kind === "good") {
      // 真结局：说清楚了，但被封杀
      rows += row("视频存活", "3 分 12 秒", "shut");
      rows += row("下架理由", "涉及未成年人隐私");
      rows += row("账号状态", "限制发言 30 天", "shut");
      rows += row("官方通报", "网络信息严重失实");
      rows += row("她的名字", "仍未出现", "shut");
      rows += row("线索", this.clueCount + " / 6");
      rows += row("用时", mins + ":" + (secs < 10 ? "0" : "") + secs);
    } else if (kind === "half") {
      // 假结局：涨粉成功，真相被剪掉
      rows += row("峰值在线", fmt(peak));
      rows += row("下播时在线", fmt(fin));
      rows += row(gained ? "涨粉" : "掉粉",
        (gained ? "+" : "−") + fmt(Math.abs(grew)),
        gained ? "up" : "shut");
      rows += row("被剪掉的部分", "4 / 6 件", "shut");
      rows += row("线索", this.clueCount + " / 6");
      rows += row("用时", mins + ":" + (secs < 10 ? "0" : "") + secs);
    } else if (kind === "hidden") {
      // 隐藏结局：不提粉丝
      rows += row("线索", this.clueCount + " / 6");
      rows += row("交给它的人", "1 个");
      rows += row("用时", mins + ":" + (secs < 10 ? "0" : "") + secs);
    } else if (kind === "black") {
      rows += row("删除的素材", "全部");
      rows += row("线索", this.clueCount + " / 6");
      rows += row("用时", mins + ":" + (secs < 10 ? "0" : "") + secs);
    } else {
      // 死亡结局：不谈粉丝
      rows += row("被抓", (this.deathCount || 0) + " 次");
      rows += row("线索", this.clueCount + " / 6");
      rows += row("用时", mins + ":" + (secs < 10 ? "0" : "") + secs);
    }
    html += '<div class="settle">' + rows + '</div>';
    document.getElementById("endingBody").innerHTML = html;
    document.getElementById("endingScreen").classList.remove("hidden");

    AudioSys.ambienceLevel(0);
    try {
      localStorage.setItem("schoolHorror_cleared", kind);
      localStorage.setItem("schoolHorror_time", String(Math.floor(this.time)));
      localStorage.setItem("schoolHorror_clues", String(this.clueCount));
      localStorage.setItem("schoolHorror_viewers", String(peak));
    } catch (err) { /* 隐私模式下忽略 */ }

    var poolKey = kind === "black" || kind === "vanish" ? "endingBad" : "endingGood";
    var pool = DANMAKU[poolKey];
    var self = this;
    for (var i = 0; i < 6; i++) {
      (function (n) {
        setTimeout(function () {
          if (self.state === "ending") self.live.say(pool[Math.floor(Math.random() * pool.length)]);
        }, 400 + n * 900);
      })(i);
    }
  },

  /* ================= 界面小工具 ================= */
  toast: function (big, small, ms) {
    var el = document.getElementById("toast");
    if (!el) return;
    var html = "";
    if (big) html += '<span class="big">' + big + "</span>";
    if (small) html += small;
    el.innerHTML = html;
    el.classList.add("show");
    if (this.toastT) clearTimeout(this.toastT);
    this.toastT = setTimeout(function () {
      el.classList.remove("show");
    }, ms || 2600);
  },

  showRoom: function (name) {
    var el = document.getElementById("roomName");
    if (!el) return;
    el.textContent = name;
    el.classList.add("show");
    if (this.roomT) clearTimeout(this.roomT);
    this.roomT = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  },

  /* 右上角六格：拿到几条就依次点亮几条（线索是随机的，不再按 id 对应） */
  updateClueUi: function () {
    var chips = document.querySelectorAll(".clue-chip");
    var got = [];
    for (var k in this.clues) if (this.clues[k]) got.push(this.clueOrder[k] || 0);
    got.sort(function (a, b) { return a - b; });
    for (var i = 0; i < chips.length; i++) {
      var has = i < got.length;
      chips[i].classList.toggle("found", has);
      chips[i].textContent = has ? String(got[i]) : "?";
    }
  },

  updateObjective: function () {
    var el = document.getElementById("objective");
    if (!el) return;
    var f = this.floor;
    var keyId = "key" + (f + 1);
    var lockId = "lock" + (f + 1);
    var n = this.floorClueCount(f);
    var now = ["一层", "二层", "三层"][f];
    var txt;

    if (n < 2) {
      txt = now + "：找齐 2 件线索（" + n + "/2）";
    } else if (!this.keys[keyId]) {
      var kf = KEYS[keyId].floor;
      var kroom = (this.keyPick && this.keyPick[kf] && this.keyPick[kf].room) || KEYS[keyId].room;
      txt = "回" + kroom + "拿" + KEYS[keyId].short;
    } else if (this.doorStates[lockId] !== "open") {
      txt = "用" + KEYS[keyId].name + "打开" + LOCKS[lockId].name;
    } else if (f < 2) {
      txt = "上楼（" + LEVELS[f + 1].floorLabel + "）";
    } else {
      txt = "去天台（走廊尽头的楼梯）";
    }
    el.textContent = txt;
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { Game.init(); });
} else {
  Game.init();
}

