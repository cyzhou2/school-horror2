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
  live: Live,

  clues: {},
  clueCount: 0,
  keys: {},
  doorStates: {},
  revealedKeys: {},
  floor: 0,

  lightOn: true,
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
      vh = 540;
      vw = Math.round(Math.min(1180, 540 * aspect));
    } else {
      vw = 540;
      vh = Math.round(Math.min(1200, 540 / aspect));
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
    on("btnDocClose", function () { self.closeDoc(); });
    on("btnRetry", function () { self.retry(); });
    on("btnGiveUp", function () { self.toTitle(); });
    on("btnPublish", function () { self.publishEvidence(); });
    on("btnDelete", function () { self.showEnding("black"); });
    on("btnHidden", function () { self.showEnding("hidden"); });
    on("btnEndBack", function () { self.toTitle(); });
    on("btnStairUp", function () { self.useStairs(1); });
    on("btnStairDown", function () { self.useStairs(-1); });
    on("btnStairClose", function () { self.closeStairs(); });
  },

  buildPauseEl: function () {
    var d = document.createElement("div");
    d.className = "overlay dark hidden";
    d.id = "pauseScreen";
    d.innerHTML = '<div class="title-wrap"><div class="ending-label">暂停</div>' +
      '<p class="choice-body">直播还在继续，观众在等你回来。<br><br>按 ESC 继续。</p></div>';
    document.getElementById("app").appendChild(d);
    this.pauseEl = d;
  },

  /* ================= 开关局 ================= */
  startRun: function () {
    AudioSys.resume();
    AudioSys.startAmbience();

    this.hideAllOverlays();
    this.clues = { tape: false, log: false, letter: false, rec: false, phone: false, uniform: false };
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

    this.floor = 0;
    World.build(0);
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
    var dt = (ts - this.last) / 1000;
    this.last = ts;
    if (dt > 0.06) dt = 0.06;
    if (dt < 0) dt = 0;
    this.dt = dt;

    if (this.state === "play" || this.state === "title") this.time += dt;

    if (this.state === "play") this.update(dt);
    else if (this.state === "title") this.updateIdle(dt);

    if (this.inGame) Renderer.draw(this);
    else this.drawTitleBg();

    var self = this;
    requestAnimationFrame(function (t) { self.loop(t); });
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

    g.update(dt, this);
    this.live.update(dt, this);
    if (this.live.on) this.liveOnTime += dt;

    // 房间
    var room = World.roomAt(p.x, p.y);
    if (room && (!this.curRoom || room.id !== this.curRoom.id)) {
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

    // 心跳与灯管
    if (g.active) {
      var dx = p.x - g.x, dy = p.y - g.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 340) {
        var near = 1 - d / 340;
        this.heartT -= dt;
        if (this.heartT <= 0) {
          this.heartT = Math.max(0.42, 1.35 - near * 1.0);
          AudioSys.heart(0.5 + near);
          if (near > 0.55 && Math.random() < 0.4) AudioSys.breath();
          this.shake = Math.min(1, this.shake + near * 0.05);
        }
      }
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

    if (!this.heatHinted && this.live.heat > 62) {
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
  applyLevelState: function () {
    var self = this;
    World.props.forEach(function (p) {
      if (p.dynamic) {
        var id = p.t === "firedoor" ? p.doorId : p.lock;
        var st = self.doorStates[id];
        if (p.t === "firedoor") p.state = st === "closed" ? "closed" : "open";
        else p.state = st === "open" ? "open" : "closed";
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

  /* ================= 楼梯 ================= */
  openStairs: function () {
    this.state = "stairs";
    var up = document.getElementById("btnStairUp");
    var down = document.getElementById("btnStairDown");
    if (up) up.textContent = this.floor >= 2 ? "上天台" : "上楼（" + LEVELS[this.floor + 1].floorLabel + "）";
    if (down) down.classList.toggle("hidden", this.floor <= 0);
    var info = document.getElementById("stairInfo");
    if (info) info.textContent = LEVELS[this.floor].name + " · 楼梯间";
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
    this.closeStairs();
    if (dir > 0) {
      if (this.floor >= 2) { this.openChoice(); return; }
      this.changeFloor(this.floor + 1);
    } else {
      if (this.floor <= 0) return;
      this.changeFloor(this.floor - 1);
    }
  },

  changeFloor: function (target) {
    this.floor = target;
    World.load(target);
    Renderer.bake();
    this.applyLevelState();

    var px = 57.2 * CFG.TILE, py = 19.5 * CFG.TILE;
    this.player.x = px; this.player.y = py;
    this.player.hidden = false;
    this.player.hidingProp = null;
    this.player.stamina = Math.max(this.player.stamina, 40);
    this.player.face = -Math.PI / 2;

    this.curRoom = null;
    this.checkpoint = { x: px, y: py, floor: target };

    if (this.ghostWoken) {
      var gs = LEVELS[target].ghostSpawn;
      this.ghost.active = true;
      this.ghost.x = gs.x * CFG.TILE;
      this.ghost.y = gs.y * CFG.TILE;
      this.ghost.state = "patrol";
      this.ghost.path = [];
      this.ghost.trail = [];
      this.ghost.freezeT = 1.2;
    }

    this.cam.x = this.clampCamX(px - CFG.VIEW_W / 2);
    this.cam.y = this.clampCamY(py - CFG.VIEW_H / 2);
    this.updateFloorUi();
    this.updateObjective();
    this.showRoom(LEVELS[target].name);
    AudioSys.stinger("door", 0.6);
    this.emitNoise(px, py, CFG.NOISE_ACT, true);
    this.toast("", LEVELS[target].name, 2200);

    if (target === 2) this.onEnterThirdFloor();
  },

  /* ================= 钥匙与线索 ================= */
  clueReady: function (need) {
    for (var i = 0; i < need.length; i++) if (!this.clues[need[i]]) return false;
    return true;
  },

  revealKeysIfReady: function () {
    for (var k in KEYS) {
      if (this.keys[k] || this.revealedKeys[k]) continue;
      if (!this.clueReady(KEYS[k].need)) continue;
      this.revealedKeys[k] = true;
      World.props.forEach(function (p) {
        if (p.t === "key" && p.key === k) p.revealed = true;
      });
      this.toast("想起来了", KEYS[k].toast + " —— 去拿" + KEYS[k].name, 3400);
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
  },

  /* ================= 门 ================= */
  toggleFireDoor: function (p) {
    var T = CFG.TILE;
    var rx = p.x * T, ry = p.y * T, rw = p.w * T, rh = p.h * T;
    var px = this.player.x, py = this.player.y, r = this.player.r + 2;
    var over = px + r > rx && px - r < rx + rw && py + r > ry && py - r < ry + rh;

    if (p.state === "closed") {
      p.state = "open";
      this.doorStates[p.doorId] = "open";
      AudioSys.stinger("door", 0.7);
      this.toast("", "防火门拉开了", 1500);
    } else {
      if (over) { this.toast("", "你正站在门里，关不上", 1500); return; }
      p.state = "closed";
      this.doorStates[p.doorId] = "closed";
      AudioSys.hide(true);
      this.emitNoise(p.px, p.py, CFG.NOISE_ACT, true);
      this.toast("", "防火门关上 —— 它撞开要几秒", 2000);
    }
    World.refreshDoors();
  },

  tryLock: function (p) {
    var L = LOCKS[p.lock];
    if (this.keys[L.key]) {
      p.state = "open";
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
    if (t.t === "stairs") { this.openStairs(); return; }
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

  wakeGhost: function () {
    if (this.ghost.active) return;
    this.ghost.wake();
    AudioSys.stinger("wake");
    this.live.event("wake");
    var self = this;
    setTimeout(function () {
      if (self.inGame && self.state === "play") {
        self.toast("她醒了", "器材室的门自己开了");
      }
    }, 900);
    this.shake = 0.6;
  },

  /* 三层：慢鬼登场（阶段二接上，这里先留演出钩子） */
  onEnterThirdFloor: function () {
    if (this.slowSpawned) return;
    this.slowSpawned = true;
    this.toast("楼上有东西在走", "很慢，但没有停", 3200);
    AudioSys.stinger("wake", 0.7);
  },

  sayFlavor: function (prop) {
    var map = {
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
    this.flashRed = 1;
    this.shake = 1.4;
    Renderer.shake = 1.4;
    AudioSys.stinger("dead");
    if (this.live.on) this.live.viewers += 120 + this.live.heat * 3;
    this.live.event("death");
    this.emitNoise(this.player.x, this.player.y, 400, true);

    var dv = document.getElementById("deadViewers");
    if (dv) dv.textContent = Math.floor(this.live.viewers).toLocaleString("en-US");

    var chatBox = document.getElementById("deadChat");
    if (chatBox) {
      var lines = STORY.deadChat.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 5);
      chatBox.innerHTML = lines.map(function (l) { return "<div>" + l + "</div>"; }).join("");
    }

    var self = this;
    setTimeout(function () {
      if (self.state !== "dead") return;
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
      World.load(cp.floor);
      Renderer.bake();
      this.applyLevelState();
      this.updateFloorUi();
    }

    this.player.reset(cp.x, cp.y);
    this.player.stamina = 100;

    var g = this.ghost;
    var gs = LEVELS[this.floor].ghostSpawn;
    g.x = gs.x * CFG.TILE;
    g.y = gs.y * CFG.TILE;
    g.path = []; g.pathI = 0; g.trail = []; g.huntProp = null;
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

  /* ================= 天台抉择 / 结局 ================= */
  openChoice: function () {
    this.state = "choice";
    AudioSys.stinger("door");
    var hb = document.getElementById("btnHidden");
    if (hb) hb.classList.toggle("hidden", !(this.liveOnTime < 30));
    var cnt = document.getElementById("choiceCount");
    if (cnt) cnt.textContent = this.clueCount + " / 6";
    var el = document.getElementById("choiceScreen");
    if (el) el.classList.remove("hidden");
    this.live.heat = Math.max(this.live.heat, 62);
    this.live.syncHud();
  },

  publishEvidence: function () {
    this.showEnding(this.clueCount >= 6 ? "good" : "half");
  },

  showEnding: function (kind) {
    var e = STORY.endings[kind];
    this.hideAllOverlays();
    this.state = "ending";

    document.getElementById("endingLabel").textContent = e.label;
    document.getElementById("endingTitle").textContent = e.title;
    var html = e.paras.map(function (p) { return "<p>" + p + "</p>"; }).join("");
    html += '<div class="final">' + e.final + "</div>";
    document.getElementById("endingBody").innerHTML = html;
    document.getElementById("endingScreen").classList.remove("hidden");

    AudioSys.ambienceLevel(0);
    try {
      localStorage.setItem("schoolHorror_cleared", kind);
      localStorage.setItem("schoolHorror_time", String(Math.floor(this.time)));
      localStorage.setItem("schoolHorror_clues", String(this.clueCount));
    } catch (err) { /* 隐私模式下忽略 */ }

    var poolKey = kind === "good" || kind === "half" ? "endingGood" : kind === "black" ? "endingBad" : "endingGood";
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

  updateClueUi: function () {
    var chips = document.querySelectorAll(".clue-chip");
    for (var i = 0; i < chips.length; i++) {
      var key = chips[i].getAttribute("data-clue");
      var got = !!this.clues[key];
      chips[i].classList.toggle("found", got);
      chips[i].textContent = got ? String(CLUES[key].order) : "?";
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
      txt = "拿到" + KEYS[keyId].name;
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

