/* p_layup.js — 铺层编辑：层列表编辑 + 铺覆模拟（剪切角预警/纤维流线/剪口/夹持/压实空隙率/拼接缝） */
window.Pages = window.Pages || {};
Pages.layup = function (main) {
  const st = Store.get();
  const el = U.el;
  const proj = Store.curProject();
  if (!proj) { main.appendChild(el('p', {}, ['请先在工程列表创建工程。'])); return; }
  const mold = Store.mold(proj.moldId);
  const lp = Store.layupOf(proj.id);
  const editable = Store.layupEditable(proj);
  let tab = st.ui.layupTab || 'plies';
  let selPly = 0, showShear = true, showGrid = true, showStream = true, showSplice = true;

  main.appendChild(el('h2', {}, ['铺层编辑 — ' + proj.code + ' ' + proj.name]));

  if (!editable) {
    main.appendChild(el('div', { class: 'card', style: 'border-color:var(--warn)' }, [
      el('span', { class: 'warnc' }, ['🔒 工程已归档，铺层已锁定。如需修改，请先在工程列表登记变更单解锁。'])
    ]));
  } else if (proj.status === '已归档' && proj.unlocked) {
    main.appendChild(el('div', { class: 'card', style: 'border-color:var(--accent)' }, [
      el('span', {}, ['⚠ 本工程已通过变更单解锁，修改后请重新走评审归档流程。'])
    ]));
  }

  const tabs = el('div', { class: 'tabs' }, [
    el('button', { class: tab === 'plies' ? 'active' : '', onclick: () => { tab = 'plies'; st.ui.layupTab = tab; Store.save(); render(); } }, ['铺层列表']),
    el('button', { class: tab === 'drape' ? 'active' : '', onclick: () => { tab = 'drape'; st.ui.layupTab = tab; Store.save(); render(); } }, ['铺覆模拟'])
  ]);
  main.appendChild(tabs);
  const holder = el('div');
  main.appendChild(holder);

  function matOf(id) { return Store.mat(id); }

  /* ================= 铺层列表 ================= */
  function renderPlies() {
    U.clear(holder);

    if (editable) {
      holder.appendChild(el('div', { class: 'inline', style: 'margin-bottom:10px' }, [
        el('button', {
          class: 'btn primary sm', onclick: () => {
            lp.plies.push({ id: U.uid('PLY'), matId: st.mats[0].id, angle: 0,
              cov: { u0: 0.06, v0: 0.1, u1: 0.94, v1: 0.9 }, rollId: null, consumed: false });
            SIM.clearCache(); Store.emit();
          }
        }, ['＋ 添加铺层']),
        el('span', { class: 'muted small' }, ['角度档位：0° / +45° / -45° / 90°；覆盖范围为 UV 坐标，必须在铺贴边界内'])
      ]));
    }

    const tbl = el('table', { class: 'grid' }, [
      el('tr', {}, ['#', '材料牌号', '角度', '覆盖范围 u0,v0 → u1,v1', '料卷(批号)', '边界', '下料', '操作'].map(h => el('th', {}, [h])))
    ]);

    lp.plies.forEach((p, i) => {
      const inBd = GEO.rectInBoundary(mold, p.cov);
      const tr = el('tr', { class: inBd ? '' : 'row-bad' });

      // 材料
      const matSel = el('select', { disabled: !editable }, st.mats.map(m =>
        el('option', { value: m.id, selected: m.id === p.matId ? '' : null }, [m.name])));
      matSel.addEventListener('change', () => { p.matId = matSel.value; p.rollId = null; p.consumed = false; SIM.clearCache(); Store.emit(); });

      // 角度
      const angSel = el('select', { disabled: !editable }, [0, 45, -45, 90].map(a =>
        el('option', { value: a, selected: a === p.angle ? '' : null }, [(a > 0 ? '+' : '') + a + '°'])));
      angSel.addEventListener('change', () => { p.angle = +angSel.value; SIM.clearCache(); Store.emit(); });

      // 覆盖范围
      const covBox = el('div', { class: 'inline' });
      ['u0', 'v0', 'u1', 'v1'].forEach(k => {
        const inp = el('input', { type: 'number', step: '0.02', min: 0, max: 1, value: p.cov[k], style: 'width:64px', disabled: !editable });
        inp.addEventListener('change', () => {
          p.cov[k] = Math.max(0, Math.min(1, +inp.value));
          SIM.clearCache(); Store.emit();
        });
        covBox.appendChild(inp);
      });

      // 料卷（超期锁定不可选）
      const rollSel = el('select', { disabled: !editable });
      rollSel.appendChild(el('option', { value: '' }, ['（未选卷）']));
      st.rolls.filter(r => r.matId === p.matId).forEach(r => {
        const s = Store.rollStatus(r);
        const opt = el('option', {
          value: r.id, selected: r.id === p.rollId ? '' : null,
          disabled: !Store.rollUsable(r) && r.id !== p.rollId
        }, [r.id + ' / ' + r.batch + (Store.rollUsable(r) ? '' : '（' + s.label + '🔒）')]);
        rollSel.appendChild(opt);
      });
      rollSel.addEventListener('change', () => { p.rollId = rollSel.value || null; p.consumed = false; Store.emit(); });

      // 下料
      const cutCell = el('td', {});
      if (p.consumed) cutCell.appendChild(el('span', { class: 'badge ok' }, ['已下料']));
      else if (p.rollId) cutCell.appendChild(el('button', {
        class: 'btn sm', disabled: !editable,
        onclick: () => { Store.consumeRoll(p.id, proj.id); U.toast('已按轮廓面积扣减库存'); }
      }, ['下料扣减']));
      else cutCell.appendChild(el('span', { class: 'muted small' }, ['选卷后下料']));

      // 操作
      const ops = el('td', {});
      if (editable) {
        ops.appendChild(el('button', {
          class: 'btn sm', title: '复制本层', onclick: () => {
            const cp = JSON.parse(JSON.stringify(p));
            cp.id = U.uid('PLY'); cp.consumed = false;
            lp.plies.splice(i + 1, 0, cp);
            SIM.clearCache(); Store.emit();
          }
        }, ['复制']));
        ops.appendChild(el('button', {
          class: 'btn sm', disabled: i === 0, onclick: () => {
            [lp.plies[i - 1], lp.plies[i]] = [lp.plies[i], lp.plies[i - 1]];
            SIM.clearCache(); Store.emit();
          }
        }, ['↑']));
        ops.appendChild(el('button', {
          class: 'btn sm', disabled: i === lp.plies.length - 1, onclick: () => {
            [lp.plies[i + 1], lp.plies[i]] = [lp.plies[i], lp.plies[i + 1]];
            SIM.clearCache(); Store.emit();
          }
        }, ['↓']));
        ops.appendChild(el('button', {
          class: 'btn sm danger', onclick: () => { lp.plies.splice(i, 1); SIM.clearCache(); Store.emit(); }
        }, ['删']));
      } else {
        ops.appendChild(el('span', { class: 'muted small' }, ['已锁定']));
      }

      tr.appendChild(el('td', { class: 'num' }, [String(i + 1)]));
      tr.appendChild(el('td', {}, [matSel]));
      tr.appendChild(el('td', {}, [angSel]));
      tr.appendChild(el('td', {}, [covBox]));
      tr.appendChild(el('td', {}, [rollSel]));
      tr.appendChild(el('td', {}, [el('span', { class: 'badge ' + (inBd ? 'ok' : 'bad') }, [inBd ? '界内' : '越界'])]));
      tr.appendChild(cutCell);
      tr.appendChild(ops);
      tbl.appendChild(tr);
    });
    holder.appendChild(tbl);
    if (!lp.plies.length) holder.appendChild(el('p', { class: 'muted' }, ['暂无铺层，点击"添加铺层"开始。']));

    // 累计厚度/重量速览
    const matOfF = id => Store.mat(id);
    let thk = 0, w = 0;
    const S = GEO.surf(mold.surfaceKey);
    lp.plies.forEach(p => {
      const m = matOfF(p.matId);
      thk += m.t;
      w += m.areal * (S.Lx / 1000) * (S.Ly / 1000) * (p.cov.u1 - p.cov.u0) * (p.cov.v1 - p.cov.v0);
    });
    holder.appendChild(el('p', { class: 'muted' }, [
      `共 ${lp.plies.length} 层 · 累计厚度 ${U.fmt(thk, 2)} mm · 估算净重 ${U.fmt(w, 0)} g · 仿真指纹 `,
      el('span', { class: 'mono' }, ['#' + SIM.keyOf(proj, lp, mold, st.mats)])
    ]));
  }

  /* ================= 铺覆模拟 ================= */
  function renderDrape() {
    U.clear(holder);
    const sim = SIM.run(proj, lp, mold, st.mats, st.thresholds);
    const th = st.thresholds;

    const row = el('div', { class: 'row' });
    holder.appendChild(row);
    const left = el('div', { class: 'col', style: 'flex:1.5' });
    const right = el('div', { class: 'col' });
    row.appendChild(left); row.appendChild(right);

    const canvas = el('canvas', { class: 'view3d' });
    const plySel = el('select', {}, lp.plies.map((p, i) =>
      el('option', { value: i, selected: i === selPly ? '' : null }, ['第' + (i + 1) + '层 ' + (p.angle > 0 ? '+' : '') + p.angle + '° ' + (matOf(p.matId) || {}).name])));
    plySel.addEventListener('change', () => { selPly = +plySel.value; renderDrape(); });

    left.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'inline', style: 'margin-bottom:8px' }, [
        el('span', { class: 'muted small' }, ['显示层：']), plySel,
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showShear, onchange: e => { showShear = e.target.checked; renderDrape(); } }), ' 剪切角云图']),
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showGrid, onchange: e => { showGrid = e.target.checked; renderDrape(); } }), ' 纤维网格']),
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showStream, onchange: e => { showStream = e.target.checked; renderDrape(); } }), ' 纤维流线']),
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showSplice, onchange: e => { showSplice = e.target.checked; renderDrape(); } }), ' 拼接缝'])
      ]),
      canvas
    ]));

    // 3D 场景
    const base = GEO.mesh(mold);
    const items = [];
    if (showShear) {
      const warn = th.lockAngle * th.shearWarnPct / 100;
      items.push(V3.meshItem(base.pts, base.nu, base.nv, { values: sim.shear, vmin: 0, vmax: Math.max(th.lockAngle, sim.maxShear) }));
    } else {
      items.push(V3.meshItem(base.pts, base.nu, base.nv, { color: [70, 84, 104] }));
    }
    const loop = GEO.boundary3D(mold, 1.5);
    if (loop.length > 2) { loop.push(loop[0]); items.push({ kind: 'lines', segs: [loop], color: '#f0a63c', width: 2 }); }

    const ply = lp.plies[selPly];
    if (ply) {
      if (showGrid) {
        const grid = GEO.fiberGrid(mold, ply.cov, lp.darts, 2.2);
        items.push({ kind: 'lines', segs: grid, color: 'rgba(220,230,245,.55)', width: 0.8 });
      }
      if (showStream) {
        const sl = GEO.streamlines(mold, ply.angle);
        items.push({ kind: 'arrows', segs: sl.map(l => l.map(p => [p[0], p[1], p[2] + 2.6])), color: '#27c2a5', width: 1.6 });
      }
      // 本层轮廓
      const ol = GEO.outline3D(mold, ply.cov, 2.0);
      items.push({ kind: 'lines', segs: [ol], color: '#3fa7ff', width: 1.8 });
    }
    // 拼接缝：相邻层轮廓描边
    if (showSplice) {
      for (let i = 0; i < lp.plies.length - 1; i++) {
        const a = lp.plies[i], b = lp.plies[i + 1];
        if (a.matId === b.matId && a.angle === b.angle) {
          items.push({ kind: 'lines', segs: [GEO.outline3D(mold, a.cov, 1.2), GEO.outline3D(mold, b.cov, 1.4)], color: '#ef5b6b', width: 1.4, dash: true });
        }
      }
    }
    // 剪口
    (lp.darts || []).forEach(d => {
      const fn = GEO.surf(mold.surfaceKey).fn;
      const a = d.angle * Math.PI / 180;
      const p0 = fn(d.u, d.v), p1 = fn(d.u + Math.cos(a) * d.depth, d.v + Math.sin(a) * d.depth);
      items.push({ kind: 'lines', segs: [[[p0[0], p0[1], p0[2] + 3], [p1[0], p1[1], p1[2] + 3]]], color: '#ff8fb0', width: 3 });
    });
    // 夹持点（按顺序编号）
    if (lp.clamps.length) {
      const fn = GEO.surf(mold.surfaceKey).fn;
      const sorted = lp.clamps.slice().sort((x, y) => x.seq - y.seq);
      items.push({
        kind: 'points',
        pts: sorted.map(c => { const p = fn(c.u, c.v); return [p[0], p[1], p[2] + 3]; }),
        color: '#f0a63c', size: 5, labels: sorted.map(c => '夹' + c.seq)
      });
    }
    const viewer = new V3.Viewer(canvas);
    viewer.fit(base.pts);
    viewer.setItems(items);

    /* 右侧控制与结果 */
    const warn = th.lockAngle * th.shearWarnPct / 100;
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['剪切角预警']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['最大剪切角']), el('span', { class: sim.maxShear > warn ? 'fail' : 'pass' },
          [U.fmt(sim.maxShear, 1) + '°' + (sim.maxShear > warn ? ' ⚠ 接近锁模角' : '')]),
        el('b', {}, ['锁模角']), el('span', {}, [th.lockAngle + '°（预警线 ' + U.fmt(warn, 1) + '°）']),
        el('b', {}, ['危险区位置']), el('span', { class: 'mono' },
          [sim.maxShearAt ? '(u=' + U.fmt(sim.maxShearAt.u, 2) + ', v=' + U.fmt(sim.maxShearAt.v, 2) + ')' : '—'])
      ])
    ]));

    // 剪口编辑
    const dCard = el('div', { class: 'card' }, [el('h3', {}, ['料片剪口（网格沿剪口断开后重新铺覆）'])]);
    (lp.darts || []).forEach((d, i) => {
      dCard.appendChild(el('div', { class: 'inline small', style: 'margin-bottom:4px' }, [
        el('span', { class: 'mono' }, [`剪口${i + 1}: (${U.fmt(d.u, 2)},${U.fmt(d.v, 2)}) ∠${d.angle}° 深${U.fmt(d.depth * 100, 0)}%幅宽`]),
        editable ? el('button', { class: 'btn sm danger', onclick: () => { lp.darts.splice(i, 1); SIM.clearCache(); Store.emit(); } }, ['删']) : null
      ]));
    });
    if (editable) {
      const du = el('input', { type: 'number', value: 0.5, step: '0.05', style: 'width:64px' });
      const dv = el('input', { type: 'number', value: 0.1, step: '0.05', style: 'width:64px' });
      const da = el('input', { type: 'number', value: 90, step: '15', style: 'width:64px' });
      const dd = el('input', { type: 'number', value: 0.12, step: '0.02', style: 'width:64px' });
      dCard.appendChild(el('div', { class: 'inline small' }, [
        el('span', {}, ['u']), du, el('span', {}, ['v']), dv, el('span', {}, ['角°']), da, el('span', {}, ['深']), dd,
        el('button', {
          class: 'btn sm primary', onclick: () => {
            lp.darts.push({ id: U.uid('DT'), u: +du.value, v: +dv.value, angle: +da.value, depth: +dd.value });
            SIM.clearCache(); Store.emit();
          }
        }, ['＋ 加剪口'])
      ]));
    }
    right.appendChild(dCard);

    // 夹持点
    const cCard = el('div', { class: 'card' }, [el('h3', {}, ['固定夹持点（按先后顺序夹持）'])]);
    lp.clamps.slice().sort((a, b) => a.seq - b.seq).forEach((c, i) => {
      cCard.appendChild(el('div', { class: 'inline small', style: 'margin-bottom:4px' }, [
        el('span', { class: 'mono' }, [`顺序${c.seq}: (${U.fmt(c.u, 2)},${U.fmt(c.v, 2)})`]),
        editable ? el('button', { class: 'btn sm danger', onclick: () => { lp.clamps = lp.clamps.filter(x => x.id !== c.id); SIM.clearCache(); Store.emit(); } }, ['删']) : null
      ]));
    });
    if (editable) {
      const cu = el('input', { type: 'number', value: 0.5, step: '0.05', style: 'width:64px' });
      const cv = el('input', { type: 'number', value: 0.5, step: '0.05', style: 'width:64px' });
      cCard.appendChild(el('div', { class: 'inline small' }, [
        el('span', {}, ['u']), cu, el('span', {}, ['v']), cv,
        el('button', {
          class: 'btn sm primary', onclick: () => {
            const seq = lp.clamps.length ? Math.max.apply(null, lp.clamps.map(c => c.seq)) + 1 : 1;
            lp.clamps.push({ id: U.uid('CL'), u: +cu.value, v: +cv.value, seq });
            SIM.clearCache(); Store.emit();
          }
        }, ['＋ 加夹持点'])
      ]));
    }
    right.appendChild(cCard);

    // 压实辊与空隙率
    const rpCard = el('div', { class: 'card' }, [
      el('h3', {}, ['压实辊滚压 → 层间空隙率（沿厚度逐层）'])
    ]);
    const rp = el('input', { type: 'number', value: lp.rollerPressure, step: '20', style: 'width:90px', disabled: !editable });
    rp.addEventListener('change', () => { lp.rollerPressure = +rp.value; SIM.clearCache(); Store.emit(); });
    rpCard.appendChild(el('div', { class: 'inline small', style: 'margin-bottom:8px' }, [
      el('span', {}, ['辊压力 (kPa)：']), rp,
      el('span', { class: 'muted' }, ['压力越大空隙率越低，中间层排气差于表层'])
    ]));
    const voidCanvas = el('canvas', { class: 'chart' });
    rpCard.appendChild(voidCanvas);
    right.appendChild(rpCard);
    Charts.hbars(voidCanvas,
      lp.plies.map((p, i) => '第' + (i + 1) + '层'),
      sim.voids,
      { threshold: th.voidMax, unit: '%' });
  }

  function render() { tab === 'plies' ? renderPlies() : renderDrape(); }
  render();
};
