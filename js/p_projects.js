/* p_projects.js — 工程列表：状态流转（必填处理意见）、派生、变更单解锁、谱系追溯 */
window.Pages = window.Pages || {};
Pages.projects = function (main) {
  const st = Store.get();
  const el = U.el;

  main.appendChild(el('h2', {}, ['工程列表']));

  /* 新建工程 */
  const bar = el('div', { class: 'inline', style: 'margin-bottom:12px' }, [
    el('button', {
      class: 'btn primary', onclick: () => {
        U.modal('新建工程', (body, close) => {
          const name = el('input', { placeholder: '工程名称，如 X5 机臂' });
          const series = el('input', { placeholder: '系列，如 X5机臂' });
          const moldSel = el('select', {}, st.molds.map(m => el('option', { value: m.id }, [m.name])));
          body.appendChild(el('div', { class: 'form-grid' }, [
            el('label', {}, [el('span', {}, ['工程名称']), name]),
            el('label', {}, [el('span', {}, ['系列']), series]),
            el('label', {}, [el('span', {}, ['模具']), moldSel])
          ]));
          body.appendChild(el('div', { class: 'modal-f' }, [
            el('button', { class: 'btn', onclick: close }, ['取消']),
            el('button', {
              class: 'btn primary', onclick: () => {
                if (!name.value.trim()) { U.toast('请填写工程名称', true); return; }
                const id = U.uid('PRJ');
                const code = 'PRJ-' + (1000 + st.projects.length + 1);
                st.projects.push({
                  id, code, name: name.value.trim(), series: series.value.trim() || '未分组',
                  moldId: moldSel.value, status: '在制', parentId: null, createdAt: U.nowStr(),
                  unlocked: false, changeOrders: [], leakRecords: [],
                  history: [{ t: U.nowStr(), from: '-', to: '在制', opinion: '新建工程', user: '当前用户' }]
                });
                st.layups[id] = { plies: [], darts: [], clamps: [], thermocouples: [], rollerPressure: 300, importedMeasured: null };
                st.ui.curProject = id;
                close(); Store.emit();
              }
            }, ['创建'])
          ]));
        });
      }
    }, ['＋ 新建工程'])
  ]);
  main.appendChild(bar);

  /* 状态筛选 */
  const filter = { v: '全部' };
  const tabs = el('div', { class: 'tabs' });
  const tblWrap = el('div');
  ['全部', '在制', '待评审', '已归档'].forEach(s => {
    tabs.appendChild(el('button', {
      class: s === '全部' ? 'active' : '',
      onclick: e => {
        filter.v = s;
        tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderTable();
      }
    }, [s]));
  });
  main.appendChild(tabs);
  main.appendChild(tblWrap);

  function statusBadge(s) {
    const cls = s === '在制' ? 's-doing' : s === '待评审' ? 's-review' : 's-arch';
    return el('span', { class: 'badge ' + cls }, [s + (s === '已归档' ? '🔒' : '')]);
  }

  function renderTable() {
    U.clear(tblWrap);
    const list = st.projects.filter(p => filter.v === '全部' || p.status === filter.v);
    const tbl = el('table', { class: 'grid' }, [
      el('tr', {}, ['编号', '名称', '系列', '模具', '状态', '铺层数', '派生自', '操作'].map(h => el('th', {}, [h])))
    ]);
    list.forEach(p => {
      const lp = st.layups[p.id] || { plies: [] };
      const parent = p.parentId ? Store.project(p.parentId) : null;
      const tr = el('tr', {}, [
        el('td', { class: 'mono' }, [p.code]),
        el('td', {}, [p.name, p.unlocked ? el('span', { class: 'badge warn', style: 'margin-left:6px' }, ['变更单解锁中']) : null]),
        el('td', {}, [p.series]),
        el('td', {}, [(Store.mold(p.moldId) || {}).name || '—']),
        el('td', {}, [statusBadge(p.status)]),
        el('td', { class: 'num' }, [String(lp.plies.length)]),
        el('td', {}, parent ? [el('a', { href: '#', onclick: e => { e.preventDefault(); showChain(p); } }, [parent.code])] : ['—']),
        el('td', {}, [])
      ]);
      const ops = tr.lastChild;
      ops.appendChild(el('button', {
        class: 'btn sm', onclick: () => { st.ui.curProject = p.id; Store.emit(); App.go('layup'); }
      }, ['打开']));
      // 状态流转按钮
      (Store.FLOW[p.status] || []).forEach(f => {
        ops.appendChild(el('button', {
          class: 'btn sm', style: 'margin-left:4px',
          onclick: () => U.opinionModal(`${p.code} ${f.label}`, '请填写处理意见（必填）', op => {
            Store.transition(p.id, f.to, op);
            U.toast(`${p.code} 已流转：${f.to}`);
          })
        }, [f.label]));
      });
      if (p.status === '已归档' && !p.unlocked) {
        ops.appendChild(el('button', {
          class: 'btn sm warn', style: 'margin-left:4px',
          onclick: () => U.opinionModal(`${p.code} 登记变更单解锁`, '请填写变更原因（将登记变更单）', reason => {
            const co = Store.unlockWithChangeOrder(p.id, reason);
            U.toast('变更单 ' + co.id + ' 已登记，铺层已解锁');
          })
        }, ['变更单解锁']));
      }
      ops.appendChild(el('button', {
        class: 'btn sm', style: 'margin-left:4px',
        onclick: () => U.modal('派生新工程（基于 ' + p.code + '）', (body, close) => {
          const nm = el('input', { value: p.name + ' 派生件' });
          body.appendChild(el('label', {}, ['新工程名称', nm]));
          body.appendChild(el('p', { class: 'muted small' }, ['派生工程继承父工程铺层方案，状态为"在制"，谱系关系可追溯。']));
          body.appendChild(el('div', { class: 'modal-f' }, [
            el('button', { class: 'btn', onclick: close }, ['取消']),
            el('button', {
              class: 'btn primary', onclick: () => {
                const np = Store.deriveProject(p.id, nm.value.trim());
                close(); U.toast('已派生 ' + np.code);
              }
            }, ['派生'])
          ]));
        })
      }, ['派生']));
      ops.appendChild(el('button', {
        class: 'btn sm', style: 'margin-left:4px', onclick: () => showHistory(p)
      }, ['履历']));
      tbl.appendChild(tr);
    });
    tblWrap.appendChild(tbl);
    if (!list.length) tblWrap.appendChild(el('p', { class: 'muted' }, ['该状态下暂无工程。']));
  }

  function showChain(p) {
    const chain = Store.parentChain(p);
    U.modal(p.code + ' 派生谱系', body => {
      body.appendChild(el('p', {}, ['当前工程：', el('b', {}, [p.code + ' ' + p.name])]));
      if (!chain.length) body.appendChild(el('p', { class: 'muted' }, ['本工程为基础工程，无父工程。']));
      else {
        body.appendChild(el('p', { class: 'muted' }, ['向上追溯父工程链：']));
        const ul = el('ul');
        chain.forEach((c, i) => ul.appendChild(el('li', {}, [`↑ ${c.code} ${c.name}（${c.status}）${i === chain.length - 1 ? ' ← 基础工程' : ''}`])));
        body.appendChild(ul);
      }
      const children = st.projects.filter(x => x.parentId === p.id);
      if (children.length) {
        body.appendChild(el('p', { class: 'muted' }, ['直接派生子工程：']));
        const ul2 = el('ul');
        children.forEach(c => ul2.appendChild(el('li', {}, [`${c.code} ${c.name}（${c.status}）`])));
        body.appendChild(ul2);
      }
    });
  }

  function showHistory(p) {
    U.modal(p.code + ' 流转履历', body => {
      const t = el('table', { class: 'grid' }, [
        el('tr', {}, ['时间', '从', '到', '处理意见', '操作人'].map(h => el('th', {}, [h])))
      ]);
      p.history.forEach(h => t.appendChild(el('tr', {}, [
        el('td', { class: 'mono small' }, [h.t]), el('td', {}, [h.from]), el('td', {}, [h.to]),
        el('td', {}, [h.opinion]), el('td', {}, [h.user])
      ])));
      body.appendChild(t);
      if (p.changeOrders.length) {
        body.appendChild(el('h3', {}, ['变更单']));
        const t2 = el('table', { class: 'grid' }, [el('tr', {}, ['单号', '时间', '变更原因'].map(h => el('th', {}, [h])))]);
        p.changeOrders.forEach(c => t2.appendChild(el('tr', {}, [
          el('td', { class: 'mono' }, [c.id]), el('td', { class: 'mono small' }, [c.t]), el('td', {}, [c.reason])
        ])));
        body.appendChild(t2);
      }
    }, true);
  }

  renderTable();
};
