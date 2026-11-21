/* ================= 世界：多楼层地图、碰撞、视线、寻路 ================= */
"use strict";

var World = {
  T: 32,
  levelIndex: 0,
  level: null,
  dynVersion: 0,
  grid: null,       // 0 墙 / 1 地板
  solid: null,      // 静态物件占位
  dyn: null,        // 动态物件（门 / 锁）占位
  props: null,
  rooms: null,

  build: function (levelIndex, extra) {
    this.load(levelIndex || 0, extra);
    return this;
  },

  load: function (idx, extra) {
    var lv = LEVELS[idx];
    if (!lv) return;
    this.levelIndex = idx;
    this.level = lv;
    var W = CFG.MAP_W, H = CFG.MAP_H, i, j;
    this.T = CFG.TILE;

    this.grid = [];
    this.solid = [];
    this.tall = [];
    this.dyn = [];
    this.dynOp = [];
    for (j = 0; j < H; j++) {
      this.grid.push(new Array(W).fill(0));
      this.solid.push(new Array(W).fill(0));
      this.tall.push(new Array(W).fill(0));
      this.dyn.push(new Array(W).fill(0));
      this.dynOp.push(new Array(W).fill(0));
    }

    // 房间
    this.rooms = lv.rooms.map(function (r) {
      var o = { id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, tint: r.tint };
      o.cx = (r.x + r.w / 2) * CFG.TILE;
      o.cy = (r.y + r.h / 2) * CFG.TILE;
      return o;
    });
    this.rooms.forEach(function (r) {
      for (var y = r.y; y < r.y + r.h; y++)
        for (var x = r.x; x < r.x + r.w; x++)
          this.grid[y][x] = 1;
    }, this);

    // 门洞
    lv.doorways.forEach(function (d) {
      var w = d.w || 1;
      for (var k = 0; k < w; k++) this.grid[d.y][d.x + k] = 1;
    }, this);

    // 拐角空场
    (lv.plazas || []).forEach(function (pz) {
      for (var y = pz.y; y < pz.y + pz.h; y++)
        for (var x = pz.x; x < pz.x + pz.w; x++)
          if (this.inBounds(x, y)) this.grid[y][x] = 1;
    }, this);

    // 物件（本局随机挑好的线索与钥匙会作为额外物件加进来）
    var allProps = lv.props.slice();
    if (extra) {
      (extra.clues || []).forEach(function (c) {
        allProps.push({ t: "clue", x: c.x, y: c.y, clue: c.id, label: c.label });
      });
      if (extra.key) {
        allProps.push({ t: "key", x: extra.key.x, y: extra.key.y, key: extra.key.id, label: extra.key.label || "拿走钥匙" });
      }
    }
    this.props = allProps.map(function (p, idx2) {
      var type = p.t;
      var solid = !(p.decor || type === "clue" || type === "key");
      // 低矮家具：挡路，但不挡视线（桌椅、纸箱、洗手台、长条实验台等）
      var low = type === "desk" || type === "box" || type === "counter" ||
        type === "sink" || type === "banner" || type === "barricade" || type === "bench";
      var dynamic = (type === "firedoor" || type === "lock" || type === "barricade" || type === "hooded");
      var o = {
        idx: idx2, t: type,
        x: p.x, y: p.y, w: p.w || 1, h: p.h || 1,
        hide: !!p.hide, decor: !!p.decor,
        clue: p.clue || null, key: p.key || null,
        lock: p.lock || null, doorId: p.doorId || null, barId: p.barId || null,
        stairId: p.stairId || null,
        block: p.bx !== undefined ? { x: p.bx, y: p.by, w: p.bw || 1, h: p.bh || 1 } : null,
        label: p.label || "",
        px: (p.x + (p.w || 1) / 2) * CFG.TILE,
        py: (p.y + (p.h || 1) / 2) * CFG.TILE,
        dynamic: dynamic,
        low: low,
        state: type === "hooded" ? "static" : (dynamic ? (type === "barricade" ? "ready" : "closed") : "static"),
        solid: solid && !dynamic,
        active: false,
        hiddenInside: false,
        danger: false,
        revealed: false
      };
      return o;
    });
    this.props.forEach(function (p) {
      if (!p.solid) return;
      this.fillSolid(p, 1, this.solid);
      if (!p.low) this.fillSolid(p, 1, this.tall);
    }, this);

    this.refreshDoors();
    return this;
  },

  fillSolid: function (p, v, arr) {
    for (var y = Math.floor(p.y); y < Math.ceil(p.y + p.h); y++)
      for (var x = Math.floor(p.x); x < Math.ceil(p.x + p.w); x++)
        if (this.inBounds(x, y)) arr[y][x] = v;
  },

  /* 门/锁/堵门会改变通行性；只有门和锁挡视线，桌椅不挡 */
  refreshDoors: function () {
    this.dynVersion = (this.dynVersion || 0) + 1;
    for (var y = 0; y < CFG.MAP_H; y++) { this.dyn[y].fill(0); this.dynOp[y].fill(0); }
    this.props.forEach(function (p) {
      if (p.dynamic && p.state === "closed") {
        // 锁只挡视线，不挡路：下楼永远自由，上楼由 Game.useStairs 判定
        if (p.t !== "lock") this.fillSolid(p, 1, this.dyn);
        this.fillSolid(p, 1, this.dynOp);
      }
      if (p.t === "barricade" && p.state === "blocking") {
        var b = p.block || { x: p.x, y: 16, w: 1, h: 5 };
        for (var by = b.y; by < b.y + b.h; by++)
          for (var bx = b.x; bx < b.x + b.w; bx++)
            if (this.inBounds(bx, by)) this.dyn[by][bx] = 1;
      }
    }, this);
  },

  doorProp: function (type, id) {
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      if (p.t === type && (type === "firedoor" ? p.doorId === id : p.lock === id)) return p;
    }
    return null;
  },

  inBounds: function (x, y) {
    return x >= 0 && y >= 0 && x < CFG.MAP_W && y < CFG.MAP_H;
  },

  blocked: function (tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    return this.grid[ty][tx] === 0 || this.solid[ty][tx] === 1 || this.dyn[ty][tx] === 1;
  },

  /* 挡视线：墙、高柜、隔间、关着的门。低矮家具（桌椅纸箱）不挡 */
  opaque: function (tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    var ig = this.ignoreRect;
    if (ig && tx >= ig.x0 && tx < ig.x1 && ty >= ig.y0 && ty < ig.y1) return false;
    return this.grid[ty][tx] === 0 || this.tall[ty][tx] === 1 || this.dynOp[ty][tx] === 1;
  },

  /* 卡进实体里时，找最近的可站立点 */
  nearestFree: function (x, y, r) {
    if (!this.circleHits(x, y, r)) return { x: x, y: y };
    var T = this.T;
    for (var rad = 1; rad <= 4; rad++) {
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          var nx = x + dx * T, ny = y + dy * T;
          if (!this.circleHits(nx, ny, r)) return { x: nx, y: ny };
        }
      }
    }
    return { x: x, y: y };
  },

  circleHits: function (x, y, r) {
    var T = this.T;
    var x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T);
    var y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (!this.blocked(tx, ty)) continue;
        var rx = tx * T, ry = ty * T;
        var cx = Math.max(rx, Math.min(x, rx + T));
        var cy = Math.max(ry, Math.min(y, ry + T));
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  },

  moveCircle: function (x, y, r, dx, dy) {
    var nx = x + dx;
    if (!this.circleHits(nx, y, r)) x = nx;
    var ny = y + dy;
    if (!this.circleHits(x, ny, r)) y = ny;
    return { x: x, y: y };
  },

  roomAt: function (px, py) {
    var tx = px / this.T, ty = py / this.T;
    for (var i = 0; i < this.rooms.length; i++) {
      var r = this.rooms[i];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  },

  los: function (x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return true;
    var steps = Math.ceil(dist / 10);
    var T = this.T;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var tx = Math.floor((x1 + dx * t) / T);
      var ty = Math.floor((y1 + dy * t) / T);
      if (this.opaque(tx, ty)) return false;
    }
    return true;
  },

  /* 沿射线精确走到第一个遮挡物（DDA，逐格求交）：返回精确距离 */
  rayDist: function (x1, y1, ang, maxDist) {
    var T = this.T;
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var tx = Math.floor(x1 / T), ty = Math.floor(y1 / T);
    if (this.opaque(tx, ty)) return 0;

    var adx = Math.abs(dx), ady = Math.abs(dy);
    var stepX = dx >= 0 ? 1 : -1;
    var stepY = dy >= 0 ? 1 : -1;
    var tMaxX = adx < 1e-9 ? Infinity : ((dx > 0 ? (tx + 1) * T - x1 : x1 - tx * T) / adx);
    var tMaxY = ady < 1e-9 ? Infinity : ((dy > 0 ? (ty + 1) * T - y1 : y1 - ty * T) / ady);
    var tDeltaX = adx < 1e-9 ? Infinity : T / adx;
    var tDeltaY = ady < 1e-9 ? Infinity : T / ady;

    var d = 0, guard = 0;
    while (d < maxDist && guard++ < 512) {
      if (tMaxX < tMaxY) { d = tMaxX; tMaxX += tDeltaX; tx += stepX; }
      else { d = tMaxY; tMaxY += tDeltaY; ty += stepY; }
      if (this.opaque(tx, ty)) return Math.min(d, maxDist);
    }
    return maxDist;
  },

  findPath: function (sx, sy, gx, gy) {
    var T = this.T;
    var stx = Math.floor(sx / T), sty = Math.floor(sy / T);
    var gtx = Math.floor(gx / T), gty = Math.floor(gy / T);
    if (!this.inBounds(gtx, gty) || this.blocked(gtx, gty)) {
      var found = null;
      for (var rr = 1; rr <= 2 && !found; rr++) {
        for (var dy = -rr; dy <= rr && !found; dy++) {
          for (var dx = -rr; dx <= rr && !found; dx++) {
            if (this.inBounds(gtx + dx, gty + dy) && !this.blocked(gtx + dx, gty + dy)) {
              found = { x: gtx + dx, y: gty + dy };
            }
          }
        }
      }
      if (!found) return [];
      gtx = found.x; gty = found.y;
    }
    if (this.blocked(stx, sty)) return [];

    var W = CFG.MAP_W, H = CFG.MAP_H;
    var prev = new Int32Array(W * H).fill(-1);
    var seen = new Uint8Array(W * H);
    var q = new Int32Array(W * H);
    var head = 0, tail = 0;
    var s = sty * W + stx, g = gty * W + gtx;
    q[tail++] = s; seen[s] = 1;

    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var hit = false;
    while (head < tail) {
      var cur = q[head++];
      if (cur === g) { hit = true; break; }
      var cx = cur % W, cy = (cur - cx) / W;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (!this.inBounds(nx, ny) || this.blocked(nx, ny)) continue;
        var ni = ny * W + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        q[tail++] = ni;
      }
    }
    if (!hit) return [];

    var path = [];
    var node = g;
    var guard = 0;
    while (node !== s && node !== -1 && guard++ < W * H) {
      var nx2 = node % W, ny2 = (node - nx2) / W;
      path.push({ x: nx2 * T + T / 2, y: ny2 * T + T / 2 });
      node = prev[node];
    }
    path.reverse();
    return path;
  },

  /* 玩家与鬼之间被关着的门（用于破门） */
  blockerBetween: function (ax, ay, bx, by) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      var isDoor = p.t === "firedoor" && p.state === "closed";
      var isBar = p.t === "barricade" && p.state === "blocking";
      if (!isDoor && !isBar) continue;
      var r = p.block || { x: p.x, y: p.y, w: p.w, h: p.h };
      var cx = (r.x + r.w / 2) * this.T;
      var y0 = r.y * this.T, y1 = (r.y + r.h) * this.T;
      // 目标分别在门的两侧
      if ((ax - cx) * (bx - cx) >= 0) continue;
      // 线段与门的高度范围有交叠
      var lo = Math.min(ay, by) - 40, hi = Math.max(ay, by) + 40;
      if (hi < y0 || lo > y1) continue;
      var d = Math.abs(ax - cx);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  },

  nearestProp: function (px, py, range) {
    var best = null, bestD = range * range;
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      if (p.t === "hooded" && !p.active) continue;
      var inter = p.hide || p.clue || p.decor || p.t === "stairs" ||
        p.t === "hooded" ||
        (p.t === "firedoor" && p.state !== "broken") ||
        (p.t === "lock" && p.state !== "open") ||
        (p.t === "barricade" && (p.state === "ready" || p.state === "blocking")) ||
        (p.key && p.revealed);
      if (!inter) continue;
      if (p.key && !p.revealed) continue;
      var rx = p.x * this.T, ry = p.y * this.T;
      var rw = p.w * this.T, rh = p.h * this.T;
      var cx = Math.max(rx, Math.min(px, rx + rw));
      var cy = Math.max(ry, Math.min(py, ry + rh));
      var dx = px - cx, dy = py - cy;
      var d = dx * dx + dy * dy;
      // 线索与钥匙优先：避免被旁边的桌子柜子抢走交互提示
      if (p.clue || p.key) d *= 0.55;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
};
