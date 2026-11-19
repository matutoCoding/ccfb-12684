/* p_materials.js — 材料库：预浸料牌号 + 按卷库存（批号/幅宽/库位/晾置时长/安全库存） */
window.Pages = window.Pages || {};
Pages.materials = function (main) {
  const st = Store.get();
  const el = U.el;

  main.appendChild(el('h2', {}, ['材料库']));

  /* ===== 预浸料牌号 ===== */
  main.appendChild(el('h3', {}, ['预浸料牌号（力学/热物性参数，供仿真调用）']));
  const mt = el('table', { class: 'grid' }, [
    el('tr', {}, ['牌号', '类型', 'E1(MPa)', 'E2(MPa)', 'ν12', 'G12(MPa)', 'α1(1/℃)', 'α2(1/℃)', '单层厚(mm)', '面密度(g/m²)', '固化温度(℃)'].map(h => el('th', {}, [h])))
  ]);
  st.mats.forEach(m => mt.appendChild(el('tr', {}, [
    el('td', {}, [m.name]), el('td', {}, [m.type]),
    el('td', { class: 'num' }, [U.fmt(m.E1, 0)]), el('td', { class: 'num' }, [U.fmt(m.E2, 0)]),
    el('td', { class: 'num' }, [U.fmt(m.nu12, 2)]), el('td', { class: 'num' }, [U.fmt(m.G12, 0)]),
    el('td', { class: 'num' }, [m.alpha1.toExponential(1)]), el('td', { class: 'num' }, [m.alpha2.toExponential(1)]),
    el('td', { class: 'num' }, [U.fmt(m.t, 2)]), el('td', { class: 'num' }, [U.fmt(m.areal, 0)]),
    el('td', { class: 'num' }, [U.fmt(m.cureT, 0)])
  ])));
  main.appendChild(mt);

  /* ===== 卷材库存 ===== */
  const headRow = el('div', { class: 'inline', style: 'justify-content:space-between;margin-top:18px' }, [
    el('h3', { style: 'margin:0' }, ['卷材库存（按卷管理）']),
    el('button', {
      class: 'btn primary sm', onclick: () => {
        U.modal('新卷入库', (body, close) => {
          const matSel = el('select', {}, st.mats.map(m => el('option', { value: m.id }, [m.name])));
          const batch = el('input', { placeholder: '如 PC2607-A' });
          const width = el('input', { type: 'number', value: 1000 });
          const loc = el('input', { placeholder: '如 冷库A-05' });
          const len = el('input', { type: 'number', value: 50 });
          const lim = el('input', { type: 'number', value: 240 });
          const safe = el('input', { type: 'number', value: 20 });
          body.appendChild(el('div', { class: 'form-grid' }, [
            el('label', {}, [el('span', {}, ['牌号']), matSel]),
            el('label', {}, [el('span', {}, ['批号']), batch]),
            el('label', {}, [el('span', {}, ['幅宽(mm)']), width]),
            el('label', {}, [el('span', {}, ['冷库库位']), loc]),
            el('label', {}, [el('span', {}, ['长度(m)']), len]),
            el('label', {}, [el('span', {}, ['晾置上限(h)']), lim]),
            el('label', {}, [el('span', {}, ['安全库存(m)']), safe])
          ]));
          body.appendChild(el('div', { class: 'modal-f' }, [
            el('button', { class: 'btn', onclick: close }, ['取消']),
            el('button', {
              class: 'btn primary', onclick: () => {
                if (!batch.value.trim()) { U.toast('请填写批号', true); return; }
                st.rolls.push({
                  id: U.uid('R'), matId: matSel.value, batch: batch.value.trim(),
                  width: +width.value, loc: loc.value.trim() || '冷库',
                  takenAt: null, exposureLimit: +lim.value,
                  lengthM: +len.value, safetyStock: +safe.value
                });
                close(); Store.emit();
              }
            }, ['入库'])
          ]));
        });
      }
    }, ['＋ 新卷入库'])
  ]);
  main.appendChild(headRow);

  const rt = el('table', { class: 'grid' }, [
    el('tr', {}, ['卷号', '牌号', '批号', '幅宽(mm)', '库位', '晾置时长', '晾置上限(h)', '库存(m)', '状态', '操作'].map(h => el('th', {}, [h])))
  ]);
  st.rolls.forEach(rl => {
    const m = Store.mat(rl.matId);
    const s = Store.rollStatus(rl);
    const exp = Store.rollExposure(rl);
    const pct = rl.takenAt ? Math.min(100, exp / rl.exposureLimit * 100) : 0;
    const tr = el('tr', { class: s.key === 'expired' || s.key === 'empty' ? 'row-bad' : (s.key !== 'ok' ? 'row-warn' : '') }, [
      el('td', { class: 'mono' }, [rl.id]),
      el('td', {}, [m ? m.name : rl.matId]),
      el('td', { class: 'mono' }, [rl.batch]),
      el('td', { class: 'num' }, [U.fmt(rl.width, 0)]),
      el('td', {}, [rl.loc]),
      el('td', {}, rl.takenAt ? [
        el('div', { class: 'small' }, [U.fmt(exp, 1) + ' h']),
        el('div', { class: 'bar' }, [el('i', { class: pct >= 100 ? 'over' : pct >= 80 ? 'hot' : '', style: 'width:' + pct + '%' })])
      ] : [el('span', { class: 'muted small' }, ['未出库'])]),
      el('td', { class: 'num' }, [U.fmt(rl.exposureLimit, 0)]),
      el('td', { class: 'num', style: rl.lengthM < rl.safetyStock ? 'color:var(--bad);font-weight:700' : '' },
        [U.fmt(rl.lengthM, 1) + (rl.lengthM < rl.safetyStock ? ' ⚠' : '')]),
      el('td', {}, [el('span', { class: 'badge ' + s.cls }, [s.label])]),
      el('td', {}, [])
    ]);
    const ops = tr.lastChild;
    if (!rl.takenAt && rl.lengthM > 0) {
      ops.appendChild(el('button', {
        class: 'btn sm', onclick: () => { rl.takenAt = Date.now(); Store.emit(); U.toast(rl.id + ' 已出库，开始累计晾置时长'); }
      }, ['出库晾置']));
    }
    if (rl.takenAt && s.key !== 'expired') {
      ops.appendChild(el('button', {
        class: 'btn sm', onclick: () => { rl.takenAt = null; Store.emit(); U.toast(rl.id + ' 已回冷库，晾置计时清零'); }
      }, ['回冷库']));
    }
    rt.appendChild(tr);
  });
  main.appendChild(rt);
  main.appendChild(el('p', { class: 'muted small' },
    ['规则：出库即累计晾置时长，达上限 80% 预警，超期卷在铺层选料中自动锁定不可选；库存随铺层下料自动扣减，低于安全库存标红。']));
};
