/* 页面级 DOM 冒烟测试：jsdom 加载全部脚本，逐页渲染，捕捉运行时报错 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// canvas 2D 上下文桩（jsdom 无真实画布）
window.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      return t[k] !== undefined ? t[k] : noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
};
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', { get() { return 800; } });

const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));

// 按 index.html 顺序加载脚本
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
for (const s of scripts) {
  const code = fs.readFileSync(path.join(__dirname, '..', s), 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    errors.push('加载 ' + s + ' 失败: ' + e.message);
  }
}

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

// 触发初始化
try {
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
} catch (e) { errors.push('init: ' + e.message); }

const tabs = ['projects', 'materials', 'molds', 'layup', 'sim', 'opt', 'workshop', 'report'];
console.log('== 页面渲染 ==');
for (const t of tabs) {
  try {
    window.App.go(t);
    const main = window.document.getElementById('main');
    ok(main.children.length > 0, '页面 ' + t + ' 渲染出内容（' + main.children.length + ' 个节点）');
  } catch (e) {
    fail++; console.log('  ✗ FAIL: 页面 ' + t + ' 渲染异常:', e.message);
  }
}

console.log('== 交互链路 ==');
try {
  // 切换工程 → 铺层页应随之变化
  const st = window.Store.get();
  st.ui.curProject = 'PRJ-1005';
  window.Store.emit();
  window.App.go('layup');
  ok(window.document.getElementById('main').textContent.includes('PRJ-1005'), '切换工程后铺层页联动');
} catch (e) { fail++; console.log('  ✗ FAIL: 工程切换:', e.message); }

try {
  // 阈值修改 → 报告重算（不抛错且包含校验结论）
  window.App.go('report');
  const st2 = window.Store.get();
  st2.thresholds.warpageMax = 0.5; // 收紧阈值
  window.Store.emit();
  window.App.go('report');
  const txt = window.document.getElementById('main').textContent;
  ok(txt.includes('校验结论'), '阈值修改后报告重算');
  ok(txt.includes('不合格') || txt.includes('全部通过'), '报告含结论项');
} catch (e) { fail++; console.log('  ✗ FAIL: 阈值重算:', e.message); }

try {
  // 状态流转：提交评审（带处理意见）
  const st3 = window.Store.get();
  const p = st3.projects.find(x => x.id === 'PRJ-1001');
  window.Store.transition(p.id, '待评审', '测试流转');
  ok(p.status === '待评审' && p.history[p.history.length - 1].opinion === '测试流转', '工程流转并记录处理意见');
} catch (e) { fail++; console.log('  ✗ FAIL: 状态流转:', e.message); }

try {
  // 优化页跑一小段
  const st4 = window.Store.get();
  st4.ui.curProject = 'PRJ-1001';
  window.Store.emit();
  window.App.go('opt');
  ok(true, '优化页打开');
} catch (e) { fail++; console.log('  ✗ FAIL: 优化页:', e.message); }

console.log('== 子页签 ==');
try {
  const st5 = window.Store.get();
  st5.ui.layupTab = 'drape';
  window.Store.emit();
  window.App.go('layup');
  ok(window.document.getElementById('main').textContent.includes('剪切角'), '铺覆模拟页渲染');
} catch (e) { fail++; console.log('  ✗ FAIL: 铺覆模拟:', e.message); }
for (const ws of ['proj', 'bag', 'vac', 'wo']) {
  try {
    window.Store.get().ui.wsTab = ws;
    window.Store.emit();
    window.App.go('workshop');
    ok(true, '车间子页 ' + ws + ' 渲染');
  } catch (e) { fail++; console.log('  ✗ FAIL: 车间子页 ' + ws + ':', e.message); }
}
for (const sm of ['warp', 'stress', 'thermal']) {
  try {
    window.Store.get().ui.simTab = sm;
    window.Store.emit();
    window.App.go('sim');
    ok(true, '仿真子页 ' + sm + ' 渲染');
  } catch (e) { fail++; console.log('  ✗ FAIL: 仿真子页 ' + sm + ':', e.message); }
}

if (errors.length) {
  console.log('\n脚本错误:');
  errors.forEach(e => { console.log('  ✗', e); fail++; });
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
