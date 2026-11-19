/* 核心引擎 Node 冒烟测试：确定性、CLT 合理性、几何与仿真链路 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  console,
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  Date, Math, JSON, Infinity, NaN, performance: { now: () => 0 }
};
sandbox.window = sandbox; // 浏览器中 window 即全局对象
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['util.js', 'clt.js', 'geometry.js', 'simengine.js', 'store.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

const { U, CLT, GEO, SIM, Store } = sandbox.window;
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } }

console.log('== 1. 确定性 ==');
const st = Store.get();
const proj = st.projects[0], lp = st.layups[proj.id], mold = Store.mold(proj.moldId);
const r1 = SIM.run(proj, lp, mold, st.mats, st.thresholds);
const r2 = SIM.run(proj, lp, mold, st.mats, st.thresholds);
ok(r1.key === r2.key, '同一铺层指纹一致 #' + r1.key);
ok(r1.maxDefl.w === r2.maxDefl.w, '最大变形量逐位一致: ' + r1.maxDefl.w);
ok(JSON.stringify(r1.tcs) === JSON.stringify(r2.tcs), '温度曲线一致');
const m1 = SIM.measuredCurve(proj.code), m2 = SIM.measuredCurve(proj.code);
ok(JSON.stringify(m1) === JSON.stringify(m2), '实测曲线重复导入一致');
// 改一个角度 → 指纹必须变
const lp2 = JSON.parse(JSON.stringify(lp)); lp2.plies[0].angle = 45;
const r3 = SIM.run(proj, lp2, mold, st.mats, st.thresholds);
ok(r3.key !== r1.key, '改铺层角度后指纹变化');
ok(r3.maxDefl.w !== r1.maxDefl.w, '改铺层角度后变形量变化');

console.log('== 2. CLT 物理合理性 ==');
const mat = st.mats[0];
const sym = CLT.analyze([0, 90, 90, 0].map(a => ({ angle: a, mat, cov: 1 })), -155);
ok(Math.abs(sym.kappa[2]) < 1e-8, '对称均衡铺层扭转曲率≈0: ' + sym.kappa[2].toExponential(2));
const asym = CLT.analyze([0, 0, 45].map(a => ({ angle: a, mat, cov: 1 })), -155);
ok(Math.abs(asym.kappa[0]) > Math.abs(sym.kappa[0]), '非对称铺层翘曲大于对称铺层');
ok(sym.maxVM > 0 && isFinite(sym.maxVM), '残余应力有限正值: ' + sym.maxVM.toFixed(1) + ' MPa');
const zero = CLT.analyze([0, 90, 90, 0].map(a => ({ angle: a, mat, cov: 1 })), 0);
ok(zero.maxVM < 1e-6, 'ΔT=0 时残余应力≈0');

console.log('== 3. 几何 ==');
const mesh = GEO.mesh(mold);
ok(mesh.pts.every(p => p.every(isFinite)), '型面网格坐标有限');
ok(mesh.nrm.every(n => Math.abs(GEO.len(n) - 1) < 1e-6), '法向单位化');
const shear = GEO.shearField(mold);
ok(shear.every(r => r.every(isFinite)), '剪切角场有限');
const off = GEO.offsetMesh(mold, lp, id => Store.mat(id));
ok(off.pts.every(p => p.every(isFinite)), '偏置面坐标有限');
ok(GEO.inBoundary(mold, 0.5, 0.5) === true, '边界内点判定');
ok(GEO.inBoundary(mold, 0.01, 0.01) === false, '边界外点判定');
const sl = GEO.streamlines(mold, 45);
ok(sl.length > 0 && sl[0].length > 1, '纤维流线生成');
const grid = GEO.fiberGrid(mold, lp.plies[0].cov, lp.darts, 1);
ok(grid.length > 0, '纤维网格生成（含剪口断开）');

console.log('== 4. 仿真结果完备性 ==');
ok(r1.tcs.length === lp.thermocouples.length, '热电偶曲线数量匹配');
ok(r1.hot && r1.cold && r1.hot.T >= r1.cold.T, '最高/最低温点存在');
ok(r1.voids.length === lp.plies.length, '逐层空隙率数量匹配');
ok(isFinite(r1.weight) && r1.weight > 0, '重量为正: ' + r1.weight.toFixed(0) + ' g');
ok(Array.isArray(r1.exceed), '温差超限时段列表存在');
const sc = GEO.prescale(mold, 2.5e-6, 180, 25);
ok(sc > 0.99 && sc < 1.01, '热膨胀预缩放系数合理: ' + sc.toFixed(6));

console.log('== 5. 工程状态机 ==');
const stt = Store.get();
const p4 = stt.projects.find(p => p.status === '已归档');
ok(!Store.layupEditable(p4), '归档工程铺层锁定');
Store.unlockWithChangeOrder(p4.id, '测试变更');
ok(Store.layupEditable(p4), '变更单解锁后可编辑');
ok(p4.changeOrders.length === 1, '变更单已登记');
const chain = Store.parentChain(Store.project('PRJ-1002'));
ok(chain.length === 1 && chain[0].id === 'PRJ-1001', '派生链可回溯到父工程');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
