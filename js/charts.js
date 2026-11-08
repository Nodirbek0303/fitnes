function areaChart(points) {
  const w = 680;
  const h = 230;
  const padL = 28;
  const padR = 12;
  const padT = 18;
  const padB = 32;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (w - padL - padR) / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => {
    const x = padL + i * step;
    const y = padT + (1 - p.value / max) * (h - padT - padB);
    return [x, y];
  });
  const line = coords.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = line + " L" + coords[coords.length - 1][0].toFixed(1) + "," + (h - padB) + " L" + coords[0][0].toFixed(1) + "," + (h - padB) + " Z";
  const dots = coords.map((p, i) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="#e8fbff" stroke="#3ce1ff" stroke-width="2"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 10) + '" text-anchor="middle" fill="#d7f6ff" font-size="11" font-family="Segoe UI,sans-serif">' + points[i].value + "</text>").join("");
  const labels = points.map((p, i) => '<text x="' + coords[i][0].toFixed(1) + '" y="' + (h - 10) + '" text-anchor="middle" fill="#8eabc8" font-size="12" font-family="Segoe UI,sans-serif">' + esc(p.label) + "</text>").join("");
  return '<svg class="chart-svg" viewBox="0 0 ' + w + " " + h + '" role="img"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3ce1ff" stop-opacity="0.45"/><stop offset="100%" stop-color="#3ce1ff" stop-opacity="0"/></linearGradient></defs><path d="' + area + '" fill="url(#areaFill)"/><path d="' + line + '" fill="none" stroke="#3ce1ff" stroke-width="2.5"/>' + dots + labels + "</svg>";
}

function donutChart(parts, centerTop, centerSub) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const active = parts.filter((p) => p.value > 0);
  let offset = 0;
  const arcs = active.map((p) => {
    const gap = active.length > 1 ? 4 : 0;
    const len = Math.max(0, (p.value / (total || 1)) * c - gap);
    const el = '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="16" stroke-dasharray="' + len.toFixed(2) + " " + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 90 90)"/>';
    offset += (p.value / (total || 1)) * c;
    return el;
  }).join("");
  const legend = parts.map((p) => '<li><i style="background:' + p.color + '"></i><span>' + esc(p.label) + '</span><b>' + p.value + "</b></li>").join("");
  const empty = total ? "" : '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="rgba(142,171,200,.25)" stroke-width="16"/>';
  return '<div class="donut-wrap"><svg viewBox="0 0 180 180" class="donut" role="img">' + empty + arcs + '<text x="90" y="86" text-anchor="middle" fill="#f3fbff" font-size="22" font-weight="700" font-family="Bahnschrift,Segoe UI,sans-serif">' + esc(centerTop) + '</text><text x="90" y="106" text-anchor="middle" fill="#8eabc8" font-size="11" font-family="Segoe UI,sans-serif">' + esc(centerSub) + "</text></svg><ul class=\"legend\">" + legend + "</ul></div>";
}

function barChart(items) {
  const w = 680;
  const h = 240;
  const padL = 16;
  const padR = 10;
  const padT = 24;
  const padB = 32;
  const max = Math.max(1, ...items.map((i) => i.value));
  const gap = 12;
  const bw = (w - padL - padR - gap * (items.length - 1)) / Math.max(1, items.length);
  const bars = items.map((item, i) => {
    const bh = (item.value / max) * (h - padT - padB);
    const x = padL + i * (bw + gap);
    const y = h - padB - bh;
    const color = item.color || "#3ce1ff";
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="7" fill="' + color + '" opacity="0.9"/><text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6) + '" text-anchor="middle" fill="#d7f6ff" font-size="11" font-family="Segoe UI,sans-serif">' + item.value + '</text><text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 10) + '" text-anchor="middle" fill="#8eabc8" font-size="11" font-family="Segoe UI,sans-serif">' + esc(item.label) + "</text>";
  }).join("");
  return '<svg class="chart-svg" viewBox="0 0 ' + w + " " + h + '" role="img">' + bars + "</svg>";
}
