/* p_opt.js — 铺层优化：离散角度档搜索，可中途停，帕累托前沿，一键回填 */
window.Pages = window.Pages || {};
Pages.opt = function (main) {
  const st = Store.get();
  const el = U.el;
  const proj = Store.curProject();
  if (!proj) { main.appendChild(el('p', {}, ['请先选择工程。'])); return; }
  const mold = Store.mold(proj.moldId);
  const lp = Store.layupOf(proj.id);

  main.appendChild(el('h2', {}, ['铺层角度优化 — ' + proj.code]));

  if (!lp.plies.length) { main.appendChild(el('p', {}, ['当前工程还没有铺层。'])); return; }
  if (lp.plies.length > 10) { main.appendChild(el('p', { class: 'warnc' }, ['层数超过10层，搜索空间过大，请精简后再优化。'])); return; }

  /* 优化会话状态（挂在 layup 上，随工程持久化，中途停止不丢） */
  if (!lp.optRun) lp.optRun = null;

  const ANGLES = [null, 0, 45, -45, 90]; // null = 去掉该层（重量维度）
  const holder = el('div');
  main.appendChild(holder);

  let timer = null;

  function evalCandidate(combo) {
    // combo: 每层角度或 null；材料沿用当前铺层
    const plies = [];
    combo.forEach((a, i) => {
      if (a === null) return;
      plies.push({ angle: a, mat: Store.mat(lp.plies[i].matId), cov: 1 });
    });
    if (!plies.length) return null;
    const clt = CLT.analyze(plies, 25 - (mold.cureT || 180));
    const S = GEO.surf(mold.surfaceKey);
    const warp = CLT.warpage(clt.kappa, S.Lx, S.Ly);
    const areaM2 = (S.Lx / 1000) * (S.Ly / 1000);
    let w = 0;
    combo.forEach((a, i) => {
      if (a === null) return;
      const p = lp.plies[i], m = Store.mat(p.matId);
      w += m.areal * areaM2 * (p.cov.u1 - p.cov.u0) * (p.cov.v1 - p.cov.v0);
    });
    return { combo: combo.slice(), weight: Math.round(w), defl: Math.abs(warp.max.w) };
  }

  function isPareto(pt, all) {
    return !all.some(o => o !== pt && o.weight <= pt.weight && o.defl <= pt.defl && (o.weight < pt.weight || o.defl < pt.defl));
  }

  function startRun() {
    const n = lp.plies.length;
    const total = Math.pow(5, n);
    // 确定性采样：固定种子遍历（分层拉丁式伪随机 + 全空间小层数穷举）
    const rng = U.mulberry32(20261120);
    const seen = new Set();
    const samples = [];
    if (total <= 20000) { // 穷举
      const idx = new Array(n).fill(0);
      for (let k = 0; k < total; k++) {
        samples.push(idx.map(x => ANGLES[x]));
        for (let d = n - 1; ; d--) { idx[d] = (idx[d] + 1) % 5; if (idx[d] !== 0 || d === 0) break; }
      }
    } else { // 确定性采样 6000 个
      while (samples.length < 6000) {
        const c = [];
        for (let i = 0; i < n; i++) c.push(ANGLES[Math.floor(rng() * 5)]);
        const key = c.join(',');
        if (seen.has(key)) continue;
        seen.add(key); samples.push(c);
      }
    }
    lp.optRun = {
      startedAt: U.nowStr(), n, total: samples.length, done: 0,
      results: [], best: null, log: [], finished: false, samples
    };
    Store.save();
    runChunk();
  }

  function runChunk() {
    const run = lp.optRun;
    if (!run || run.finished) return;
    const t0 = performance.now();
    while (run.done < run.total && performance.now() - t0 < 40) {
      const r = evalCandidate(run.samples[run.done]);
      run.done++;
      if (!r) continue;
      run.results.push({ w: r.weight, d: Math.round(r.defl * 1000) / 1000, combo: r.combo });
      if (!run.best || r.defl < run.best.d) {
        run.best = { w: r.weight, d: Math.round(r.defl * 1000) / 1000, combo: r.combo };
        run.log.push({ i: run.done, w: r.weight, d: Math.round(r.defl * 1000) / 1000 });
      }
    }
    if (run.done >= run.total) run.finished = true;
    Store.save();
    render();
    if (!run.finished) timer = setTimeout(runChunk, 30);
  }

  function stopRun() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (lp.optRun) { lp.optRun.stopped = true; Store.save(); }
    render();
    U.toast('已停止，已算结果保留');
  }

  function paretoFront(results) {
    const pts = results.slice().sort((a, b) => a.w - b.w);
    const front = [];
    let bestD = Infinity;
    pts.forEach(p => { if (p.d < bestD) { front.push(p); bestD = p.d; } });
    return front;
  }

  let sel = null; // 选中的帕累托解

  function render() {
    U.clear(holder);
    const run = lp.optRun;

    const bar = el('div', { class: 'inline', style: 'margin-bottom:12px' }, [
      el('button', { class: 'btn primary', onclick: startRun }, [run && !run.finished && !run.stopped ? '重新开始' : '开始优化']),
      run && !run.finished && !run.stopped ? el('button', { class: 'btn warn', onclick: stopRun }, ['■ 停止（保留已算结果）']) : null,
      run ? el('span', { class: 'muted' }, [
        `进度 ${run.done}/${run.total}（${U.fmt(run.done / run.total * 100, 1)}%）` +
        (run.finished ? ' · 已完成' : run.stopped ? ' · 已停止，结果保留' : ' · 计算中…')
      ]) : null
    ].filter(Boolean));
    holder.appendChild(bar);

    if (!run) {
      holder.appendChild(el('div', { class: 'card' }, [
        el('p', {}, ['优化目标：翘曲最小 + 重量最轻。每层角度在 0°/±45°/90° 四档离散取值，另允许"去掉该层"以拉开重量梯度。']),
        el('p', { class: 'muted small' }, ['当前铺层 ' + lp.plies.length + ' 层，搜索空间 5^' + lp.plies.length + ' = ' + Math.pow(5, lp.plies.length) + ' 种组合；采样与迭代顺序固定，结果可复现。'])
      ]));
      return;
    }

    // 进度条
    holder.appendChild(el('div', { class: 'bar', style: 'margin-bottom:14px;height:10px' }, [
      el('i', { style: 'width:' + (run.done / run.total * 100) + '%' })
    ]));

    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.4' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    // 帕累托前沿
    const front = paretoFront(run.results);
    const frontKeys = new Set(front.map(f => f.w + '|' + f.d));
    const cv = el('canvas', { class: 'chart' });
    left.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['重量-变形 帕累托前沿（点击散点选中解）']),
      cv
    ]));
    const pts = run.results.map(r => ({
      x: r.w, y: r.d, pareto: frontKeys.has(r.w + '|' + r.d),
      sel: sel && sel.w === r.w && sel.d === r.d
    }));
    const axes = Charts.scatter(cv, pts, { xlabel: '重量 (g)', ylabel: '最大翘曲 (mm)', height: 340 });
    cv.style.cursor = 'crosshair';
    cv.addEventListener('click', e => {
      const rect = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
      let best = null, bd = 1e9;
      run.results.forEach(r => {
        const dx = axes.X(r.w) - mx, dy = axes.Y(r.d) - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = r; }
      });
      if (best) { sel = { w: best.w, d: best.d, combo: best.combo }; render(); }
    });

    // 迭代最优记录
    const logCard = el('div', { class: 'card' }, [el('h3', {}, ['迭代最优解记录'])]);
    const lt = el('table', { class: 'grid' }, [el('tr', {}, ['迭代', '重量(g)', '翘曲(mm)'].map(h => el('th', {}, [h])))]);
    run.log.slice(-12).forEach(l => lt.appendChild(el('tr', {}, [
      el('td', { class: 'num' }, [String(l.i)]),
      el('td', { class: 'num' }, [U.fmt(l.w, 0)]),
      el('td', { class: 'num' }, [U.fmt(l.d, 3)])
    ])));
    logCard.appendChild(el('div', { class: 'pill-scroll' }, [lt]));
    right.appendChild(logCard);

    // 选中解 / 最优解回填
    const show = sel || run.best;
    if (show) {
      const comboStr = show.combo.map(a => a === null ? '—' : (a > 0 ? '+' + a : String(a))).join(' / ');
      right.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, [sel ? '已选中解' : '当前最优解（翘曲最小）']),
        el('div', { class: 'kv' }, [
          el('b', {}, ['角度序列']), el('span', { class: 'mono' }, [comboStr]),
          el('b', {}, ['重量']), el('span', {}, [U.fmt(show.w, 0) + ' g']),
          el('b', {}, ['最大翘曲']), el('span', {}, [U.fmt(show.d, 3) + ' mm'])
        ]),
        el('div', { style: 'margin-top:10px' }, [
          Store.layupEditable(proj) ? el('button', {
            class: 'btn primary', onclick: () => {
              U.opinionModal('回填为新铺层方案', '请填写处理意见（回填原因）', op => {
                const newPlies = [];
                show.combo.forEach((a, i) => {
                  if (a === null) return;
                  const src = lp.plies[i];
                  newPlies.push({ id: U.uid('PLY'), matId: src.matId, angle: a, cov: JSON.parse(JSON.stringify(src.cov)), rollId: null, consumed: false });
                });
                lp.plies = newPlies;
                proj.history.push({ t: U.nowStr(), from: proj.status, to: proj.status, opinion: '优化回填：' + op, user: '当前用户' });
                SIM.clearCache(); Store.emit();
                U.toast('已回填 ' + newPlies.length + ' 层新铺层方案');
                App.go('layup');
              });
            }
          }, ['一键回填为新铺层方案']) : el('span', { class: 'muted' }, ['工程已归档锁定，需变更单解锁后才能回填'])
        ])
      ]));
    }
  }

  render();
  // 若上次离开时在计算中，继续
  if (lp.optRun && !lp.optRun.finished && !lp.optRun.stopped && !timer) runChunk();
};
