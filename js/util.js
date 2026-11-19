/* util.js — 通用工具：确定性随机、稳定哈希、DOM、弹窗、下载 */
window.U = (function () {

  /* mulberry32 确定性伪随机数发生器 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* FNV-1a 字符串哈希 */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* 键序稳定的序列化：同一组参数永远得到同一串 */
  function canonical(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  function seedOf(o) { return fnv1a(canonical(o)); }
  function rngFrom(o) { return mulberry32(seedOf(o)); }
  function fingerprint(o) { return seedOf(o).toString(16).padStart(8, '0'); }

  let uidSeq = 1;
  function uid(p) { return (p || 'ID') + '-' + (Date.now().toString(36)) + '-' + (uidSeq++).toString(36); }

  function fmt(x, d) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    d = d === undefined ? 2 : d;
    return Number(x).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function hoursSince(ts) { return (Date.now() - ts) / 3600000; }

  /* DOM 构建 */
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else if (k === 'disabled') { if (v) e.disabled = true; }
      else e.setAttribute(k, v);
    }
    (kids || []).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* 弹窗：build(body, close) 内自行组织内容与按钮 */
  function modal(title, build, wide) {
    const root = document.getElementById('modalRoot');
    const ov = el('div', { class: 'modal-ov' });
    const box = el('div', { class: 'modal' });
    if (wide) box.style.minWidth = '720px';
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    box.appendChild(el('div', { class: 'modal-h' }, [
      el('span', {}, [title]),
      el('button', { class: 'x', onclick: close }, ['×'])
    ]));
    const body = el('div', { class: 'modal-b' });
    box.appendChild(body);
    ov.appendChild(box);
    root.appendChild(ov);
    build(body, close);
    return { close, body };
  }

  /* 必须填写处理意见的确认弹窗（工程状态流转用） */
  function opinionModal(title, placeholder, onOk) {
    modal(title, (body, close) => {
      const ta = el('textarea', { placeholder: placeholder || '请填写处理意见（必填）' });
      body.appendChild(el('div', {}, [ta]));
      body.appendChild(el('div', { class: 'modal-f' }, [
        el('button', { class: 'btn', onclick: close }, ['取消']),
        el('button', {
          class: 'btn primary', onclick: () => {
            const v = ta.value.trim();
            if (!v) { toast('处理意见不能为空', true); return; }
            close(); onOk(v);
          }
        }, ['确认'])
      ]));
      ta.focus();
    });
  }

  function toast(msg, isErr) {
    const root = document.getElementById('toastRoot');
    const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, [msg]);
    root.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* 简单可扫样码（演示用矩阵码，编码字符串哈希，非标准QR） */
  function drawCode(canvas, text) {
    const N = 25, s = 4;
    canvas.width = N * s; canvas.height = N * s;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rng = mulberry32(fnv1a(text));
    ctx.fillStyle = '#000';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (rng() < 0.45) ctx.fillRect(x * s, y * s, s, s);
    }
    // 三个定位角
    function finder(cx, cy) {
      ctx.fillStyle = '#000'; ctx.fillRect(cx * s, cy * s, 7 * s, 7 * s);
      ctx.fillStyle = '#fff'; ctx.fillRect((cx + 1) * s, (cy + 1) * s, 5 * s, 5 * s);
      ctx.fillStyle = '#000'; ctx.fillRect((cx + 2) * s, (cy + 2) * s, 3 * s, 3 * s);
    }
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
  }

  function jet(t) { // 0..1 -> [r,g,b]
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3))));
    const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2))));
    const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1))));
    return [r, g, b];
  }
  function css(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

  return { mulberry32, fnv1a, canonical, seedOf, rngFrom, fingerprint, uid, fmt, nowStr,
    hoursSince, el, clear, modal, opinionModal, toast, download, drawCode, jet, css };
})();
