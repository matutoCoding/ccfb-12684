/* app.js — 导航路由与全局刷新 */
window.App = (function () {
  const TABS = [
    ['projects', '工程列表'],
    ['materials', '材料库'],
    ['molds', '模具'],
    ['layup', '铺层编辑'],
    ['sim', '仿真结果'],
    ['opt', '铺层优化'],
    ['workshop', '车间作业'],
    ['report', '校验报告']
  ];

  function renderNav() {
    const nav = document.getElementById('nav');
    U.clear(nav);
    const cur = Store.get().ui.tab;
    TABS.forEach(([k, lb]) => {
      nav.appendChild(U.el('button', {
        class: k === cur ? 'active' : '',
        onclick: () => go(k)
      }, [lb]));
    });
  }

  function renderProjectSel() {
    const sel = document.getElementById('curProject');
    const st = Store.get();
    U.clear(sel);
    st.projects.forEach(p => {
      const o = U.el('option', { value: p.id }, [p.code + ' ' + p.name + '（' + p.status + '）']);
      if (p.id === st.ui.curProject) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { st.ui.curProject = sel.value; Store.emit(); };
  }

  function renderMain() {
    const main = document.getElementById('main');
    U.clear(main);
    const tab = Store.get().ui.tab;
    (Pages[tab] || Pages.projects)(main);
  }

  function renderAll() {
    renderNav();
    renderProjectSel();
    renderMain();
  }

  function go(tab) {
    Store.get().ui.tab = tab;
    Store.save();
    renderAll();
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  }

  function init() {
    const h = location.hash.slice(1);
    if (TABS.some(([k]) => k === h)) Store.get().ui.tab = h;
    document.getElementById('btnReset').addEventListener('click', () => {
      U.modal('重置示例数据', (body, close) => {
        body.appendChild(U.el('p', {}, ['将清空全部本地数据并重新生成内置示例（工程/材料/模具/铺层），确定继续？']));
        body.appendChild(U.el('div', { class: 'modal-f' }, [
          U.el('button', { class: 'btn', onclick: close }, ['取消']),
          U.el('button', {
            class: 'btn danger', onclick: () => { close(); Store.reset(); U.toast('已重置为示例数据'); }
          }, ['重置'])
        ]));
      });
    });
    Store.onChange(renderAll);
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { go, refresh: renderAll };
})();
