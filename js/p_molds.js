/* p_molds.js — 模具：型面/偏置补偿面/热膨胀预缩放/铺贴边界/偏置失败手填补偿 */
window.Pages = window.Pages || {};
Pages.molds = function (main) {
  const st = Store.get();
  const el = U.el;
  let moldId = (st.ui.moldSel && Store.mold(st.ui.moldSel)) ? st.ui.moldSel : (Store.curProject() || {}).moldId || st.molds[0].id;
  let showOffset = true, showBoundary = true;

  main.appendChild(el('h2', {}, ['模具型面与补偿']));

  const moldSel = el('select', {}, st.molds.map(m =>
    el('option', { value: m.id, selected: m.id === moldId ? '' : null }, [m.name])));
  moldSel.addEventListener('change', () => { moldId = moldSel.value; st.ui.moldSel = moldId; Store.save(); render(); });

  const holder = el('div');
  main.appendChild(el('div', { class: 'inline', style: 'margin-bottom:10px' }, [
    el('span', { class: 'muted' }, ['选择模具：']), moldSel
  ]));
  main.appendChild(holder);

  function render() {
    U.clear(holder);
    const mold = Store.mold(moldId);
    const proj = Store.curProject();
    const layup = proj && proj.moldId === mold.id ? Store.layupOf(proj.id) : { plies: [] };
    const matOf = id => Store.mat(id);

    const row = el('div', { class: 'row' });
    holder.appendChild(row);

    /* ---- 左：3D ---- */
    const left = el('div', { class: 'col', style: 'flex:1.4' });
    row.appendChild(left);
    const canvas = el('canvas', { class: 'view3d' });
    left.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'inline', style: 'margin-bottom:8px' }, [
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showOffset, onchange: e => { showOffset = e.target.checked; render(); } }), ' 偏置补偿面']),
        el('label', { class: 'inline small' }, [el('input', { type: 'checkbox', checked: showBoundary, onchange: e => { showBoundary = e.target.checked; render(); } }), ' 铺贴边界线']),
        el('span', { class: 'muted small' }, ['拖动旋转 · 滚轮缩放 · 双击复位'])
      ]),
      canvas
    ]));

    const base = GEO.mesh(mold);
    const off = GEO.offsetMesh(mold, layup, matOf);
    const items = [V3.meshItem(base.pts, base.nu, base.nv, { color: [70, 84, 104] })];
    if (showOffset) items.push(V3.meshItem(off.pts, off.nu, off.nv, { color: [46, 120, 150], wire: true }));
    if (showBoundary && mold.boundary.length > 2) {
      const loop = GEO.boundary3D(mold, 1.5);
      loop.push(loop[0]);
      items.push({ kind: 'lines', segs: [loop], color: '#f0a63c', width: 2 });
    }
    // 偏置失败区域标红
    if (off.failed.length) {
      const pts = off.failed.map(f => {
        const p = base.pts[base.idx(f.i, f.j)];
        return [p[0], p[1], p[2] + 2];
      });
      items.push({ kind: 'points', pts, color: '#ef5b6b', size: 5, labels: off.failed.map(() => '偏置失败') });
    }
    const viewer = new V3.Viewer(canvas);
    viewer.fit(base.pts);
    viewer.setItems(items);

    /* ---- 右：参数 ---- */
    const right = el('div', { class: 'col' });
    row.appendChild(right);

    // 热膨胀预缩放
    const partAlpha = 2.5e-6; // 典型碳纤维层合板面内CTE
    const dT = (mold.cureT || 180) - 25;
    const scale = GEO.prescale(mold, partAlpha, mold.cureT || 180, 25);
    const S = GEO.surf(mold.surfaceKey);
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['热膨胀预缩放']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['模具材料']), el('span', {}, [mold.material + '（CTE ' + mold.cte.toExponential(1) + ' /℃）']),
        el('b', {}, ['固化温差']), el('span', {}, ['ΔT = ' + dT + ' ℃（室温25 → 固化' + (mold.cureT || 180) + '）']),
        el('b', {}, ['预缩放系数']), el('span', { class: 'mono' }, [scale.toFixed(6)]),
        el('b', {}, ['名义尺寸']), el('span', {}, [S.Lx + ' × ' + S.Ly + ' mm']),
        el('b', {}, ['缩放后尺寸']), el('span', {}, [U.fmt(S.Lx * scale, 1) + ' × ' + U.fmt(S.Ly * scale, 1) + ' mm'])
      ])
    ]));

    // 累计厚度与偏置
    const maxT = (() => {
      let mx = 0;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++)
        mx = Math.max(mx, GEO.thicknessAt(layup, matOf, i / 10, j / 10));
      return mx;
    })();
    right.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, ['偏置补偿面（按铺层累计厚度）']),
      el('div', { class: 'kv' }, [
        el('b', {}, ['当前工程']), el('span', {}, [proj && proj.moldId === mold.id ? proj.code + '（' + layup.plies.length + ' 层）' : '（当前工程不使用本模具，按空铺层显示）']),
        el('b', {}, ['最大累计厚度']), el('span', {}, [U.fmt(maxT, 2) + ' mm']),
        el('b', {}, ['偏置失败区域']), el('span', { class: off.failed.length ? 'fail' : 'pass' },
          [off.failed.length ? off.failed.length + ' 处（局部曲率半径小于偏置量）' : '无'])
      ])
    ]));

    // 偏置失败 → 手填补偿
    if (off.failed.length) {
      const card = el('div', { class: 'card' }, [el('h3', {}, ['偏置失败区域 · 手填补偿量'])]);
      const t = el('table', { class: 'grid' }, [el('tr', {}, ['位置(u,v)', '建议补偿(mm)', '手填补偿(mm)', ''].map(h => el('th', {}, [h])))]);
      off.failed.slice(0, 12).forEach(f => {
        const key = f.i + ',' + f.j;
        const inp = el('input', { type: 'number', step: '0.05', style: 'width:90px', value: (mold.manualComp || {})[key] !== undefined ? mold.manualComp[key] : '' });
        const btn = el('button', {
          class: 'btn sm primary', onclick: () => {
            if (!mold.manualComp) mold.manualComp = {};
            if (inp.value === '') delete mold.manualComp[key];
            else mold.manualComp[key] = +inp.value;
            SIM.clearCache(); Store.emit();
            U.toast('补偿量已登记，偏置面已重算');
          }
        }, ['应用']);
        t.appendChild(el('tr', {}, [
          el('td', { class: 'mono' }, ['(' + U.fmt(f.u, 2) + ', ' + U.fmt(f.v, 2) + ')']),
          el('td', { class: 'num' }, [f.need]),
          el('td', {}, [inp]), el('td', {}, [btn])
        ]));
      });
      card.appendChild(t);
      if (off.failed.length > 12) card.appendChild(el('p', { class: 'muted small' }, ['…共 ' + off.failed.length + ' 处，仅列前 12 处']));
      right.appendChild(card);
    }

    // 铺贴边界编辑
    const bCard = el('div', { class: 'card' }, [
      el('h3', {}, ['铺贴边界线（UV坐标，边界外不允许落层）'])
    ]);
    const bt = el('table', { class: 'grid' }, [el('tr', {}, ['#', 'u', 'v', ''].map(h => el('th', {}, [h])))]);
    mold.boundary.forEach((pt, i) => {
      const ui = el('input', { type: 'number', step: '0.01', min: 0, max: 1, value: pt[0], style: 'width:80px' });
      const vi = el('input', { type: 'number', step: '0.01', min: 0, max: 1, value: pt[1], style: 'width:80px' });
      const upd = () => {
        pt[0] = Math.max(0, Math.min(1, +ui.value));
        pt[1] = Math.max(0, Math.min(1, +vi.value));
        SIM.clearCache(); Store.emit();
      };
      ui.addEventListener('change', upd); vi.addEventListener('change', upd);
      bt.appendChild(el('tr', {}, [
        el('td', {}, ['P' + (i + 1)]), el('td', {}, [ui]), el('td', {}, [vi]),
        el('td', {}, [el('button', {
          class: 'btn sm danger', onclick: () => {
            if (mold.boundary.length <= 3) { U.toast('边界至少3个点', true); return; }
            mold.boundary.splice(i, 1); SIM.clearCache(); Store.emit();
          }
        }, ['删'])])
      ]));
    });
    bCard.appendChild(bt);
    bCard.appendChild(el('button', {
      class: 'btn sm', onclick: () => { mold.boundary.push([0.5, 0.5]); Store.emit(); }
    }, ['＋ 加点']));
    right.appendChild(bCard);
  }

  render();
};
