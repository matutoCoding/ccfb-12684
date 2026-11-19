/* p_workshop.js — 车间作业：激光投影/真空袋辅材/保压检漏/铺贴工单 */
window.Pages = window.Pages || {};
Pages.workshop = function (main) {
  const st = Store.get();
  const el = U.el;
  const proj = Store.curProject();
  if (!proj) { main.appendChild(el('p', {}, ['请先选择工程。'])); return; }
  const mold = Store.mold(proj.moldId);
  const lp = Store.layupOf(proj.id);
  const th = st.thresholds;

  main.appendChild(el('h2', {}, ['车间作业 — ' + proj.code]));

  let tab = st.ui.wsTab || 'proj';
  const tabs = el('div', { class: 'tabs' }, [
    ['proj', '激光投影定位'], ['bag', '真空袋辅材'], ['vac', '抽真空保压检漏'], ['wo', '铺贴工单']
  ].map(([k, lb]) => el('button', {
    class: tab === k ? 'active' : '',
    onclick: () => { tab = k; st.ui.wsTab = k; Store.save(); render(); }
  }, [lb])));
  main.appendChild(tabs);
  const holder = el('div');
  main.appendChild(holder);

  const S = GEO.surf(mold.surfaceKey);

  /* ============ 激光投影 ============ */
  function renderProj() {
    U.clear(holder);
    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.4' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    // 投影坐标系 = 模具基准点：以边界环质心为原点
    const bd = mold.boundary;
    const cu = bd.reduce((s, p) => s + p[0], 0) / bd.length;
    const cvv = bd.reduce((s, p) => s + p[1], 0) / bd.length;

    function plyProjection(p, idx) {
      const fn = S.fn;
      const outline = GEO.outline3D(mold, p.cov, 0).map(q => {
        // 转到模具基准坐标（原点=边界质心对应型面点）
        const o = fn(cu, cvv);
        return [Math.round((q[0] - o[0]) * 100) / 100, Math.round((q[1] - o[1]) * 100) / 100, Math.round((q[2] - o[2]) * 100) / 100];
      });
      // 角度刻线：过轮廓中心的纤维方向线
      const uc = (p.cov.u0 + p.cov.u1) / 2, vc = (p.cov.v0 + p.cov.v1) / 2;
      const a = p.angle * Math.PI / 180;
      const o = fn(cu, cvv);
      const c0 = fn(uc, vc);
      const c1 = fn(uc + Math.cos(a) * 0.06, vc + Math.sin(a) * 0.06);
      const c2 = fn(uc - Math.cos(a) * 0.06, vc - Math.sin(a) * 0.06);
      const angleLine = [[c1[0] - o[0], c1[1] - o[1], c1[2] - o[2]], [c0[0] - o[0], c0[1] - o[1], c0[2] - o[2]], [c2[0] - o[0], c2[1] - o[1], c2[2] - o[2]]]
        .map(q => q.map(x => Math.round(x * 100) / 100));
      // 搭接边界：与相邻层的重叠边
      const overlaps = [];
      [idx - 1, idx + 1].forEach(j => {
        const q = lp.plies[j];
        if (!q) return;
        const ou = Math.max(0, Math.min(p.cov.u1, q.cov.u1) - Math.max(p.cov.u0, q.cov.u0));
        const ov = Math.max(0, Math.min(p.cov.v1, q.cov.v1) - Math.max(p.cov.v0, q.cov.v0));
        if (ou > 0 && ov > 0) overlaps.push({ withPly: j + 1, u: Math.max(p.cov.u0, q.cov.u0), v: Math.max(p.cov.v0, q.cov.v0), w: ou, h: ov });
      });
      return {
        file: proj.code + '_PLY' + String(idx + 1).padStart(2, '0') + '_projection.json',
        project: proj.code, ply: idx + 1, angle: p.angle,
        datum: { origin: '模具边界环质心', uv: [cu, cvv] },
        outline, angleLine, overlaps
      };
    }

    left.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['投影文件（按层导出，坐标系对齐模具基准点）']),
      el('p', { class: 'muted small' }, ['基准点：边界环质心 UV=(' + U.fmt(cu, 3) + ',' + U.fmt(cvv, 3) + ')；轮廓、角度刻线、搭接边界随层一并导出。'])
    ]));
    const t = el('table', { class: 'grid' }, [el('tr', {}, ['层', '角度', '投影文件', ''].map(h => el('th', {}, [h])))]);
    lp.plies.forEach((p, i) => {
      const pj = plyProjection(p, i);
      t.appendChild(el('tr', {}, [
        el('td', {}, ['第' + (i + 1) + '层']),
        el('td', { class: 'num' }, [p.angle + '°']),
        el('td', { class: 'mono small' }, [pj.file]),
        el('td', {}, [el('button', {
          class: 'btn sm', onclick: () => U.download(pj.file, JSON.stringify(pj, null, 2), 'application/json')
        }, ['导出'])])
      ]));
    });
    left.querySelector('.card').appendChild(t);

    // 校准
    if (!lp.projCalib) lp.projCalib = { deviation: 0.3, calibratedAt: U.nowStr() };
    const calCard = el('div', { class: 'card' }, [
      el('h3', {}, ['投影校准']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['当前轮廓偏差']), el('span', { class: lp.projCalib.deviation > th.projTol ? 'fail' : 'pass' },
          [U.fmt(lp.projCalib.deviation, 2) + ' mm（公差 ' + th.projTol + ' mm）']),
        el('b', {}, ['最近校准']), el('span', { class: 'mono small' }, [lp.projCalib.calibratedAt])
      ])
    ]);
    const devInp = el('input', { type: 'number', step: '0.1', value: lp.projCalib.deviation, style: 'width:90px' });
    calCard.appendChild(el('div', { class: 'inline', style: 'margin-top:8px' }, [
      el('span', { class: 'small' }, ['实测偏差(mm)：']), devInp,
      el('button', {
        class: 'btn sm', onclick: () => {
          lp.projCalib.deviation = +devInp.value;
          Store.emit();
          if (+devInp.value > th.projTol) U.toast('偏差超差，请执行重新校准', true);
        }
      }, ['录入']),
      el('button', {
        class: 'btn sm primary', onclick: () => {
          lp.projCalib.deviation = 0.2;
          lp.projCalib.calibratedAt = U.nowStr();
          Store.emit();
          U.toast('已重新校准，偏差恢复到 0.20 mm');
        }
      }, ['重新校准'])
    ]));
    right.appendChild(calCard);

    // 预览第一层投影
    const pv = el('canvas', { class: 'chart' });
    right.appendChild(el('div', { class: 'card' }, [el('h3', {}, ['投影预览（第1层轮廓+角度刻线）']), pv]));
    if (lp.plies.length) {
      const pj = plyProjection(lp.plies[0], 0);
      Charts.line(pv, [
        { name: '轮廓', pts: pj.outline.map(q => [q[0], q[1]]), color: '#3fa7ff' },
        { name: '角度刻线', pts: pj.angleLine.map(q => [q[0], q[1]]), color: '#f0a63c' }
      ], { height: 260, xlabel: '模具基准坐标 (mm)' });
    }
  }

  /* ============ 真空袋辅材 ============ */
  function renderBag() {
    U.clear(holder);
    const margin = th.bagMargin;
    // 铺层外轮廓（所有层覆盖范围的包络）
    let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    lp.plies.forEach(p => {
      u0 = Math.min(u0, p.cov.u0); v0 = Math.min(v0, p.cov.v0);
      u1 = Math.max(u1, p.cov.u1); v1 = Math.max(v1, p.cov.v1);
    });
    const W = (u1 - u0) * S.Lx, H = (v1 - v0) * S.Ly;
    const dims = [
      ['隔离膜', 1.0], ['透气毡', 1.0], ['袋膜', 1.6]
    ].map(([name, k]) => {
      const w = W + 2 * margin * k, h = H + 2 * margin * k;
      return { name, w: Math.round(w), h: Math.round(h), area: Math.round(w * h / 100) / 100 };
    });
    const sealLen = 2 * ((W + 2 * margin * 1.6) + (H + 2 * margin * 1.6)) / 1000;

    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const t = el('table', { class: 'grid' }, [el('tr', {}, ['辅材', '裁片尺寸(mm)', '面积(m²)'].map(h => el('th', {}, [h])))]);
    dims.forEach(d => t.appendChild(el('tr', {}, [
      el('td', {}, [d.name]),
      el('td', { class: 'num' }, [d.w + ' × ' + d.h]),
      el('td', { class: 'num' }, [U.fmt(d.area / 100, 2)])
    ])));
    t.appendChild(el('tr', {}, [
      el('td', {}, ['密封胶条']),
      el('td', { class: 'num' }, ['沿袋膜周圈']),
      el('td', { class: 'num' }, [U.fmt(sealLen, 2) + ' m'])
    ]));
    left.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['辅材裁片（按铺层外轮廓加放余量 ' + margin + ' mm）']),
      t,
      el('p', { class: 'muted small' }, ['铺层包络 ' + Math.round(W) + ' × ' + Math.round(H) + ' mm；袋膜按 1.6 倍余量防架桥。'])
    ]));

    // 裁片形状示意
    const cv = el('canvas', { class: 'chart' });
    right.appendChild(el('div', { class: 'card' }, [el('h3', {}, ['裁片形状示意']), cv]));
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.style.height = '300px';
    cv.width = cv.clientWidth * dpr; cv.height = 300 * dpr;
    const cols = ['#3fa7ff', '#27c2a5', '#f0a63c'];
    dims.forEach((d, i) => {
      const sc = Math.min((cv.width - 40 * dpr) / dims[2].w, (cv.height - 40 * dpr) / dims[2].h);
      const w = d.w * sc, h = d.h * sc;
      ctx.strokeStyle = cols[i]; ctx.lineWidth = 1.6 * dpr;
      ctx.strokeRect((cv.width - w) / 2, (cv.height - h) / 2, w, h);
      ctx.fillStyle = cols[i];
      ctx.font = `${11 * dpr}px sans-serif`;
      ctx.fillText(d.name + ' ' + d.w + '×' + d.h, (cv.width - w) / 2 + 6 * dpr, (cv.height - h) / 2 + 16 * dpr + i * 14 * dpr);
    });
  }

  /* ============ 抽真空保压检漏 ============ */
  let vacTimer = null;
  function renderVac() {
    U.clear(holder);
    if (!lp.vacRun) lp.vacRun = null;

    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.4' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const cv = el('canvas', { class: 'chart' });
    left.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['真空度曲线（保压 ' + th.holdTime + ' min，压降速率阈值 ' + th.pressureDrop + ' kPa/min）']),
      cv
    ]));

    const status = el('div');
    right.appendChild(el('div', { class: 'card' }, [el('h3', {}, ['保压状态']), status]));

    const logCard = el('div', { class: 'card' }, [el('h3', {}, ['检漏记录（随工程存档）'])]);
    const lt = el('table', { class: 'grid' }, [el('tr', {}, ['时间', '保压(min)', '平均压降(kPa/min)', '结论'].map(h => el('th', {}, [h])))]);
    (proj.leakRecords || []).forEach(r => lt.appendChild(el('tr', {}, [
      el('td', { class: 'mono small' }, [r.t]),
      el('td', { class: 'num' }, [U.fmt(r.holdMin, 0)]),
      el('td', { class: 'num' }, [U.fmt(r.rate, 2)]),
      el('td', {}, [el('span', { class: 'badge ' + (r.pass ? 'ok' : 'bad') }, [r.pass ? '合格' : '超差'])])
    ])));
    logCard.appendChild(lt);
    right.appendChild(logCard);

    function drawCurve(data, alarm) {
      Charts.line(cv, [{ name: '真空度(kPa)', pts: data, color: alarm ? '#ef5b6b' : '#3fa7ff' }],
        { height: 320, xlabel: '时间 (min)', hLine: -80, hLineLabel: '保压合格线 -80kPa' });
    }

    if (!lp.vacRun) {
      status.appendChild(el('p', { class: 'muted' }, ['未开始。抽真空后按设定时长保压计时，压降速率超阈值自动报警。']));
      status.appendChild(el('button', {
        class: 'btn primary', onclick: () => {
          lp.vacRun = { t: 0, data: [[0, 0]], alarm: false, done: false, seed: Date.now() % 100000 };
          Store.save(); renderVac(); tick();
        }
      }, ['▶ 开始抽真空']));
      drawCurve([[0, 0]], false);
      return;
    }

    const run = lp.vacRun;
    drawCurve(run.data, run.alarm);
    const last = run.data[run.data.length - 1];
    status.appendChild(el('div', { class: 'kv' }, [
      el('b', {}, ['已计时']), el('span', { class: 'mono' }, [run.t + ' / ' + th.holdTime + ' min']),
      el('b', {}, ['当前真空度']), el('span', { class: 'mono' }, [U.fmt(last[1], 1) + ' kPa']),
      el('b', {}, ['状态']), el('span', { class: run.alarm ? 'fail' : run.done ? 'pass' : 'warnc' },
        [run.alarm ? '⚠ 压降速率超阈值报警！' : run.done ? '✓ 保压完成' : '保压计时中…'])
    ]));
    const btnBox = el('div', { style: 'margin-top:10px' }, []);
    status.appendChild(btnBox);
    if (!run.done) {
      btnBox.appendChild(el('button', {
        class: 'btn danger', onclick: () => { finish(false); }
      }, ['■ 提前结束并记录']));
    }

    function tick() {
      if (vacTimer) clearTimeout(vacTimer);
      vacTimer = setTimeout(() => {
        const rng = U.mulberry32(run.seed + run.t);
        run.t += 1;
        const target = -95;
        let p = run.data[run.data.length - 1][1];
        p = p + (target - p) * 0.35 + rng() * 0.4;         // 抽气趋近 -95
        if (run.t > 5) p += 0.12 + rng() * (run.t > th.holdTime * 0.6 ? 0.9 : 0.25); // 缓慢泄漏
        run.data.push([run.t, Math.round(p * 10) / 10]);
        // 压降速率（最近5min）
        if (run.data.length > 6) {
          const d = run.data[run.data.length - 1][1] - run.data[run.data.length - 6][1];
          if (d / 5 > th.pressureDrop) run.alarm = true;
        }
        if (run.t >= th.holdTime) { finish(true); return; }
        Store.save(); renderVac(); tick();
      }, 300);
    }
    function finish(natural) {
      if (vacTimer) clearTimeout(vacTimer);
      const d = run.data;
      const rate = d.length > 2 ? (d[d.length - 1][1] - d[Math.max(0, d.length - 6)][1]) / Math.min(5, d.length - 1) : 0;
      const pass = !run.alarm && Math.abs(rate) <= th.pressureDrop;
      proj.leakRecords.push({ t: U.nowStr(), holdMin: run.t, rate: Math.round(Math.abs(rate) * 100) / 100, pass });
      lp.vacRun = null;
      Store.emit();
      U.toast(pass ? '检漏合格，记录已随工程存档' : '检漏超差，记录已存档', !pass);
    }
    if (!run.done && run.t > 0) tick();
  }

  /* ============ 铺贴工单 ============ */
  function renderWO() {
    U.clear(holder);
    holder.appendChild(el('p', { class: 'muted' }, ['每层一张工单：材料批号、角度、铺贴顺序号。工人扫码（或输入工单码）调阅。']));

    // 扫码调阅
    const scanInp = el('input', { placeholder: '输入/扫描工单码，如 ' + proj.code + '-WO-01', style: 'width:280px' });
    const scanOut = el('span', { style: 'margin-left:10px' });
    holder.appendChild(el('div', { class: 'inline', style: 'margin-bottom:12px' }, [
      scanInp,
      el('button', {
        class: 'btn sm primary', onclick: () => {
          const m = scanInp.value.trim().match(/WO-(\d+)$/i);
          U.clear(scanOut);
          if (!m) { scanOut.appendChild(el('span', { class: 'fail' }, ['工单码无效'])); return; }
          const i = +m[1] - 1, p = lp.plies[i];
          if (!p) { scanOut.appendChild(el('span', { class: 'fail' }, ['无此层工单'])); return; }
          const rl = p.rollId ? Store.roll(p.rollId) : null;
          scanOut.appendChild(el('span', { class: 'pass' },
            [`✓ 第${i + 1}层：${(Store.mat(p.matId) || {}).name}，批号 ${rl ? rl.batch : '未选卷'}，角度 ${p.angle}°，顺序号 ${i + 1}`]));
        }
      }, ['调阅']),
      scanOut
    ]));

    const grid = el('div', { class: 'row' });
    holder.appendChild(grid);
    lp.plies.forEach((p, i) => {
      const rl = p.rollId ? Store.roll(p.rollId) : null;
      const code = proj.code + '-WO-' + String(i + 1).padStart(2, '0');
      const qr = el('canvas', { class: 'qr' });
      const card = el('div', { class: 'card', style: 'min-width:260px' }, [
        el('div', { class: 'inline', style: 'justify-content:space-between' }, [
          el('b', {}, ['铺贴工单 ' + code]),
          el('span', { class: 'badge s-doing' }, ['顺序 ' + (i + 1)])
        ]),
        el('div', { class: 'inline', style: 'margin-top:8px;align-items:flex-start' }, [
          qr,
          el('div', { class: 'kv small' }, [
            el('b', {}, ['材料']), el('span', {}, [(Store.mat(p.matId) || {}).name || p.matId]),
            el('b', {}, ['批号']), el('span', { class: 'mono' }, [rl ? rl.batch : '未选卷']),
            el('b', {}, ['角度']), el('span', {}, [p.angle + '°']),
            el('b', {}, ['下料']), el('span', {}, [p.consumed ? '已下料' : '未下料'])
          ])
        ])
      ]);
      grid.appendChild(card);
      U.drawCode(qr, code);
    });
    if (!lp.plies.length) holder.appendChild(el('p', { class: 'muted' }, ['暂无铺层。']));
  }

  function render() {
    if (vacTimer) { clearTimeout(vacTimer); vacTimer = null; }
    tab === 'proj' ? renderProj() : tab === 'bag' ? renderBag() : tab === 'vac' ? renderVac() : renderWO();
  }
  render();
};
