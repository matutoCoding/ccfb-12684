/* geometry.js — 模具型面、网格、法向、偏置补偿面、边界圈定、剪切角场、纤维流线 */
window.GEO = (function () {

  /* ===== 参数化型面库（u,v ∈ [0,1]，输出 mm）===== */
  const SURFACES = {
    arm: { /* 无人机机臂：长条双曲率壳 */
      name: '无人机机臂型面', Lx: 620, Ly: 90,
      fn(u, v) {
        const x = (u - 0.5) * 620, y = (v - 0.5) * 90;
        const z = 34 * Math.sin(u * Math.PI) * Math.cos((v - 0.5) * Math.PI * 0.95)
          + 10 * Math.sin(u * 2 * Math.PI + 0.6) + 6 * (v - 0.5);
        return [x, y, z];
      }
    },
    wing: { /* 汽车尾翼：展向弯+弦向拱 */
      name: '汽车尾翼型面', Lx: 1180, Ly: 260,
      fn(u, v) {
        const x = (u - 0.5) * 1180, y = (v - 0.5) * 260;
        const z = 55 * Math.sin(u * Math.PI) * (0.6 + 0.4 * Math.cos((v - 0.5) * Math.PI))
          + 28 * Math.sin((v - 0.5) * Math.PI) - 18 * Math.cos(u * 2 * Math.PI);
        return [x, y, z];
      }
    },
    plate: { /* 校验平板：微曲率 */
      name: '校验平模板', Lx: 400, Ly: 300,
      fn(u, v) {
        const x = (u - 0.5) * 400, y = (v - 0.5) * 300;
        return [x, y, 4 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)];
      }
    },
    cowl: { /* 机头整流罩：强双曲率罩体 */
      name: '机头整流罩型面', Lx: 420, Ly: 320,
      fn(u, v) {
        const x = (u - 0.5) * 420, y = (v - 0.5) * 320;
        const z = 170 * Math.cos((u - 0.5) * Math.PI * 0.96) * Math.cos((v - 0.5) * Math.PI * 0.9)
          + 45 * Math.sin(u * 2 * Math.PI) * Math.sin(v * Math.PI);
        return [x, y, z];
      }
    }
  };

  const NU = 36, NV = 36;

  function surf(key) { return SURFACES[key] || SURFACES.plate; }

  /* 生成网格点与法向 */
  function mesh(mold, nu, nv) {
    nu = nu || NU; nv = nv || NV;
    const fn = surf(mold.surfaceKey).fn;
    const pts = [], nrm = [];
    const h = 1e-4;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const p = fn(u, v);
      pts.push(p);
      const pu1 = fn(Math.min(1, u + h), v), pu0 = fn(Math.max(0, u - h), v);
      const pv1 = fn(u, Math.min(1, v + h)), pv0 = fn(u, Math.max(0, v - h));
      const du = Math.min(1, u + h) - Math.max(0, u - h);
      const dv = Math.min(1, v + h) - Math.max(0, v - h);
      const tu = [(pu1[0] - pu0[0]) / du, (pu1[1] - pu0[1]) / du, (pu1[2] - pu0[2]) / du];
      const tv = [(pv1[0] - pv0[0]) / dv, (pv1[1] - pv0[1]) / dv, (pv1[2] - pv0[2]) / dv];
      let n = cross(tu, tv);
      const L = len(n) || 1;
      n = [n[0] / L, n[1] / L, n[2] / L];
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]]; // 统一朝上
      nrm.push(n);
    }
    return { pts, nrm, nu, nv, idx: (i, j) => j * (nu + 1) + i };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* 铺层在 (u,v) 处的累计厚度 mm */
  function thicknessAt(layup, matOf, u, v) {
    let t = 0;
    (layup.plies || []).forEach(p => {
      const c = p.cov;
      if (u >= c.u0 && u <= c.u1 && v >= c.v0 && v <= c.v1) t += matOf(p.matId).t;
    });
    return t;
  }

  /* 局部最小曲率半径（数值估计，mm）——偏置奇异判据 */
  function minRadius(mold, u, v) {
    const fn = surf(mold.surfaceKey).fn;
    const h = 0.02;
    function second(dir) {
      const d = dir === 'u' ? [h, 0] : [0, h];
      const p1 = fn(Math.min(1, u + d[0]), Math.min(1, v + d[1]));
      const p0 = fn(u, v);
      const p_1 = fn(Math.max(0, u - d[0]), Math.max(0, v - d[1]));
      const sec = [(p1[0] - 2 * p0[0] + p_1[0]) / (h * h), (p1[1] - 2 * p0[1] + p_1[1]) / (h * h), (p1[2] - 2 * p0[2] + p_1[2]) / (h * h)];
      const tan = sub(p1, p_1);
      const scale = 2 * h * (dir === 'u' ? surf(mold.surfaceKey).Lx : surf(mold.surfaceKey).Ly);
      // 法向曲率 ≈ |二阶导| / |一阶导|²
      const tl = len(tan) / (2 * h);
      return len(sec) / (tl * tl || 1);
    }
    const k = Math.max(second('u'), second('v'));
    return k < 1e-9 ? Infinity : 1 / k;
  }

  /**
   * 偏置补偿面：沿法向偏移 累计厚度×(1+手填补偿)
   * 失败判据：局部最小曲率半径 < 偏移量×1.15（偏移面自交）
   * 返回 {pts, failed:[{i,j,u,v,need}], }
   */
  function offsetMesh(mold, layup, matOf) {
    const base = mesh(mold);
    const pts = new Array(base.pts.length);
    const failed = [];
    for (let j = 0; j <= base.nv; j++) for (let i = 0; i <= base.nu; i++) {
      const k = base.idx(i, j), u = i / base.nu, v = j / base.nv;
      let t = thicknessAt(layup, matOf, u, v);
      const key = i + ',' + j;
      const manual = (mold.manualComp || {})[key];
      if (manual !== undefined) t = Math.max(0, t + manual);
      const r = minRadius(mold, u, v);
      if (t > 0 && r < t * 1.15 && manual === undefined) {
        failed.push({ i, j, u, v, need: U.fmt(t - r / 1.15, 2) });
      }
      const p = base.pts[k], n = base.nrm[k];
      pts[k] = [p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t];
    }
    return { pts, nrm: base.nrm, nu: base.nu, nv: base.nv, idx: base.idx, failed };
  }

  /* 模具热膨胀预缩放系数：把固化温度下的模具回算到室温尺寸 */
  function prescale(mold, partAlpha, cureT, roomT) {
    const dT = cureT - roomT;
    return (1 + partAlpha * dT) / (1 + mold.cte * dT);
  }

  /* 边界多边形（UV）包含测试 */
  function inBoundary(mold, u, v) {
    const poly = mold.boundary || [];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > v) !== (yj > v)) && (u < (xj - xi) * (v - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /* 覆盖矩形是否全在边界内 */
  function rectInBoundary(mold, c) {
    return inBoundary(mold, c.u0, c.v0) && inBoundary(mold, c.u1, c.v0)
      && inBoundary(mold, c.u0, c.v1) && inBoundary(mold, c.u1, c.v1)
      && inBoundary(mold, (c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2);
  }

  /* 剪切角场：织物铺覆时经纬纱夹角偏离 90° 的角度（度）。
     模型：高斯曲率沿铺贴路径累积（Gauss-Bonnet 角亏），
     从中部夹持点出发先沿 u 后沿 v 积分 |K·dA|，双曲率越大剪切越严重。 */
  function shearField(mold, nu, nv) {
    nu = nu || NU; nv = nv || NV;
    const fn = surf(mold.surfaceKey).fn, h = 1e-4;
    const K = [], dA = [];
    for (let j = 0; j <= nv; j++) {
      const Kr = [], Ar = [];
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const p = fn(u, v);
        const pu1 = fn(Math.min(1, u + h), v), pu0 = fn(Math.max(0, u - h), v);
        const pv1 = fn(u, Math.min(1, v + h)), pv0 = fn(u, Math.max(0, v - h));
        const puu = fn(Math.min(1, u + 2 * h), v), pvv = fn(u, Math.min(1, v + 2 * h));
        const puv = fn(Math.min(1, u + h), Math.min(1, v + h));
        const du = Math.min(1, u + h) - Math.max(0, u - h);
        const dv = Math.min(1, v + h) - Math.max(0, v - h);
        const Su = sub(pu1, pu0).map(x => x / du), Sv = sub(pv1, pv0).map(x => x / dv);
        let n = cross(Su, Sv); const nl = len(n) || 1; n = n.map(x => x / nl);
        const E = dot(Su, Su), F = dot(Su, Sv), G = dot(Sv, Sv);
        // 二阶导（中心差分近似）
        const Suu = [(puu[0] - 2 * pu1[0] + p[0]) / (h * h), (puu[1] - 2 * pu1[1] + p[1]) / (h * h), (puu[2] - 2 * pu1[2] + p[2]) / (h * h)];
        const Svv = [(pvv[0] - 2 * pv1[0] + p[0]) / (h * h), (pvv[1] - 2 * pv1[1] + p[1]) / (h * h), (pvv[2] - 2 * pv1[2] + p[2]) / (h * h)];
        const Suv = [(puv[0] - pu1[0] - pv1[0] + p[0]) / (h * h), (puv[1] - pu1[1] - pv1[1] + p[1]) / (h * h), (puv[2] - pu1[2] - pv1[2] + p[2]) / (h * h)];
        const L = dot(Suu, n), M = dot(Suv, n), N2 = dot(Svv, n);
        const det1 = E * G - F * F;
        const k = det1 > 1e-12 ? (L * N2 - M * M) / det1 : 0;
        Kr.push(k);
        Ar.push(Math.sqrt(Math.max(det1, 0)) / (nu * nv)); // 单元面积
      }
      K.push(Kr); dA.push(Ar);
    }
    // 从中部夹持点(0.5,0.5)到各点的矩形区域内累积总曲率（立体角）
    const out = [];
    const ci = Math.round(nu / 2), cj = Math.round(nv / 2);
    for (let j = 0; j <= nv; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) {
        let g = 0;
        for (let jj = Math.min(cj, j); jj < Math.max(cj, j); jj++)
          for (let ii = Math.min(ci, i); ii < Math.max(ci, i); ii++)
            g += K[jj][ii] * dA[jj][ii];
        row.push(Math.min(90, Math.abs(g) * 180 / Math.PI));
      }
      out.push(row);
    }
    return out;
  }

  /* 纤维流线：从种子点沿 (角度θ 的纤维方向) 在曲面上积分 */
  function streamlines(mold, angleDeg, seeds, steps) {
    const fn = surf(mold.surfaceKey).fn;
    const S = surf(mold.surfaceKey);
    const th = angleDeg * Math.PI / 180;
    const lines = [];
    (seeds || [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85], [0.25, 0.5], [0.75, 0.5]]).forEach(sd => {
      const pts = [];
      let u = sd[0], v = sd[1];
      const h = 1e-4, ds = 1 / (steps || 60);
      for (let s = 0; s < (steps || 60); s++) {
        if (u < 0 || u > 1 || v < 0 || v > 1) break;
        pts.push(fn(u, v));
        const pu1 = fn(Math.min(1, u + h), v), pu0 = fn(Math.max(0, u - h), v);
        const pv1 = fn(u, Math.min(1, v + h)), pv0 = fn(u, Math.max(0, v - h));
        const tu = sub(pu1, pu0), tv = sub(pv1, pv0);
        // 纤维方向 = cosθ·êu + sinθ·êv（曲面切平面内）
        const d = [Math.cos(th) * tu[0] / (len(tu) || 1) + Math.sin(th) * tv[0] / (len(tv) || 1),
                   Math.cos(th) * tu[1] / (len(tu) || 1) + Math.sin(th) * tv[1] / (len(tv) || 1),
                   Math.cos(th) * tu[2] / (len(tu) || 1) + Math.sin(th) * tv[2] / (len(tv) || 1)];
        // 反解到 UV 步长
        const du = (d[0] * tu[0] + d[1] * tu[1] + d[2] * tu[2]) / (dot(tu, tu) || 1);
        const dv = (d[0] * tv[0] + d[1] * tv[1] + d[2] * tv[2]) / (dot(tv, tv) || 1);
        u += du * ds; v += dv * ds;
      }
      if (pts.length > 1) lines.push(pts);
    });
    return lines;
  }

  /* UV 矩形轮廓 → 曲面上的三维折线 */
  function outline3D(mold, c, lift) {
    const fn = surf(mold.surfaceKey).fn;
    const m = mesh(mold, 8, 8); // 只为法向
    const pts = [];
    const per = [];
    const N = 24;
    for (let i = 0; i <= N; i++) per.push([c.u0 + (c.u1 - c.u0) * i / N, c.v0]);
    for (let i = 0; i <= N; i++) per.push([c.u1, c.v0 + (c.v1 - c.v0) * i / N]);
    for (let i = 0; i <= N; i++) per.push([c.u1 - (c.u1 - c.u0) * i / N, c.v1]);
    for (let i = 0; i <= N; i++) per.push([c.u0, c.v1 - (c.v1 - c.v0) * i / N]);
    per.forEach(([u, v]) => {
      const p = fn(u, v);
      if (lift) {
        const i2 = Math.round(u * 8), j2 = Math.round(v * 8);
        const n = m.nrm[j2 * 9 + i2];
        pts.push([p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift]);
      } else pts.push(p);
    });
    return pts;
  }

  /* 边界环 → 三维折线 */
  function boundary3D(mold, lift) {
    const fn = surf(mold.surfaceKey).fn;
    return (mold.boundary || []).map(([u, v]) => {
      const p = fn(u, v);
      return lift ? [p[0], p[1], p[2] + lift] : p;
    });
  }

  /* 纤维网格线（铺覆模拟）：在覆盖矩形内画经纬线，遇剪口断开 */
  function fiberGrid(mold, cov, darts, lift) {
    const fn = surf(mold.surfaceKey).fn;
    const lines = [];
    const nU = 14, nV = 10, SEG = 30;
    function cut(u, v) { // 是否落在某条剪口缝上
      return (darts || []).some(d => {
        const dx = u - d.u, dy = v - d.v;
        const a = d.angle * Math.PI / 180;
        const along = dx * Math.cos(a) + dy * Math.sin(a);
        const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
        return along > 0 && along < d.depth && perp < 0.006;
      });
    }
    function trace(fixed, isU) {
      const pts = [];
      let cur = [];
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const u = isU ? fixed : cov.u0 + (cov.u1 - cov.u0) * t;
        const v = isU ? cov.v0 + (cov.v1 - cov.v0) * t : fixed;
        if (cut(u, v)) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
        const p = fn(u, v);
        cur.push([p[0], p[1], p[2] + (lift || 0)]);
      }
      if (cur.length > 1) lines.push(cur);
    }
    for (let i = 0; i <= nU; i++) trace(cov.u0 + (cov.u1 - cov.u0) * i / nU, true);
    for (let j = 0; j <= nV; j++) trace(cov.v0 + (cov.v1 - cov.v0) * j / nV, false);
    return lines;
  }

  return { SURFACES, surf, mesh, offsetMesh, thicknessAt, minRadius, prescale,
    inBoundary, rectInBoundary, shearField, streamlines, outline3D, boundary3D, fiberGrid,
    cross, len, sub, dot, NU, NV };
})();
