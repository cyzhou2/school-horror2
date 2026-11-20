/* ================= 输入：键盘 + 触屏摇杆 ================= */
"use strict";

var Input = {
  keys: Object.create(null),
  axisX: 0, axisY: 0,
  runKey: false,
  touchRun: false,
  touchMode: false,
  actionQueued: false,
  liveQueued: false,
  pointers: { stick: null },
  dom: {},

  init: function () {
    var self = this;
    this.dom.stick = document.getElementById("stick");
    this.dom.knob = document.getElementById("knob");
    this.dom.touch = document.getElementById("touch");
    this.dom.btnRun = document.getElementById("btnRun");
    this.dom.btnAct = document.getElementById("btnAct");
    this.dom.btnLive = document.getElementById("btnLive");

    /* ---------- 键盘 ---------- */
    window.addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "spacebar"].indexOf(k) >= 0) e.preventDefault();
      self.keys[k] = true;
      if (k === " " || k === "e") self.actionQueued = true;
      if (k === "l") self.liveQueued = true;
      if (k === "m") { var m = AudioSys.toggleMute(); Game.toast(m ? "已静音" : "已恢复声音", ""); }
      if (k === "shift") self.runKey = true;
      if (k === "escape" && Game.inGame) Game.togglePause();
      // 手动按方向键 = 取消点击寻路
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) >= 0) {
        if (Game.cancelAutoMove) Game.cancelAutoMove();
      }
    });
    window.addEventListener("keyup", function (e) {
      var k = e.key.toLowerCase();
      self.keys[k] = false;
      if (k === "shift") self.runKey = false;
    });
    window.addEventListener("blur", function () {
      self.keys = Object.create(null);
      self.runKey = false;
      self.axisX = self.axisY = 0;
    });

    /* ---------- 点击寻路（鼠标 / 触屏都吃） ---------- */
    var viewEl = document.getElementById("view");
    if (viewEl) {
      viewEl.addEventListener("pointerdown", function (e) {
        if (typeof Game === "undefined" || !Game.inGame || Game.state !== "play") return;
        var r = viewEl.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var sx = (e.clientX - r.left) * (viewEl.width / r.width);
        var sy = (e.clientY - r.top) * (viewEl.height / r.height);
        Game.moveTo(sx + Game.cam.x, sy + Game.cam.y);
      });
    }

    /* ---------- 触屏 ---------- */
    var enableTouch = function () {
      if (self.touchMode) return;
      self.touchMode = true;
      self.dom.touch.classList.remove("hidden");
      document.body.classList.add("touch");
    };
    window.addEventListener("touchstart", enableTouch, { once: true, passive: true });

    if (this.dom.stick) {
      var stickEl = this.dom.stick;
      var onDown = function (e) {
        enableTouch();
        e.preventDefault();
        var p = e.changedTouches ? e.changedTouches[0] : e;
        self.pointers.stick = p.identifier !== undefined ? p.identifier : "mouse";
        self.updateStick(p);
        try {
          if (stickEl.setPointerCapture && e.pointerId !== undefined) stickEl.setPointerCapture(e.pointerId);
        } catch (err) { /* 某些浏览器对合成指针会抛错 */ }
      };
      var onMove = function (e) {
        if (self.pointers.stick === null) return;
        e.preventDefault();
        var p = e.changedTouches ? e.changedTouches[0] : e;
        var id = p.identifier !== undefined ? p.identifier : "mouse";
        if (id !== self.pointers.stick) return;
        self.updateStick(p);
      };
      var onUp = function (e) {
        self.pointers.stick = null;
        self.axisX = self.axisY = 0;
        self.dom.knob.style.transform = "translate(0,0)";
      };
      stickEl.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    var bindPress = function (el, onDownFn, onUpFn) {
      if (!el) return;
      el.addEventListener("pointerdown", function (e) {
        e.preventDefault(); enableTouch();
        el.classList.add("on");
        if (onDownFn) onDownFn();
      });
      var up = function () {
        el.classList.remove("on");
        if (onUpFn) onUpFn();
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    };

    bindPress(this.dom.btnAct, function () { self.actionQueued = true; }, null);
    bindPress(this.dom.btnRun, function () { self.touchRun = true; }, function () { self.touchRun = false; });
    bindPress(this.dom.btnLive, function () { self.liveQueued = true; }, null);
  },

  updateStick: function (p) {
    var el = this.dom.stick;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = p.clientX - cx, dy = p.clientY - cy;
    var max = r.width * 0.36;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var k = dist > max ? max / dist : 1;
    var kx = dx * k, ky = dy * k;
    this.dom.knob.style.transform = "translate(" + kx.toFixed(1) + "px," + ky.toFixed(1) + "px)";
    var nx = dx / max, ny = dy / max;
    if (Math.sqrt(nx * nx + ny * ny) > 0.3 && Game.cancelAutoMove) Game.cancelAutoMove();
    var len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1) { nx /= len; ny /= len; }
    if (len < 0.18) { nx = 0; ny = 0; }
    this.axisX = nx; this.axisY = ny;
  },

  /* 归一化移动向量 */
  vector: function () {
    var x = 0, y = 0;
    if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) x += 1;
    if (this.keys["w"] || this.keys["arrowup"]) y -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) y += 1;
    if (x || y) {
      var l = Math.sqrt(x * x + y * y);
      return { x: x / l, y: y / l };
    }
    if (this.axisX || this.axisY) {
      return { x: this.axisX, y: this.axisY };
    }
    return { x: 0, y: 0 };
  },

  wantsRun: function () {
    return this.runKey || this.touchRun;
  },

  takeAction: function () {
    if (!this.actionQueued) return false;
    this.actionQueued = false;
    return true;
  },

  takeLive: function () {
    if (!this.liveQueued) return false;
    this.liveQueued = false;
    return true;
  },

  clear: function () {
    this.actionQueued = false;
    this.liveQueued = false;
    this.axisX = this.axisY = 0;
    this.pointers.stick = null;
  }
};
