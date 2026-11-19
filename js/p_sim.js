/* p_sim.js — 仿真结果：翘曲云图(可放大)/残余应力/热电偶曲线/实测叠图/温差超限 */
window.Pages = window.Pages || {};
Pages.sim = function (main) {
  const st = Store.get();
  const el = U.el;
  const proj = Store.curProject();
  if (!proj) { main.appendChild(el('p', {}, ['请先选择工程。'])); return; }
  const mold = Store.mold(proj.moldId);
  const lp = Store.layupOf(proj.id);
  const th = st.thresholds;

  if (!lp.plies.length) { main.appendChild(el('p', {}, ['当前工程还没有铺层，请先到"铺层编辑"添加。'])); return; }

  const sim = SIM.run(proj, lp, mold, st.mats, th);
  let magnify = st.ui.magnify || 50;
  let tab = st.ui.simTab || 'warp';

  main.appendChild(el('h2', {}, ['仿真结果 — ' + proj.code]));

  // 确定性说明条
  main.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'inline' }, [
      el('span', {}, ['仿真指纹：', el('span', { class: 'mono' }, ['#' + sim.key])]),
      el('span', { class: 'muted small' }, ['同一套铺层参数重复计算指纹与结果完全一致；修改任一铺层参数指纹即变，结果自动重算。']),
      el('button', {
        class: 'btn sm', onclick: () => {
          const again = SIM.run(proj, lp, mold, st.mats, th);
          U.toast(again.key === sim.key && again.maxDefl.w === sim.maxDefl.w ? '复算一致 ✓ 指纹 #' + again.key : '结果不一致！', again.key !== sim.key);
        }
      }, ['重复计算验证'])
    ])
  ]));

  const tabs = el('div', { class: 'tabs' }, [
    ['warp', '固化翘曲'], ['stress', '残余应力'], ['thermal', '固化温度场']
  ].map(([k, lb]) => el('button', {
    class: tab === k ? 'active' : '',
    onclick: () => { tab = k; st.ui.simTab = k; Store.save(); render(); }
  }, [lb])));
  main.appendChild(tabs);
  const holder = el('div');
  main.appendChild(holder);

  /* ============ 翘曲 ============ */
  function renderWarp() {
    U.clear(holder);
    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.5' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const canvas = el('canvas', { class: 'view3d' });
    const slider = el('input', { type: 'range', min: 1, max: 500, value: magnify, style: 'width:220px' });
    const magLabel = el('span', { class: 'mono' }, ['×' + magnify]);
    slider.addEventListener('input', () => { magnify = +slider.value; st.ui.magnify = magnify; Store.save(); magLabel.textContent = '×' + magnify; draw(); });
    left.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'inline', style: 'margin-bottom:8px' }, [
        el('span', { class: 'muted small' }, ['变形放大倍数：']), slider, magLabel
      ]),
      canvas
    ]));

    function draw() {
      // 变形网格：型面 + 翘曲位移×放大倍数（映射到型面UV对应的平面坐标）
      const N = sim.NW, pts = [], vals = [];
      const fn = GEO.surf(mold.surfaceKey).fn;
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const u = i / N, v = j / N;
          const p = fn(u, v);
          const x = (u - 0.5) * sim.Lx, y = (v - 0.5) * sim.Ly;
          const w = sim.warp.w(x, y);
          pts.push([p[0], p[1], p[2] + w * magnify]);
          if (i < N && j < N) vals.push(sim.field[j][i]);
        }
      }
      // values 需要按 quad 排列
      const qvals = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) qvals.push(sim.field[j][i]);
      let vmin = 1e9, vmax = -1e9;
      sim.field.forEach(r => r.forEach(x => { vmin = Math.min(vmin, x); vmax = Math.max(vmax, x); }));
      const items = [V3.meshItem(pts, N, N, { values: sim.field, vmin, vmax })];
      // 原始型面线框对照
      const base = GEO.mesh(mold, 12, 12);
      items.push({ kind: 'lines', segs: wireframe(base.pts, 12, 12), color: 'rgba(140,160,185,.35)', width: 0.7, dash: true });
      const viewer = new V3.Viewer(canvas);
      viewer.fit(pts);
      viewer.setItems(items);
    }
    function wireframe(pts, nu, nv) {
      const segs = [];
      for (let j = 0; j <= nv; j++) { const l = []; for (let i = 0; i <= nu; i++) l.push(pts[j * (nu + 1) + i]); segs.push(l); }
      for (let i = 0; i <= nu; i++) { const l = []; for (let j = 0; j <= nv; j++) l.push(pts[j * (nu + 1) + i]); segs.push(l); }
      return segs;
    }
    draw();

    const md = sim.maxDefl;
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['翘曲变形结果']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['最大变形量']), el('span', { class: Math.abs(md.w) > th.warpageMax ? 'fail' : 'pass', style: 'font-size:18px;font-weight:700' },
          [U.fmt(md.w, 3) + ' mm']),
        el('b', {}, ['出现位置']), el('span', { class: 'mono' },
          ['x=' + U.fmt(md.x, 0) + ' mm, y=' + U.fmt(md.y, 0) + ' mm（板面居中坐标）']),
        el('b', {}, ['校验阈值']), el('span', {}, ['≤ ' + th.warpageMax + ' mm → ' + (Math.abs(md.w) <= th.warpageMax ? '合格' : '超差')]),
        el('b', {}, ['固化曲率 κx']), el('span', { class: 'mono' }, [sim.clt.kappa[0].toExponential(3) + ' 1/mm']),
        el('b', {}, ['固化曲率 κy']), el('span', { class: 'mono' }, [sim.clt.kappa[1].toExponential(3) + ' 1/mm']),
        el('b', {}, ['扭转曲率 κxy']), el('span', { class: 'mono' }, [sim.clt.kappa[2].toExponential(3) + ' 1/mm']),
        el('b', {}, ['估算净重']), el('span', {}, [U.fmt(sim.weight, 0) + ' g'])
      ])
    ]));
  }

  /* ============ 残余应力 ============ */
  function renderStress() {
    U.clear(holder);
    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const cv = el('canvas', { class: 'chart' });
    left.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['逐层残余应力（Von Mises，固化温差 ΔT=' + sim.dT + '℃）']),
      cv
    ]));
    Charts.hbars(cv,
      lp.plies.map((p, i) => '第' + (i + 1) + '层 ' + p.angle + '°'),
      sim.clt.plies.map(s => Math.round(s.vm * 10) / 10),
      { threshold: th.stressMax, unit: ' MPa', height: Math.max(200, lp.plies.length * 28 + 40) });

    const tbl = el('table', { class: 'grid' }, [
      el('tr', {}, ['层', '角度', 'σ1(MPa)', 'σ2(MPa)', 'τ12(MPa)', 'VM(MPa)'].map(h => el('th', {}, [h])))
    ]);
    sim.clt.plies.forEach((s, i) => tbl.appendChild(el('tr', { class: s.vm > th.stressMax ? 'row-bad' : '' }, [
      el('td', {}, ['第' + (i + 1) + '层']),
      el('td', { class: 'num' }, [lp.plies[i].angle + '°']),
      el('td', { class: 'num' }, [U.fmt(s.s1, 1)]),
      el('td', { class: 'num' }, [U.fmt(s.s2, 1)]),
      el('td', { class: 'num' }, [U.fmt(s.t12, 1)]),
      el('td', { class: 'num', style: s.vm > th.stressMax ? 'color:var(--bad);font-weight:700' : '' }, [U.fmt(s.vm, 1)])
    ])));
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['应力明细']),
      el('div', { class: 'pill-scroll' }, [tbl]),
      el('p', {}, ['最大残余应力：', el('b', { class: sim.maxVM > th.stressMax ? 'fail' : 'pass' },
        [U.fmt(sim.maxVM, 1) + ' MPa']), '（第 ' + (sim.maxVMLayer + 1) + ' 层，阈值 ' + th.stressMax + ' MPa）'])
    ]));
  }

  /* ============ 温度场 ============ */
  function renderThermal() {
    U.clear(holder);
    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.5' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const cv = el('canvas', { class: 'chart' });
    const btnRow = el('div', { class: 'inline', style: 'margin-bottom:8px' }, [
      el('button', {
        class: 'btn sm primary', onclick: () => {
          lp.importedMeasured = SIM.measuredCurve(proj.code);
          Store.emit();
          U.toast('已导入车间实测炉温曲线（与仿真同图叠加）');
        }
      }, ['导入实测炉温曲线']),
      lp.importedMeasured ? el('button', {
        class: 'btn sm danger', onclick: () => { lp.importedMeasured = null; Store.emit(); }
      }, ['移除实测曲线']) : null,
      el('span', { class: 'muted small' }, ['实测曲线由工程编号确定性生成，重复导入结果一致'])
    ]);
    left.appendChild(el('div', { class: 'card' }, [btnRow, cv]));

    const series = sim.tcs.map((tc, i) => ({ name: tc.name, pts: tc.curve, color: Charts.COLORS[i % Charts.COLORS.length] }));
    series.push({ name: '炉温设定', pts: sim.oven, color: '#8fa1b6', dash: true });
    if (lp.importedMeasured) series.push({ name: '车间实测', pts: lp.importedMeasured, color: '#ef5b6b' });
    Charts.line(cv, series, { xlabel: '时间 (min)', height: 380, hLine: undefined });

    // 最高/最低点
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['整模温度极值']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['最高温点']), el('span', { class: 'warnc' }, [sim.hot ? sim.hot.tc + '：' + U.fmt(sim.hot.T, 1) + '℃ @ ' + sim.hot.t + ' min' : '—']),
        el('b', {}, ['最低温点']), el('span', {}, [sim.cold ? sim.cold.tc + '：' + U.fmt(sim.cold.T, 1) + '℃ @ ' + sim.cold.t + ' min' : '—']),
        el('b', {}, ['均匀性公差']), el('span', {}, ['±' + th.ovenTol + ' ℃'])
      ])
    ]));

    // 实测偏差
    if (lp.importedMeasured) {
      let maxDev = 0, maxDevT = 0;
      lp.importedMeasured.forEach(([t, T], i) => {
        const d = Math.abs(T - sim.oven[i][1]);
        if (d > maxDev) { maxDev = d; maxDevT = t; }
      });
      right.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, ['实测 vs 设定偏差']),
        el('div', { class: 'kv' }, [
          el('b', {}, ['最大偏差']), el('span', { class: maxDev > th.ovenTol ? 'fail' : 'pass' }, [U.fmt(maxDev, 1) + ' ℃ @ ' + maxDevT + ' min'])
        ])
      ]));
    }

    // 温差超限时段
    const exCard = el('div', { class: 'card' }, [el('h3', {}, ['温差超出均匀性公差的时段'])]);
    if (!sim.exceed.length) exCard.appendChild(el('p', { class: 'pass' }, ['✓ 全程温差在公差带内']));
    else {
      const t = el('table', { class: 'grid' }, [el('tr', {}, ['时段', '最大温差(℃)'].map(h => el('th', {}, [h])))]);
      sim.exceed.forEach(e => t.appendChild(el('tr', { class: 'row-bad' }, [
        el('td', { class: 'mono' }, [e.t0 + ' ~ ' + e.t1 + ' min']),
        el('td', { class: 'num', style: 'color:var(--bad)' }, [U.fmt(e.max, 1)])
      ])));
      exCard.appendChild(t);
    }
    right.appendChild(exCard);

    // 热电偶布置
    const tcCard = el('div', { class: 'card' }, [el('h3', {}, ['虚拟热电偶测点（模具UV坐标）'])]);
    const tt = el('table', { class: 'grid' }, [el('tr', {}, ['测点', 'u', 'v', ''].map(h => el('th', {}, [h])))]);
    lp.thermocouples.forEach((tc, i) => {
      const ui = el('input', { type: 'number', step: '0.05', value: tc.u, style: 'width:70px' });
      const vi = el('input', { type: 'number', step: '0.05', value: tc.v, style: 'width:70px' });
      const editable = Store.layupEditable(proj);
      ui.disabled = vi.disabled = !editable;
      ui.addEventListener('change', () => { tc.u = Math.max(0, Math.min(1, +ui.value)); SIM.clearCache(); Store.emit(); });
      vi.addEventListener('change', () => { tc.v = Math.max(0, Math.min(1, +vi.value)); SIM.clearCache(); Store.emit(); });
      tt.appendChild(el('tr', {}, [
        el('td', {}, [tc.name]), el('td', {}, [ui]), el('td', {}, [vi]),
        el('td', {}, editable ? [el('button', {
          class: 'btn sm danger', onclick: () => { lp.thermocouples.splice(i, 1); SIM.clearCache(); Store.emit(); }
        }, ['删'])] : [])
      ]));
    });
    tcCard.appendChild(tt);
    if (Store.layupEditable(proj)) {
      tcCard.appendChild(el('button', {
        class: 'btn sm', onclick: () => {
          const n = lp.thermocouples.length + 1;
          lp.thermocouples.push({ id: 'TC' + n, name: 'TC' + n, u: 0.5, v: 0.5 });
          SIM.clearCache(); Store.emit();
        }
      }, ['＋ 加测点']));
    }
    right.appendChild(tcCard);
  }

  function render() { tab === 'warp' ? renderWarp() : tab === 'stress' ? renderStress() : renderThermal(); }
  render();
};
