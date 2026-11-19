/* viewer3d.js — 零依赖 Canvas 三维渲染器：轨道旋转/缩放、画家算法、云图着色 */
window.V3 = (function () {

  function Viewer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw = 0.65; this.pitch = 0.55; this.dist = 900;
    this.cx = 0; this.cy = 0; this.cz = 0;
    this.items = [];
    this._bind();
  }

  Viewer.prototype._bind = function () {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; c.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      this.yaw += (e.clientX - drag.x) * 0.008;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
      this.render();
    });
    window.addEventListener('mouseup', () => { drag = null; c.style.cursor = 'grab'; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist *= e.deltaY > 0 ? 1.1 : 0.9;
      this.dist = Math.max(80, Math.min(8000, this.dist));
      this.render();
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.yaw = 0.65; this.pitch = 0.55; this.render(); });
  };

  Viewer.prototype.fit = function (pts) {
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    pts.forEach(p => {
      mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]);
      mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]);
      mnz = Math.min(mnz, p[2]); mxz = Math.max(mxz, p[2]);
    });
    this.cx = (mnx + mxx) / 2; this.cy = (mny + mxy) / 2; this.cz = (mnz + mxz) / 2;
    const span = Math.max(mxx - mnx, mxy - mny, mxz - mnz, 50);
    this.dist = span * 1.7;
  };

  Viewer.prototype._proj = function (p, W, H) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let x = p[0] - this.cx, y = p[1] - this.cy, z = p[2] - this.cz;
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const d = this.dist, f = Math.min(W, H) * 1.1;
    const s = f / (d + z2 + 1e-6);
    return [W / 2 + x1 * s, H / 2 - y2 * s, z2, s];
  };

  Viewer.prototype.setItems = function (items) { this.items = items; this.render(); };

  Viewer.prototype.render = function () {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (c.width !== W) { c.width = W; c.height = H; }
    ctx.clearRect(0, 0, W, H);
    const quads = [];
    const P = p => this._proj(p, W, H);

    this.items.forEach(it => {
      if (it.kind === 'mesh') {
        const pp = it.pts.map(P);
        it.quads.forEach((q, qi) => {
          const z = (pp[q[0]][2] + pp[q[1]][2] + pp[q[2]][2] + pp[q[3]][2]) / 4;
          quads.push({ pp, q, z, val: it.values ? it.values[qi] : null, vmin: it.vmin, vmax: it.vmax, base: it.color, wire: it.wire });
        });
      }
    });
    quads.sort((a, b) => b.z - a.z);
    quads.forEach(Q => {
      const [a, b, c2, d] = Q.q.map(i => Q.pp[i]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]);
      ctx.closePath();
      let col;
      if (Q.val !== null && Q.val !== undefined) {
        const t = (Q.val - Q.vmin) / ((Q.vmax - Q.vmin) || 1);
        col = U.css(U.jet(t));
      } else {
        // 简单朗伯着色
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = d[0] - a[0], vy = d[1] - a[1];
        let nz = ux * vy - uy * vx;
        const shade = 0.55 + 0.35 * Math.min(1, Math.abs(nz) / 4000);
        const base = Q.base || [90, 110, 135];
        col = `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`;
      }
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = Q.wire ? 'rgba(10,14,20,.5)' : 'rgba(10,14,20,.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    this.items.forEach(it => {
      if (it.kind === 'lines') {
        ctx.strokeStyle = it.color || '#3fa7ff';
        ctx.lineWidth = (it.width || 1.2) * dpr;
        if (it.dash) ctx.setLineDash([6 * dpr, 4 * dpr]); else ctx.setLineDash([]);
        it.segs.forEach(seg => {
          ctx.beginPath();
          seg.forEach((p, i) => {
            const q = P(p);
            if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
          });
          ctx.stroke();
        });
        ctx.setLineDash([]);
      } else if (it.kind === 'points') {
        it.pts.forEach((p, i) => {
          const q = P(p);
          ctx.fillStyle = it.color || '#f0a63c';
          ctx.beginPath();
          ctx.arc(q[0], q[1], (it.size || 4) * dpr, 0, 6.3);
          ctx.fill();
          if (it.labels) {
            ctx.fillStyle = '#dbe4ef';
            ctx.font = `${11 * dpr}px sans-serif`;
            ctx.fillText(it.labels[i], q[0] + 7 * dpr, q[1] - 5 * dpr);
          }
        });
      } else if (it.kind === 'arrows') {
        ctx.strokeStyle = it.color || '#27c2a5';
        ctx.fillStyle = it.color || '#27c2a5';
        ctx.lineWidth = (it.width || 1.4) * dpr;
        it.segs.forEach(seg => {
          ctx.beginPath();
          seg.forEach((p, i) => {
            const q = P(p);
            if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
          });
          ctx.stroke();
          // 箭头
          const n = seg.length;
          if (n > 3) {
            [Math.floor(n / 2), n - 1].forEach(k => {
              const a = P(seg[Math.max(0, k - 1)]), b = P(seg[k]);
              const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
              const L = 7 * dpr;
              ctx.beginPath();
              ctx.moveTo(b[0], b[1]);
              ctx.lineTo(b[0] - L * Math.cos(ang - 0.4), b[1] - L * Math.sin(ang - 0.4));
              ctx.lineTo(b[0] - L * Math.cos(ang + 0.4), b[1] - L * Math.sin(ang + 0.4));
              ctx.closePath(); ctx.fill();
            });
          }
        });
      }
    });
  };

  /* 由网格点数组构造 mesh item */
  function meshItem(pts, nu, nv, opts) {
    opts = opts || {};
    const quads = [], values = opts.values ? [] : null;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = j * (nu + 1) + i;
      quads.push([k, k + 1, k + nu + 2, k + nu + 1]);
      if (values) values.push(opts.values[j] ? opts.values[j][i] : 0);
    }
    const it = { kind: 'mesh', pts, quads, color: opts.color, wire: opts.wire !== false };
    if (values) { it.values = values; it.vmin = opts.vmin; it.vmax = opts.vmax; }
    return it;
  }

  return { Viewer, meshItem };
})();
