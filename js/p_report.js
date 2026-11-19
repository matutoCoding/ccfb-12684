/* p_report.js — 校验报告：阈值可改，改动即重算；报告随仿真指纹联动 */
window.Pages = window.Pages || {};
Pages.report = function (main) {
  const st = Store.get();
  const el = U.el;
  const proj = Store.curProject();
  if (!proj) { main.appendChild(el('p', {}, ['请先选择工程。'])); return; }
  const mold = Store.mold(proj.moldId);
  const lp = Store.layupOf(proj.id);
  const th = st.thresholds;

  main.appendChild(el('h2', {}, ['校验报告 — ' + proj.code + ' ' + proj.name]));

  const row = el('div', { class: 'row' });
  main.appendChild(row);
  const left = el('div', { class: 'col', style: 'flex:1.5' });
  const right = el('div', { class: 'col' });
  row.appendChild(left); row.appendChild(right);

  /* ===== 阈值编辑（改动即触发重算） ===== */
  const thCard = el('div', { class: 'card' }, [el('h3', {}, ['校验阈值（修改后报告自动重算）'])]);
  const thDefs = [
    ['warpageMax', '最大翘曲 (mm)'], ['stressMax', '最大残余应力 (MPa)'],
    ['lockAngle', '锁模角 (°)'], ['shearWarnPct', '剪切预警线 (%锁模角)'],
    ['voidMax', '层间空隙率 (%)'], ['ovenTol', '烘箱均匀性公差 (℃)'],
    ['pressureDrop', '保压压降速率 (kPa/min)'], ['holdTime', '保压时长 (min)'],
    ['bagMargin', '辅材余量 (mm)'], ['projTol', '投影轮廓公差 (mm)']
  ];
  const tg = el('div', { class: 'form-grid' });
  thDefs.forEach(([k, lb]) => {
    const inp = el('input', { type: 'number', step: 'any', value: th[k] });
    inp.addEventListener('change', () => {
      th[k] = +inp.value;
      Store.emit(); // 报告随阈值重算
      U.toast('阈值已更新，报告已重算');
    });
    tg.appendChild(el('label', {}, [el('span', {}, [lb]), inp]));
  });
  thCard.appendChild(tg);
  right.appendChild(thCard);

  /* ===== 报告正文 ===== */
  const repCard = el('div', { class: 'card' });
  left.appendChild(repCard);

  if (!lp.plies.length) {
    repCard.appendChild(el('p', { class: 'muted' }, ['当前工程无铺层，无法生成报告。']));
    return;
  }

  const sim = SIM.run(proj, lp, mold, st.mats, th);

  /* 逐条校验 */
  const checks = [];
  function check(name, value, unit, limit, pass, note) {
    checks.push({ name, value, unit, limit, pass, note });
  }
  check('最大翘曲变形', Math.abs(sim.maxDefl.w), 'mm', '≤ ' + th.warpageMax, Math.abs(sim.maxDefl.w) <= th.warpageMax,
    '位置 x=' + U.fmt(sim.maxDefl.x, 0) + ', y=' + U.fmt(sim.maxDefl.y, 0));
  check('最大残余应力(VM)', sim.maxVM, 'MPa', '≤ ' + th.stressMax, sim.maxVM <= th.stressMax,
    '第 ' + (sim.maxVMLayer + 1) + ' 层');
  const shearWarn = th.lockAngle * th.shearWarnPct / 100;
  check('最大剪切角', sim.maxShear, '°', '≤ ' + U.fmt(shearWarn, 1) + '（锁模角' + th.lockAngle + '°）', sim.maxShear <= shearWarn,
    sim.maxShearAt ? 'u=' + U.fmt(sim.maxShearAt.u, 2) + ', v=' + U.fmt(sim.maxShearAt.v, 2) : '');
  const maxVoid = Math.max.apply(null, sim.voids.concat([0]));
  check('最大层间空隙率', maxVoid, '%', '≤ ' + th.voidMax, maxVoid <= th.voidMax,
    '辊压 ' + (lp.rollerPressure || 300) + ' kPa');
  check('固化温差超限时段', sim.exceed.length, '段', '= 0', sim.exceed.length === 0,
    sim.exceed.length ? '最长 ' + sim.exceed.map(e => e.t0 + '~' + e.t1 + 'min').join('，') : '全程在公差带内');
  // 铺层越界
  const outOfBd = lp.plies.filter(p => !GEO.rectInBoundary(mold, p.cov)).length;
  check('铺层边界检查', outOfBd, '层越界', '= 0', outOfBd === 0, outOfBd ? '存在边界外落层' : '全部在铺贴边界内');
  // 超期料卷
  const badRolls = lp.plies.filter(p => p.rollId && !Store.rollUsable(Store.roll(p.rollId))).length;
  check('料卷有效性', badRolls, '层用超期卷', '= 0', badRolls === 0, badRolls ? '存在超期/用尽料卷' : '全部料卷可用');
  // 安全库存
  const lowRolls = st.rolls.filter(r => r.lengthM > 0 && r.lengthM < r.safetyStock).length;
  check('库存安全', lowRolls, '卷低于安全库存', '预警项', true, lowRolls ? lowRolls + ' 卷需补料（预警，不判不合格）' : '库存正常');
  // 投影校准
  const dev = lp.projCalib ? lp.projCalib.deviation : 0;
  check('激光投影偏差', dev, 'mm', '≤ ' + th.projTol, dev <= th.projTol, lp.projCalib ? '最近校准 ' + lp.projCalib.calibratedAt : '未校准');
  // 检漏
  const lastLeak = (proj.leakRecords || [])[proj.leakRecords.length - 1];
  check('真空检漏', lastLeak ? lastLeak.rate : null, 'kPa/min', '≤ ' + th.pressureDrop,
    lastLeak ? lastLeak.pass : true, lastLeak ? (lastLeak.pass ? '合格' : '超差') + ' @ ' + lastLeak.t : '未检漏（提示项）');

  const allPass = checks.every(c => c.pass);

  repCard.appendChild(el('div', { class: 'inline', style: 'justify-content:space-between' }, [
    el('div', {}, [
      el('div', { style: 'font-size:16px;font-weight:700' }, [
        '校验结论：', el('span', { class: allPass ? 'pass' : 'fail' }, [allPass ? '✓ 全部通过' : '✗ 存在不合格项'])
      ]),
      el('div', { class: 'muted small' }, [
        '仿真指纹 ', el('span', { class: 'mono' }, ['#' + sim.key]),
        ' · 生成时间 ' + U.nowStr() + ' · 阈值版本即当前阈值，改动即时重算'
      ])
    ]),
    el('button', {
      class: 'btn sm', onclick: () => {
        const rep = {
          project: proj.code, name: proj.name, fingerprint: sim.key, time: U.nowStr(),
          thresholds: JSON.parse(JSON.stringify(th)),
          checks: checks.map(c => ({ name: c.name, value: c.value, unit: c.unit, limit: c.limit, pass: c.pass, note: c.note })),
          conclusion: allPass ? 'PASS' : 'FAIL'
        };
        U.download(proj.code + '_校验报告_' + sim.key + '.json', JSON.stringify(rep, null, 2), 'application/json');
      }
    }, ['导出报告(JSON)'])
  ]));

  const t = el('table', { class: 'grid', style: 'margin-top:10px' }, [
    el('tr', {}, ['校验项', '数值', '单位', '阈值', '结论', '说明'].map(h => el('th', {}, [h])))
  ]);
  checks.forEach(c => t.appendChild(el('tr', { class: c.pass ? '' : 'row-bad' }, [
    el('td', {}, [c.name]),
    el('td', { class: 'num' }, [c.value === null ? '—' : U.fmt(c.value, 2)]),
    el('td', {}, [c.unit]),
    el('td', { class: 'small' }, [c.limit]),
    el('td', {}, [el('span', { class: 'badge ' + (c.pass ? 'ok' : 'bad') }, [c.pass ? '通过' : '不合格'])]),
    el('td', { class: 'small muted' }, [c.note || ''])
  ])));
  repCard.appendChild(t);

  /* 铺层摘要 */
  right.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, ['铺层摘要']),
    el('div', { class: 'kv' }, [
      el('b', {}, ['层数']), el('span', {}, [String(lp.plies.length)]),
      el('b', {}, ['角度序列']), el('span', { class: 'mono small' }, [lp.plies.map(p => p.angle).join(' / ')]),
      el('b', {}, ['估算净重']), el('span', {}, [U.fmt(sim.weight, 0) + ' g']),
      el('b', {}, ['累计厚度']), el('span', {}, [U.fmt(sim.clt.totalThk, 2) + ' mm']),
      el('b', {}, ['工程状态']), el('span', {}, [proj.status]),
      el('b', {}, ['模具']), el('span', {}, [mold.name])
    ])
  ]));
};
