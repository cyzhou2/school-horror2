/* ================= 输入：键盘 + 触屏摇杆 ================= */
"use strict";

var Input = {
  keys: Object.create(null),
  axisX: 0, axisY: 0,
  runKey: false,
  runToggle: false,
  touchRun: false,
  touchMode: false,
  actionQueued: false,
  liveQueued: false,
  dom: {},

  init: function () {
    var self = this;
    this.dom.touch = document.getElementById("touch");
    this.dom.btnRun = document.getElementById("btnRun");
    this.dom.btnAct = document.getElementById("btnAct");
    this.dom.btnLive = document.getElementById("btnLive");

    /* ---------- 键盘 ---------- */
    // CapsLock（大小写锁定）本身就是跑步开关；Shift 临时反转
    var syncCaps = function (e) {
      if (typeof e.getModifierState !== "function") return;
      var on = false;
      try { on = e.getModifierState("CapsLock"); } catch (err) { return; }
      if (on !== self.runToggle) {
        self.runToggle = on;
        self.syncRunUi(true);
      }
    };
    window.addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase();
      if (k === "capslock") {
        e.preventDefault();
        // 直接读物理锁定状态（有的浏览器会连发两次 keydown，切换式会跳两下）
        var caps = false;
        try { caps = e.getModifierState ? e.getModifierState("CapsLock") : !self.runToggle; } catch (err) { caps = !self.runToggle; }
        self.setRunToggle(caps);
        self.syncRunUi(true);
        return;
      }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "spacebar"].indexOf(k) >= 0) e.preventDefault();
      self.keys[k] = true;
      if (k === " " || k === "e") self.actionQueued = true;
      if (k === "l") self.liveQueued = true;
      if (k === "m") { var m = AudioSys.toggleMute(); Game.toast(m ? "已静音" : "已恢复声音", ""); }
      if (k === "shift") self.runKey = true;
      if ((k === "escape" || k === "p") && Game.inGame && Game.state !== "ending") Game.togglePause();
      // 手动按方向键 = 取消点击寻路
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) >= 0) {
        if (Game.cancelAutoMove) Game.cancelAutoMove();
      }
      syncCaps(e);
    });
    window.addEventListener("keyup", function (e) {
      var k = e.key.toLowerCase();
      self.keys[k] = false;
      if (k === "shift") self.runKey = false;
      syncCaps(e);
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

    var muteBtn = document.getElementById("btnMute");
    if (muteBtn) {
      var syncMute = function () {
        var m = AudioSys.muted;
        muteBtn.classList.toggle("muted", m);
        muteBtn.textContent = m ? "✕" : "♪";
      };
      muteBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        AudioSys.resume();
        AudioSys.toggleMute();
        syncMute();
      });
      this.syncMute = syncMute;
      syncMute();
    }

    /* ---------- 亮度：按钮开关面板，竖条拖动 ---------- */
    var brightBtn = document.getElementById("btnBright");
    var brightPanel = document.getElementById("brightPanel");
    var brightTrack = document.getElementById("brightTrack");
    if (brightBtn && brightPanel && brightTrack) {
      var dragging = false;
      var applyFromY = function (clientY) {
        var rc = brightTrack.getBoundingClientRect();
        var k = 1 - (clientY - rc.top) / rc.height;
        k = Math.max(0, Math.min(1, k));
        if (Game && Game.setBrightness) {
          Game.setBrightness(Game.BRIGHT_MIN + k * (Game.BRIGHT_MAX - Game.BRIGHT_MIN), true);
        }
      };
      brightBtn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var open = brightPanel.classList.contains("hidden");
        brightPanel.classList.toggle("hidden", !open);
        brightBtn.classList.toggle("on", open);
      });
      brightTrack.addEventListener("pointerdown", function (e) {
        e.preventDefault(); e.stopPropagation();
        dragging = true;
        applyFromY(e.clientY);
        try { brightTrack.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      });
      window.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        e.preventDefault();
        applyFromY(e.clientY);
      }, { passive: false });
      window.addEventListener("pointerup", function () { dragging = false; });
      window.addEventListener("pointercancel", function () { dragging = false; });
    }

    bindPress(this.dom.btnAct, function () { self.actionQueued = true; }, null);
    // 手机上跑步是“开关”（相当于大小写锁定）：点一下切换，不随松手复位
    var runBtn = this.dom.btnRun;
    if (runBtn) {
      var lastTap = 0;
      var onTap = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (now - lastTap < 130) return;      // 防止 pointerdown + click 连发
        lastTap = now;
        enableTouch();
        self.toggleRun();
      };
      runBtn.addEventListener("pointerdown", onTap);
      runBtn.addEventListener("click", onTap);
    }
    bindPress(this.dom.btnLive, function () { self.liveQueued = true; }, null);
    this.syncRunUi();
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

  /* 跑步是“开关”式的：CapsLock 切状态，Shift 临时把它反过来 */
  wantsRun: function () {
    return (this.runToggle ? !this.runKey : this.runKey);
  },

  setRunToggle: function (v) {
    this.runToggle = !!v;
    this.syncRunUi();
  },

  toggleRun: function () {
    this.setRunToggle(!this.runToggle);
    this.syncRunUi(true);
  },

  syncRunUi: function (announce) {
    var b = this.dom && this.dom.btnRun;
    var on = this.runToggle;
    if (b) {
      b.textContent = on ? "走" : "跑";
      b.classList.toggle("on", on);
    }
    if (announce && typeof Game !== "undefined" && Game.toast) {
      var tip;
      if (this.touchMode) {
        tip = on ? "点过的地方，他会跑过去 —— 声音更大，也更费体力" : "点过的地方，他会走过去 —— 更安静";
      } else {
        tip = on ? "现在按住方向会跑，Shift 临时改成走" : "现在按住方向是走，Shift 临时改成跑";
      }
      Game.toast(on ? "跑" : "走", tip, 2200);
    }
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
  }
};
