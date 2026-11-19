/* clt.js — 经典层合板理论（CLT）：纯函数、确定性。
   输入铺层序列+材料参数+固化温差，输出刚度矩阵、固化曲率、翘曲场、逐层残余应力。 */
window.CLT = (function () {

  /* 偏轴刚度矩阵 Qbar（MPa），角度为度 */
  function qbar(mat, deg) {
    const t = deg * Math.PI / 180, m = Math.cos(t), n = Math.sin(t);
    const nu21 = mat.nu12 * mat.E2 / mat.E1;
    const den = 1 - mat.nu12 * nu21;
    const Q11 = mat.E1 / den, Q12 = mat.nu12 * mat.E2 / den, Q22 = mat.E2 / den, Q66 = mat.G12;
    const m2 = m * m, n2 = n * n, m4 = m2 * m2, n4 = n2 * n2, mn2 = m2 * n2;
    return {
      Q11: Q11 * m4 + 2 * (Q12 + 2 * Q66) * mn2 + Q22 * n4,
      Q12: (Q11 + Q22 - 4 * Q66) * mn2 + Q12 * (m4 + n4),
      Q22: Q11 * n4 + 2 * (Q12 + 2 * Q66) * mn2 + Q22 * m4,
      Q16: (Q11 - Q12 - 2 * Q66) * m2 * m * n - (Q12 - Q22 + 2 * Q66) * m * n2 * n,
      Q26: (Q11 - Q12 - 2 * Q66) * m * n2 * n - (Q12 - Q22 + 2 * Q66) * m2 * m * n,
      Q66: (Q11 + Q22 - 2 * Q12 - 2 * Q66) * mn2 + Q66 * (m4 + n4)
    };
  }

  /* 偏轴热膨胀系数（1/℃） */
  function alphaXY(mat, deg) {
    const t = deg * Math.PI / 180, m = Math.cos(t), n = Math.sin(t);
    return {
      ax: mat.alpha1 * m * m + mat.alpha2 * n * n,
      ay: mat.alpha1 * n * n + mat.alpha2 * m * m,
      axy: 2 * (mat.alpha1 - mat.alpha2) * m * n
    };
  }

  /* 6x6 高斯消元 */
  function solve6(A, b) {
    const n = 6, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / M[i][i]);
  }

  /**
   * 层合板固化分析
   * plies: [{angle(deg), mat(材料对象), cov(覆盖率0..1)}]  自下而上
   * dT: 固化温差（室温-固化温度，负值）
   * 返回 {A,B,D, eps0, kappa, plies:[应力], maxVM, totalThk(mm), weight(g/m2 满覆)}
   */
  function analyze(plies, dT) {
    const A = [[0,0,0],[0,0,0],[0,0,0]], B = [[0,0,0],[0,0,0],[0,0,0]], D = [[0,0,0],[0,0,0],[0,0,0]];
    const NT = [0, 0, 0], MT = [0, 0, 0];
    let totalThk = 0, weight = 0;
    plies.forEach(p => { totalThk += p.mat.t; weight += p.mat.areal * (p.cov === undefined ? 1 : p.cov); });
    let z = -totalThk / 2;
    const layers = [];
    plies.forEach(p => {
      const t = p.mat.t, z0 = z, z1 = z + t, zb = (z0 + z1) / 2;
      const Q = qbar(p.mat, p.angle), al = alphaXY(p.mat, p.angle);
      const Qm = [[Q.Q11, Q.Q12, Q.Q16], [Q.Q12, Q.Q22, Q.Q26], [Q.Q16, Q.Q26, Q.Q66]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        A[i][j] += Qm[i][j] * t;
        B[i][j] += Qm[i][j] * t * zb;
        D[i][j] += Qm[i][j] * (t * zb * zb + t * t * t / 12);
      }
      const av = [al.ax, al.ay, al.axy];
      for (let i = 0; i < 3; i++) {
        let s = 0;
        for (let j = 0; j < 3; j++) s += Qm[i][j] * av[j];
        NT[i] += s * dT * t;
        MT[i] += s * dT * t * zb;
      }
      layers.push({ Q: Qm, al: av, zb, angle: p.angle, mat: p.mat });
      z = z1;
    });

    const M6 = [];
    for (let i = 0; i < 3; i++) M6.push(A[i].concat(B[i]));
    for (let i = 0; i < 3; i++) M6.push(B[i].concat(D[i]));
    const sol = solve6(M6, NT.concat(MT));
    const eps0 = sol.slice(0, 3), kappa = sol.slice(3, 6); // κ 单位 1/mm

    /* 逐层残余应力（材料主方向） */
    let maxVM = 0, maxLayer = -1;
    const plyStress = layers.map((L, k) => {
      const eps = [0, 1, 2].map(i => eps0[i] + L.zb * kappa[i] - L.al[i] * dT);
      const s = [0, 1, 2].map(i => L.Q[i][0] * eps[0] + L.Q[i][1] * eps[1] + L.Q[i][2] * eps[2]);
      const t = L.angle * Math.PI / 180, m = Math.cos(t), n = Math.sin(t);
      const s1 = m * m * s[0] + n * n * s[1] + 2 * m * n * s[2];
      const s2 = n * n * s[0] + m * m * s[1] - 2 * m * n * s[2];
      const t12 = -m * n * s[0] + m * n * s[1] + (m * m - n * n) * s[2];
      const vm = Math.sqrt(Math.max(0, s1 * s1 - s1 * s2 + s2 * s2 + 3 * t12 * t12));
      if (vm > maxVM) { maxVM = vm; maxLayer = k; }
      return { s1, s2, t12, vm };
    });

    return { A, B, D, eps0, kappa, plies: plyStress, maxVM, maxLayer, totalThk, weight };
  }

  /**
   * 翘曲位移场：w(x,y) = ½κx·x² + ½κy·y² + κxy·x·y  （x,y 为板面内居中坐标 mm）
   * 返回 {w(x,y), max:{x,y,w}} 在 Lx×Ly 网格上扫描最大值
   */
  function warpage(kappa, Lx, Ly) {
    const w = (x, y) => 0.5 * kappa[0] * x * x + 0.5 * kappa[1] * y * y + kappa[2] * x * y;
    let max = { x: 0, y: 0, w: 0 };
    const N = 40;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = (i / N - 0.5) * Lx, y = (j / N - 0.5) * Ly;
      const v = w(x, y);
      if (Math.abs(v) > Math.abs(max.w)) max = { x, y, w: v };
    }
    return { w, max };
  }

  return { qbar, alphaXY, analyze, warpage };
})();
