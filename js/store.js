/* store.js — 应用状态、持久化、示例数据（全部程序生成，不依赖外部资源） */
window.Store = (function () {
  const KEY = 'clms_state_v1';
  let state = null;
  const listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function emit() { save(); listeners.forEach(f => f()); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
    if (!state || state.ver !== 1) state = demo();
  }
  function reset() { state = demo(); SIM.clearCache(); emit(); }
  function get() { return state; }

  /* ===== 查询助手 ===== */
  const project = id => state.projects.find(p => p.id === id);
  const mold = id => state.molds.find(m => m.id === id);
  const mat = id => state.mats.find(m => m.id === id);
  const roll = id => state.rolls.find(r => r.id === id);
  const layupOf = pid => state.layups[pid];
  function curProject() { return project(state.ui.curProject) || state.projects[0]; }

  /* ===== 材料卷状态 ===== */
  function rollExposure(rl) { return rl.takenAt ? U.hoursSince(rl.takenAt) : 0; }
  function rollStatus(rl) {
    if (rl.lengthM <= 0) return { key: 'empty', label: '已用完', cls: 'bad' };
    const e = rollExposure(rl);
    if (rl.takenAt && e >= rl.exposureLimit) return { key: 'expired', label: '超期锁定', cls: 'bad' };
    if (rl.takenAt && e >= rl.exposureLimit * 0.8) return { key: 'near', label: '临近晾置上限', cls: 'warn' };
    if (rl.lengthM < rl.safetyStock) return { key: 'low', label: '低于安全库存', cls: 'warn' };
    return { key: 'ok', label: rl.takenAt ? '晾置中' : '冷库在库', cls: 'ok' };
  }
  const rollUsable = rl => ['ok', 'near', 'low'].includes(rollStatus(rl).key) && rl.lengthM > 0;

  /* ===== 工程状态机 ===== */
  const FLOW = {
    '在制': [{ to: '待评审', label: '提交评审' }],
    '待评审': [{ to: '已归档', label: '评审通过·归档' }, { to: '在制', label: '退回修改' }],
    '已归档': []
  };
  function transition(pid, to, opinion) {
    const p = project(pid);
    p.history.push({ t: U.nowStr(), from: p.status, to, opinion, user: '当前用户' });
    p.status = to;
    if (to === '已归档') p.unlocked = false; // 归档即锁死
    emit();
  }
  const layupEditable = p => p.status !== '已归档' || !!p.unlocked;
  function unlockWithChangeOrder(pid, reason) {
    const p = project(pid);
    const co = { id: U.uid('CO'), t: U.nowStr(), reason, user: '当前用户' };
    p.changeOrders.push(co);
    p.unlocked = true;
    p.history.push({ t: U.nowStr(), from: '已归档', to: '已归档', opinion: '变更单解锁：' + reason, user: '当前用户' });
    emit();
    return co;
  }
  function deriveProject(baseId, name) {
    const b = project(baseId);
    const id = U.uid('PRJ');
    const code = b.code + '-D' + (state.projects.filter(x => x.parentId === baseId).length + 1);
    const np = {
      id, code, name: name || (b.name + ' 派生件'), series: b.series, moldId: b.moldId,
      status: '在制', parentId: baseId, createdAt: U.nowStr(), unlocked: false,
      history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '由 ' + b.code + ' 派生', user: '当前用户' }],
      changeOrders: [], leakRecords: []
    };
    state.projects.push(np);
    // 铺层方案继承父工程（深拷贝）
    state.layups[id] = JSON.parse(JSON.stringify(state.layups[baseId]));
    emit();
    return np;
  }
  function parentChain(p) {
    const chain = [];
    let cur = p;
    while (cur && cur.parentId) { cur = project(cur.parentId); if (cur) chain.push(cur); }
    return chain;
  }

  /* ===== 下料扣减 ===== */
  function consumeRoll(plyId, pid) {
    const lp = layupOf(pid), ply = lp.plies.find(x => x.id === plyId);
    if (!ply || !ply.rollId || ply.consumed) return;
    const rl = roll(ply.rollId), m = mat(ply.matId);
    const S = GEO.surf(mold(project(pid).moldId).surfaceKey);
    const areaM2 = (S.Lx / 1000) * (S.Ly / 1000) * (ply.cov.u1 - ply.cov.u0) * (ply.cov.v1 - ply.cov.v0);
    const used = areaM2 / (rl.width / 1000) * 1.08; // 8% 损耗
    rl.lengthM = Math.max(0, Math.round((rl.lengthM - used) * 100) / 100);
    ply.consumed = true;
    emit();
  }

  /* ===== 示例数据 ===== */
  function demo() {
    const H = 3600000, now = Date.now();
    const mats = [
      { id: 'M-UD150', name: 'T300/环氧 单向预浸料 150g', type: '单向带', E1: 135000, E2: 9800, nu12: 0.28, G12: 4600, alpha1: 0.2e-6, alpha2: 32e-6, t: 0.15, areal: 150, cureT: 180 },
      { id: 'M-UD200', name: 'T700/环氧 单向预浸料 200g', type: '单向带', E1: 140000, E2: 10300, nu12: 0.29, G12: 5000, alpha1: 0.3e-6, alpha2: 30e-6, t: 0.2, areal: 200, cureT: 180 },
      { id: 'M-PW300', name: 'T700/环氧 平纹织物 300g', type: '织物', E1: 62000, E2: 62000, nu12: 0.06, G12: 4200, alpha1: 3e-6, alpha2: 3e-6, t: 0.28, areal: 300, cureT: 180 },
      { id: 'M-HM180', name: 'M40J 高模单向 180g', type: '单向带', E1: 200000, E2: 9000, nu12: 0.3, G12: 4300, alpha1: -0.5e-6, alpha2: 34e-6, t: 0.18, areal: 180, cureT: 180 }
    ];
    const rolls = [
      { id: 'R-2601', matId: 'M-UD150', batch: 'PC2603-A', width: 1000, loc: '冷库A-01', takenAt: now - 40 * H, exposureLimit: 240, lengthM: 62, safetyStock: 20 },
      { id: 'R-2602', matId: 'M-UD150', batch: 'PC2603-B', width: 1000, loc: '冷库A-02', takenAt: now - 205 * H, exposureLimit: 240, lengthM: 45, safetyStock: 20 },
      { id: 'R-2603', matId: 'M-UD150', batch: 'PC2511-C', width: 1000, loc: '冷库A-03', takenAt: now - 260 * H, exposureLimit: 240, lengthM: 30, safetyStock: 20 },
      { id: 'R-2604', matId: 'M-UD200', batch: 'PC2605-A', width: 1000, loc: '冷库A-04', takenAt: null, exposureLimit: 240, lengthM: 80, safetyStock: 20 },
      { id: 'R-2605', matId: 'M-UD200', batch: 'PC2605-B', width: 1000, loc: '冷库B-01', takenAt: now - 12 * H, exposureLimit: 240, lengthM: 14, safetyStock: 20 },
      { id: 'R-2606', matId: 'M-PW300', batch: 'PC2602-A', width: 1200, loc: '冷库B-02', takenAt: now - 90 * H, exposureLimit: 336, lengthM: 55, safetyStock: 15 },
      { id: 'R-2607', matId: 'M-PW300', batch: 'PC2602-B', width: 1200, loc: '冷库B-03', takenAt: null, exposureLimit: 336, lengthM: 70, safetyStock: 15 },
      { id: 'R-2608', matId: 'M-HM180', batch: 'PC2606-A', width: 600, loc: '冷库C-01', takenAt: now - 100 * H, exposureLimit: 168, lengthM: 25, safetyStock: 10 }
    ];
    const molds = [
      { id: 'MD-ARM', name: '机臂成型模（X4系列）', surfaceKey: 'arm', material: '6061铝', cte: 23e-6, cureT: 180,
        boundary: [[0.04, 0.08], [0.96, 0.08], [0.96, 0.92], [0.04, 0.92]], manualComp: {} },
      { id: 'MD-WING', name: '尾翼扰流板模', surfaceKey: 'wing', material: '殷钢4J36', cte: 1.5e-6, cureT: 180,
        boundary: [[0.05, 0.1], [0.95, 0.1], [0.95, 0.9], [0.05, 0.9]], manualComp: {} },
      { id: 'MD-PLATE', name: '校验平模板', surfaceKey: 'plate', material: '45#钢', cte: 11e-6, cureT: 180,
        boundary: [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]], manualComp: {} },
      { id: 'MD-COWL', name: '机头整流罩模', surfaceKey: 'cowl', material: '殷钢4J36', cte: 1.5e-6, cureT: 180,
        boundary: [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]], manualComp: {} }
    ];
    function mkPly(matId, angle, cov, rollId) {
      return { id: U.uid('PLY'), matId, angle, cov: cov || { u0: 0.06, v0: 0.1, u1: 0.94, v1: 0.9 }, rollId: rollId || null, consumed: false };
    }
    const seq = [0, 45, -45, 90, 0, -45, 45, 0]; // 非对称序列，固化翘曲可见
    const projects = [
      { id: 'PRJ-1001', code: 'PRJ-1001', name: 'X4 无人机机臂（基础件）', series: 'X4机臂', moldId: 'MD-ARM',
        status: '在制', parentId: null, createdAt: U.nowStr(), unlocked: false, changeOrders: [], leakRecords: [],
        history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '新建工程', user: '系统' }] },
      { id: 'PRJ-1002', code: 'PRJ-1002', name: 'X4 机臂短轴型', series: 'X4机臂', moldId: 'MD-ARM',
        status: '在制', parentId: 'PRJ-1001', createdAt: U.nowStr(), unlocked: false, changeOrders: [], leakRecords: [],
        history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '由 PRJ-1001 派生', user: '系统' }] },
      { id: 'PRJ-1003', code: 'PRJ-1003', name: '汽车尾翼扰流板', series: '尾翼', moldId: 'MD-WING',
        status: '待评审', parentId: null, createdAt: U.nowStr(), unlocked: false, changeOrders: [], leakRecords: [],
        history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '新建工程', user: '系统' },
                  { t: U.nowStr(), from: '在制', to: '待评审', opinion: '铺层完成，提交评审', user: '系统' }] },
      { id: 'PRJ-1004', code: 'PRJ-1004', name: '层合板校验件', series: '校验件', moldId: 'MD-PLATE',
        status: '已归档', parentId: null, createdAt: U.nowStr(), unlocked: false, changeOrders: [], leakRecords: [],
        history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '新建工程', user: '系统' },
                  { t: U.nowStr(), from: '在制', to: '待评审', opinion: '提交评审', user: '系统' },
                  { t: U.nowStr(), from: '待评审', to: '已归档', opinion: '评审通过，归档', user: '系统' }] },
      { id: 'PRJ-1005', code: 'PRJ-1005', name: 'X4 机头整流罩', series: 'X4机体', moldId: 'MD-COWL',
        status: '在制', parentId: null, createdAt: U.nowStr(), unlocked: false, changeOrders: [], leakRecords: [],
        history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '新建工程', user: '系统' }] }
    ];
    const layups = {};
    layups['PRJ-1001'] = {
      plies: seq.map((a, i) => mkPly(i % 3 === 2 ? 'M-PW300' : 'M-UD150', a)),
      darts: [{ id: 'DT-1', u: 0.5, v: 0.1, angle: 90, depth: 0.12 }],
      clamps: [{ id: 'CL-1', u: 0.1, v: 0.15, seq: 1 }, { id: 'CL-2', u: 0.9, v: 0.15, seq: 2 },
               { id: 'CL-3', u: 0.9, v: 0.85, seq: 3 }, { id: 'CL-4', u: 0.1, v: 0.85, seq: 4 }],
      thermocouples: [
        { id: 'TC1', name: 'TC1-前缘', u: 0.08, v: 0.5 }, { id: 'TC2', name: 'TC2-后缘', u: 0.92, v: 0.5 },
        { id: 'TC3', name: 'TC3-中部', u: 0.5, v: 0.5 }, { id: 'TC4', name: 'TC4-上弦', u: 0.5, v: 0.12 },
        { id: 'TC5', name: 'TC5-下弦', u: 0.5, v: 0.88 }, { id: 'TC6', name: 'TC6-四分之一', u: 0.3, v: 0.3 }],
      rollerPressure: 320, importedMeasured: null
    };
    layups['PRJ-1002'] = JSON.parse(JSON.stringify(layups['PRJ-1001']));
    layups['PRJ-1002'].plies.forEach(p => { p.id = U.uid('PLY'); p.cov = { u0: 0.1, v0: 0.12, u1: 0.9, v1: 0.88 }; });
    layups['PRJ-1003'] = {
      plies: [0, 45, -45, 0, 90, 90, 0, -45, 45].map((a, i) => mkPly(i === 4 ? 'M-HM180' : (i % 2 ? 'M-UD200' : 'M-PW300'), a, { u0: 0.06, v0: 0.12, u1: 0.94, v1: 0.88 })),
      darts: [{ id: 'DT-1', u: 0.2, v: 0.12, angle: 45, depth: 0.1 }, { id: 'DT-2', u: 0.8, v: 0.12, angle: -45, depth: 0.1 }],
      clamps: [{ id: 'CL-1', u: 0.5, v: 0.15, seq: 1 }, { id: 'CL-2', u: 0.1, v: 0.5, seq: 2 }, { id: 'CL-3', u: 0.9, v: 0.5, seq: 3 }],
      thermocouples: [
        { id: 'TC1', name: 'TC1-左梢', u: 0.08, v: 0.5 }, { id: 'TC2', name: 'TC2-右梢', u: 0.92, v: 0.5 },
        { id: 'TC3', name: 'TC3-中', u: 0.5, v: 0.5 }, { id: 'TC4', name: 'TC4-前', u: 0.5, v: 0.15 }],
      rollerPressure: 280, importedMeasured: null
    };
    layups['PRJ-1004'] = {
      plies: [0, 90, 45, -45, -45, 45, 90, 0].map(a => mkPly('M-UD150', a, { u0: 0.08, v0: 0.08, u1: 0.92, v1: 0.92 })),
      darts: [], clamps: [],
      thermocouples: [{ id: 'TC1', name: 'TC1', u: 0.2, v: 0.2 }, { id: 'TC2', name: 'TC2', u: 0.8, v: 0.8 }, { id: 'TC3', name: 'TC3', u: 0.5, v: 0.5 }],
      rollerPressure: 300, importedMeasured: null
    };
    layups['PRJ-1005'] = {
      plies: [0, 45, -45, 90, 0, 45].map((a, i) => mkPly(i % 2 ? 'M-PW300' : 'M-UD150', a, { u0: 0.08, v0: 0.08, u1: 0.92, v1: 0.92 })),
      darts: [{ id: 'DT-1', u: 0.5, v: 0.08, angle: 90, depth: 0.15 }, { id: 'DT-2', u: 0.08, v: 0.5, angle: 0, depth: 0.15 }],
      clamps: [{ id: 'CL-1', u: 0.5, v: 0.5, seq: 1 }, { id: 'CL-2', u: 0.2, v: 0.2, seq: 2 }, { id: 'CL-3', u: 0.8, v: 0.8, seq: 3 }],
      thermocouples: [
        { id: 'TC1', name: 'TC1-罩顶', u: 0.5, v: 0.5 }, { id: 'TC2', name: 'TC2-前缘', u: 0.1, v: 0.5 },
        { id: 'TC3', name: 'TC3-侧缘', u: 0.5, v: 0.1 }, { id: 'TC4', name: 'TC4-角部', u: 0.15, v: 0.15 }],
      rollerPressure: 260, importedMeasured: null
    };

    return {
      ver: 1,
      ui: { tab: 'projects', curProject: 'PRJ-1001' },
      mats, rolls, molds, projects, layups,
      thresholds: {
        warpageMax: 2.0,      // 最大翘曲 mm
        stressMax: 400,       // 最大残余应力 MPa
        lockAngle: 55,        // 锁模角 °
        shearWarnPct: 85,     // 预警 = 锁模角的百分比
        voidMax: 2.0,         // 空隙率 %
        ovenTol: 5,           // 烘箱均匀性公差 ℃
        pressureDrop: 0.5,    // 保压压降速率 kPa/min
        holdTime: 30,         // 保压时长 min
        bagMargin: 50,        // 真空袋辅材余量 mm
        projTol: 0.8          // 激光投影轮廓偏差 mm
      }
    };
  }

  load();
  return { get, emit, onChange, reset, save, project, mold, mat, roll, layupOf, curProject,
    rollExposure, rollStatus, rollUsable, FLOW, transition, layupEditable,
    unlockWithChangeOrder, deriveProject, parentChain, consumeRoll };
})();
