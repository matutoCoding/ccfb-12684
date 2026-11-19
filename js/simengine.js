/* simengine.js — 确定性仿真引擎。
   核心承诺：仿真结果 = f(铺层参数, 模具, 材料)，同一输入永远得到同一输出。
   所有"随机"成分（实测炉温噪声、空隙率涨落）都由参数哈希做种子，可复现。 */
window.SIM = (function () {
  const cache = {}; // 指纹 -> 结果

  /* 固化炉标准曲线（程序生成）：室温→2℃/min升温→180℃保温120min→3℃/min降温 */
  function ovenProfile() {
    const pts = [];
    const T0 = 25, Tc = 180, ramp = 2, hold = 120, cool = 3;
    const tRamp = (Tc - T0) / ramp, tHoldEnd = tRamp + hold, tEnd = tHoldEnd + (Tc - 60) / cool + 20;
    for (let t = 0; t <= tEnd; t += 2) {
      let T;
      if (t <= tRamp) T = T0 + ramp * t;
      else if (t <= tHoldEnd) T = Tc;
      else T = Math.max(60, Tc - cool * (t - tHoldEnd));
      pts.push([Math.round(t), Math.round(T * 10) / 10]);
    }
    return pts;
  }

  /* 车间实测炉温曲线：由工程编号做种子确定性生成（可重复"导入"同一曲线） */
  function measuredCurve(projectCode) {
    const rng = U.rngFrom({ measured: projectCode });
    const phase = rng() * 6.28, phase2 = rng() * 6.28, bias = (rng() - 0.5) * 4;
    return ovenProfile().map(([t, T]) => {
      const n = 2.2 * Math.sin(t / 31 + phase) + 1.1 * Math.sin(t / 7.3 + phase2) + bias + (rng() - 0.5) * 1.2;
      return [t, Math.round((T + n) * 10) / 10];
    });
  }

  /* 仿真输入指纹：只与影响结果的参数有关 */
  function keyOf(project, layup, mold, mats) {
    return U.fingerprint({
      plies: layup.plies.map(p => ({ a: p.angle, m: p.matId, c: p.cov })),
      surf: mold.surfaceKey, bd: mold.boundary, comp: mold.manualComp || {},
      darts: layup.darts, tcs: layup.thermocouples, rp: layup.rollerPressure,
      mats: layup.plies.map(p => { const m = matOf(p.matId, mats); return [m.E1, m.E2, m.nu12, m.G12, m.alpha1, m.alpha2, m.t, m.areal]; })
    });
  }
  function matOf(id, mats) { return mats.find(m => m.id === id) || mats[0]; }

  /* 主入口：取当前工程完整仿真结果（带缓存） */
  function run(project, layup, mold, mats, thresholds) {
    const key = keyOf(project, layup, mold, mats);
    if (cache[key]) return cache[key];

    const S = GEO.surf(mold.surfaceKey);
    const Lx = S.Lx, Ly = S.Ly;
    const dT = 25 - (mold.cureT || 180); // 固化温差

    /* --- 1) CLT 固化变形与残余应力 --- */
    const plies = layup.plies.map(p => ({
      angle: p.angle, mat: matOf(p.matId, mats), cov: 1
    }));
    const clt = CLT.analyze(plies, dT);
    const warp = CLT.warpage(clt.kappa, Lx, Ly);
    // 云图采样网格
    const NW = 30, field = [];
    for (let j = 0; j <= NW; j++) {
      const row = [];
      for (let i = 0; i <= NW; i++) {
        const x = (i / NW - 0.5) * Lx, y = (j / NW - 0.5) * Ly;
        row.push(warp.w(x, y));
      }
      field.push(row);
    }

    /* --- 2) 重量 --- */
    const areaM2 = (Lx / 1000) * (Ly / 1000);
    let weight = 0;
    layup.plies.forEach(p => {
      const m = matOf(p.matId, mats);
      const frac = Math.max(0, (p.cov.u1 - p.cov.u0)) * Math.max(0, (p.cov.v1 - p.cov.v0));
      weight += m.areal * areaM2 * frac; // g
    });

    /* --- 3) 剪切角场（铺覆预警） --- */
    const shear = GEO.shearField(mold);
    let maxShear = 0, maxShearAt = null;
    shear.forEach((row, j) => row.forEach((s, i) => {
      if (s > maxShear) { maxShear = s; maxShearAt = { u: i / GEO.NU, v: j / GEO.NV }; }
    }));

    /* --- 4) 压实辊 → 逐层空隙率（确定性涨落） --- */
    const rngV = U.rngFrom({ voids: key });
    const P = layup.rollerPressure || 300;
    const n = Math.max(1, layup.plies.length);
    const voids = layup.plies.map((p, i) => {
      const edge = Math.abs(i - (n - 1) / 2) / n;
      const v = 2.4 - 0.004 * P + 1.1 * edge + rngV() * 0.35;
      return Math.max(0.1, Math.round(v * 100) / 100);
    });

    /* --- 5) 热电偶温度曲线（一阶热惯性模型，确定性） --- */
    const oven = ovenProfile();
    const tcs = (layup.thermocouples || []).map((tc, k) => {
      const thk = GEO.thicknessAt(layup, id => matOf(id, mats), tc.u, tc.v);
      const edgeDist = Math.min(tc.u, 1 - tc.u, tc.v, 1 - tc.v); // 越靠边响应越快
      const tau = 4 + thk * 6 + edgeDist * 14 + k * 0.7;
      const gain = 1 + (0.5 - edgeDist) * 0.012;
      const curve = [];
      let T = 25;
      for (let i = 0; i < oven.length; i++) {
        const To = oven[i][1] * gain;
        T += (To - T) * Math.min(1, 2 / tau);
        curve.push([oven[i][0], Math.round(T * 10) / 10]);
      }
      return { id: tc.id, name: tc.name, u: tc.u, v: tc.v, curve };
    });
    // 最高/最低点及到达时刻
    let hot = null, cold = null;
    tcs.forEach(tc => tc.curve.forEach(([t, T]) => {
      if (!hot || T > hot.T) hot = { tc: tc.name, t, T };
      if (!cold || T < cold.T) cold = { tc: tc.name, t, T };
    }));
    // 温差超限时段
    const tol = (thresholds && thresholds.ovenTol) || 5;
    const exceed = [];
    let seg = null;
    for (let i = 0; i < oven.length; i++) {
      let mx = -1e9, mn = 1e9;
      tcs.forEach(tc => { const T = tc.curve[i][1]; if (T > mx) mx = T; if (T < mn) mn = T; });
      const spread = mx - mn;
      if (spread > tol) {
        if (!seg) seg = { t0: oven[i][0], max: spread };
        seg.t1 = oven[i][0];
        if (spread > seg.max) seg.max = spread;
      } else if (seg) { exceed.push(seg); seg = null; }
    }
    if (seg) exceed.push(seg);

    const res = {
      key, Lx, Ly, dT, clt, warp, field, NW,
      maxDefl: warp.max, weight,
      shear, maxShear, maxShearAt,
      voids, tcs, hot, cold, exceed, oven,
      maxVM: clt.maxVM, maxVMLayer: clt.maxLayer
    };
    cache[key] = res;
    return res;
  }

  function clearCache() { for (const k in cache) delete cache[k]; }

  return { run, keyOf, ovenProfile, measuredCurve, clearCache, matOf };
})();
