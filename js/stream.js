/* ================= 直播系统：人气、热度、弹幕 ================= */
"use strict";

var Live = {
  on: true,
  viewers: 127,
  heat: 0,
  spawnT: 1.5,
  warnCd: 4,
  spurt: 0,
  silenceT: 0,
  dom: {},
  items: [],

  reset: function () {
    this.on = true;
    this.viewers = 127;
    this.heat = 0;
    this.spawnT = 1.4;
    this.warnCd = 5;
    this.spurt = 0;
    this.silenceT = 0;
    var box = this.dom.box;
    if (box) box.innerHTML = "";
    this.items = [];
    this.rowFree = [0, 0, 0, 0, 0, 0];
    this.rowCursor = 0;
    this.syncHud();
  },

  initDom: function () {
    this.dom.box = document.getElementById("danmaku");
    this.dom.viewerNum = document.getElementById("viewerNum");
    this.dom.badge = document.getElementById("liveBadge");
    this.dom.heat = document.getElementById("heatFill");
    this.dom.status = document.getElementById("statusText");
  },

  syncHud: function () {
    if (this.dom.viewerNum) this.dom.viewerNum.textContent = Math.floor(this.viewers).toLocaleString("en-US");
    if (this.dom.heat) this.dom.heat.style.width = Math.max(0, Math.min(100, this.heat)) + "%";
    if (this.dom.badge) {
      this.dom.badge.classList.toggle("off", !this.on);
      var label = this.on ? (this.silenceT > 0 ? "限流" : "LIVE") : "已关播";
      this.dom.badge.innerHTML = '<span class="dot"></span>' + label;
      this.dom.badge.classList.toggle("silenced", this.on && this.silenceT > 0);
    }
    if (this.dom.status) {
      if (this.silenceT > 0 && this.on) {
        this.dom.status.textContent = "平台限流 " + Math.ceil(this.silenceT) + " 秒";
      } else if (!this.on) {
        this.dom.status.textContent = "信号已断开";
      } else {
        this.dom.status.textContent = this.heat > 70 ? "热度爆了" : this.heat > 40 ? "人气上升中" : "直播中";
      }
    }
  },

  /* 死亡惩罚 A：平台限流 —— 弹幕消失、热度清零、人数砍半 */
  punish: function () {
    this.viewers = Math.max(90, Math.floor(this.viewers * 0.5));
    this.heat = 0;
    this.silenceT = 90;
    var box = this.dom.box;
    if (box) box.innerHTML = "";
    this.items = [];
    this.syncHud();
  },

  toggle: function (g) {
    this.on = !this.on;
    if (!this.on) {
      this.say("【系统】直播已暂停", "hot");
      this.heat = Math.max(0, this.heat * 0.4);
      g.toast("已关闭直播", "热度会降下来，鬼也不那么兴奋了");
    } else {
      this.say("【系统】直播恢复", "hot");
      g.toast("已恢复直播", "人气又回来了，它也回来了");
    }
    this.syncHud();
  },

  addHeat: function (n, cap) {
    if (!this.on) return;
    this.heat = Math.min(cap || 100, this.heat + n);
  },

  update: function (dt, g) {
    var gh = g.ghost;
    var near = 0;
    if (gh && gh.active) {
      var dx = g.player.x - gh.x, dy = g.player.y - gh.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      near = d < 320 ? (1 - d / 320) : 0;
    }

    if (this.silenceT > 0) {
      this.silenceT = Math.max(0, this.silenceT - dt);
      if (this.silenceT === 0) this.say("【系统】限流解除", "hot");
      this.syncHud();
      return;
    }

    if (this.on) {
      var gain = 0.45 + near * 3.2 + (g.player.running ? 1.6 : 0);
      this.heat = Math.min(100, this.heat + gain * dt);
      this.viewers += dt * (0.25 + this.heat * 0.24 + near * 6);
      this.spurt -= dt;
    } else {
      this.heat = Math.max(0, this.heat - 14 * dt);
      this.viewers *= (1 - 0.012 * dt);
      this.spurt = 0;
    }

    if (this.viewers < 90) this.viewers = 90;

    // 弹幕
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      var base = this.on ? (2.6 - this.heat * 0.019) : 7;
      this.spawnT = Math.max(0.85, base) + Math.random() * 1.1;
      if (this.on) {
        var pool = "idle";
        if (this.heat > 55) pool = "hot";
        if (near > 0.35) pool = "panic";
        this.sayPool(pool);
        if (this.heat > 78 && Math.random() < 0.5) this.sayPool("hot");
      }
    }

    // 危险提示：热度越高，观众越会提醒你
    this.warnCd -= dt;
    if (this.on && this.warnCd <= 0 && near > 0.2 && gh && gh.active) {
      this.warnCd = Math.max(3.5, 11 - this.heat * 0.09);
      var side;
      var rel = g.player.x - gh.x;
      if (Math.abs(rel) < 60) side = "就在你正后方！！";
      else if (rel > 0) side = "左边！！它在左边";
      else side = "右边！！";
      this.say(gh.state === "chase" ? "快跑，它冲过来了" + side : "后面" + side, "panic");
    }

    this.syncHud();
  },

  sayPool: function (key) {
    var pool = DANMAKU[key] || DANMAKU.idle;
    this.say(pool[Math.floor(Math.random() * pool.length)]);
  },

  say: function (text, cls) {
    var box = this.dom.box;
    if (!box) return;
    var el = document.createElement("div");
    el.className = "dm" + (cls ? " " + cls : "");
    el.textContent = text;

    var boxW = box.clientWidth || 800;
    var rows = 6;
    var now = performance.now() / 1000;

    // 按行分配：避免两条弹幕叠在一起
    if (!this.rowFree) this.rowFree = [0, 0, 0, 0, 0, 0];
    if (this.rowCursor === undefined) this.rowCursor = 0;
    var row = -1;
    for (var k = 0; k < rows; k++) {
      var cand = (this.rowCursor + k) % rows;
      if (this.rowFree[cand] <= now) { row = cand; break; }
    }
    if (row < 0) {
      // 全忙：选最早空出来的那一行
      row = 0;
      for (var m = 1; m < rows; m++) if (this.rowFree[m] < this.rowFree[row]) row = m;
    }
    this.rowCursor = (row + 1) % rows;
    this.rowFree[row] = now + 3.4;

    box.appendChild(el);
    el.style.top = (row * 24 + 2) + "px";
    el.style.left = boxW + "px";

    var w = el.offsetWidth || 160;
    var dur = 9 + Math.random() * 5;
    el.style.setProperty("--dx", (-(boxW + w + 40)) + "px");
    el.style.animationDuration = dur + "s";

    this.items.push(el);
    while (this.items.length > 34) {
      var old = this.items.shift();
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    var self = this;
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      var i = self.items.indexOf(el);
      if (i >= 0) self.items.splice(i, 1);
    }, dur * 1000 + 300);
  },

  /* 事件型弹幕 */
  event: function (kind) {
    switch (kind) {
      case "clue":
        this.addHeat(9);
        this.viewers += 40 + this.heat * 2;
        this.sayPool("clue");
        break;
      case "wake":
        this.addHeat(14);
        this.say("什么东西在动？", "panic");
        break;
      case "hide":
        this.say("它看过来了你看不见？", "hot");
        break;
      case "death":
        this.spurt = 2;
        break;
    }
  }
};
