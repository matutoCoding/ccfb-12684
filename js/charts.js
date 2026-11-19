/* charts.js — Canvas 二维图表：折线、散点(帕累托)、横向条形 */
window.Charts = (function () {
  const COLORS = ['#3fa7ff', '#27c2a5', '#f0a63c', '#ef5b6b', '#b07cff', '#3ecf7a', '#e8d44d', '#ff8fb0'];

  function setup(canvas, hCss) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = (hCss || 300) + 'px';
    const W = canvas.clientWidth * dpr, H = (hCss || 300) * dpr;
    canvas.width = W; canvas.height = H;
    return { ctx: canvas.getContext('2d'), W, H, dpr };
  }

  /* 折线图：series=[{name, pts:[[x,y]...], color?, dash?}] */
  function line(canvas, series, opt) {
    opt = opt || {};
    const { ctx, W, H, dpr } = setup(canvas, opt.height || 300);
    const L = 56 * dpr, R = 14 * dpr, T = 26 * dpr, B = 34 * dpr;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    series.forEach(s => s.pts.forEach(p => {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }));
    if (opt.yBand) { y0 = Math.min(y0, opt.yBand[0]); y1 = Math.max(y1, opt.yBand[1]); }
    const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad;
    const X = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R);
    const Y = y => H - B - (y - y0) / ((y1 - y0) || 1) * (H - T - B);
    ctx.strokeStyle = '#2a3648'; ctx.fillStyle = '#8fa1b6';
    ctx.font = `${10 * dpr}px sans-serif`; ctx.lineWidth = dpr;
    for (let i = 0; i <= 5; i++) {
      const y = y0 + (y1 - y0) * i / 5, py = Y(y);
      ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(W - R, py); ctx.stroke();
      ctx.fillText(y.toFixed(1), 6 * dpr, py + 3 * dpr);
    }
    for (let i = 0; i <= 6; i++) {
      const x = x0 + (x1 - x0) * i / 6, px = X(x);
      ctx.fillText(String(Math.round(x)), px - 8 * dpr, H - 18 * dpr);
    }
    if (opt.hLine !== undefined) {
      ctx.strokeStyle = '#ef5b6b'; ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(L, Y(opt.hLine)); ctx.lineTo(W - R, Y(opt.hLine)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef5b6b';
      ctx.fillText(opt.hLineLabel || '', L + 4 * dpr, Y(opt.hLine) - 4 * dpr);
    }
    series.forEach((s, k) => {
      ctx.strokeStyle = s.color || COLORS[k % COLORS.length];
      ctx.lineWidth = 1.6 * dpr;
      if (s.dash) ctx.setLineDash([5 * dpr, 4 * dpr]); else ctx.setLineDash([]);
      ctx.beginPath();
      s.pts.forEach((p, i) => { const px = X(p[0]), py = Y(p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // 图例
    let lx = L + 8 * dpr;
    series.forEach((s, k) => {
      ctx.fillStyle = s.color || COLORS[k % COLORS.length];
      ctx.fillRect(lx, 8 * dpr, 10 * dpr, 3 * dpr);
      ctx.fillStyle = '#8fa1b6';
      ctx.fillText(s.name, lx + 14 * dpr, 13 * dpr);
      lx += (ctx.measureText(s.name).width + 34 * dpr);
    });
    if (opt.xlabel) { ctx.fillStyle = '#8fa1b6'; ctx.fillText(opt.xlabel, W / 2 - 20 * dpr, H - 4 * dpr); }
  }

  /* 散点图（帕累托前沿）：pts=[{x,y,label,pareto}] */
  function scatter(canvas, pts, opt) {
    opt = opt || {};
    const { ctx, W, H, dpr } = setup(canvas, opt.height || 320);
    const L = 60 * dpr, R = 16 * dpr, T = 20 * dpr, B = 38 * dpr;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const px = (x1 - x0) * 0.08 || 1, py = (y1 - y0) * 0.08 || 1;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R);
    const Y = y => H - B - (y - y0) / (y1 - y0) * (H - T - B);
    ctx.strokeStyle = '#2a3648'; ctx.fillStyle = '#8fa1b6'; ctx.font = `${10 * dpr}px sans-serif`;
    for (let i = 0; i <= 5; i++) {
      const y = y0 + (y1 - y0) * i / 5;
      ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(W - R, Y(y)); ctx.stroke();
      ctx.fillText(y.toFixed(2), 6 * dpr, Y(y) + 3 * dpr);
      const x = x0 + (x1 - x0) * i / 5;
      ctx.fillText(x.toFixed(0), X(x) - 8 * dpr, H - 20 * dpr);
    }
    ctx.fillText(opt.xlabel || '', W / 2 - 30 * dpr, H - 4 * dpr);
    ctx.fillText(opt.ylabel || '', 4 * dpr, 14 * dpr);
    // 帕累托连线
    const par = pts.filter(p => p.pareto).sort((a, b) => a.x - b.x);
    if (par.length > 1) {
      ctx.strokeStyle = '#27c2a5'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      par.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
      ctx.stroke();
    }
    pts.forEach(p => {
      ctx.fillStyle = p.sel ? '#fff' : (p.pareto ? '#27c2a5' : 'rgba(63,167,255,.45)');
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), (p.sel ? 6 : p.pareto ? 4.5 : 3) * dpr, 0, 6.3);
      ctx.fill();
      if (p.sel) { ctx.strokeStyle = '#27c2a5'; ctx.lineWidth = 2 * dpr; ctx.stroke(); }
    });
    return { X, Y, x0, x1, y0, y1, L, R, T, B, W, H };
  }

  /* 横向条形（逐层空隙率） */
  function hbars(canvas, labels, values, opt) {
    opt = opt || {};
    const { ctx, W, H, dpr } = setup(canvas, opt.height || Math.max(160, labels.length * 26 + 30));
    const L = 70 * dpr, R = 50 * dpr, T = 10 * dpr, B = 24 * dpr;
    const vmax = Math.max.apply(null, values.concat([opt.threshold || 0])) * 1.15 || 1;
    const bh = (H - T - B) / labels.length;
    ctx.font = `${10 * dpr}px sans-serif`;
    labels.forEach((lb, i) => {
      const y = T + i * bh, v = values[i];
      const over = opt.threshold !== undefined && v > opt.threshold;
      ctx.fillStyle = over ? '#ef5b6b' : '#3fa7ff';
      const w = v / vmax * (W - L - R);
      ctx.fillRect(L, y + bh * 0.18, w, bh * 0.64);
      ctx.fillStyle = '#8fa1b6';
      ctx.fillText(lb, 6 * dpr, y + bh * 0.62);
      ctx.fillStyle = over ? '#ef5b6b' : '#dbe4ef';
      ctx.fillText(v.toFixed(2) + (opt.unit || ''), L + w + 5 * dpr, y + bh * 0.62);
    });
    if (opt.threshold !== undefined) {
      const x = L + opt.threshold / vmax * (W - L - R);
      ctx.strokeStyle = '#ef5b6b'; ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, H - B); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef5b6b'; ctx.fillText('阈值 ' + opt.threshold, x - 20 * dpr, H - 8 * dpr);
    }
  }

  return { line, scatter, hbars, COLORS };
})();
