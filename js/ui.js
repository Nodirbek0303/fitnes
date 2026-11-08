const AVATAR_COLORS = ["#155e8a", "#0f766e", "#6d28d9", "#b45309", "#9f1239", "#1d4ed8", "#047857", "#7c2d12"];

function avatar(name, size, photo) {
  const parts = String(name || "?").trim().split(/\s+/);
  const letters = ((parts[0] || "?").charAt(0) + (parts[1] || "").charAt(0)).toUpperCase();
  let hash = 0;
  for (const ch of String(name || "")) hash = (hash + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  if (photo) return '<span class="avatar avatar-photo" style="width:' + size + "px;height:" + size + 'px"><img src="' + esc(photo) + '" alt="' + esc(name || "A'zo") + '"></span>';
  return '<span class="avatar" style="width:' + size + "px;height:" + size + "px;background:" + AVATAR_COLORS[hash] + '">' + esc(letters) + "</span>";
}

function pill(status) {
  const meta = STATUS[status] || STATUS.active;
  return '<span class="pill ' + meta.cls + '">' + meta.label + "</span>";
}

function progressHtml(m) {
  const plan = planById(m.planId);
  const status = memberStatus(m);
  if (status === "pending") {
    return '<div class="prog"><div class="prog-top"><span>To\'lov tasdig\'i kutilmoqda</span><span>0%</span></div><div class="bar warn"><span style="width:0%"></span></div></div>';
  }
  let pct = 0;
  let text = leftLabel(m);
  if (plan.kind === "sessions") {
    const total = m.sessionsTotal || plan.sessions || 1;
    const left = Math.max(0, m.sessionsLeft || 0);
    pct = Math.round((left / total) * 100);
    text = left + " / " + total + " mashg'ulot";
  } else {
    const total = Math.max(1, daysBetween(m.startDate, m.endDate));
    const left = Math.max(0, daysLeft(m.endDate));
    pct = Math.round((left / total) * 100);
  }
  pct = Math.max(0, Math.min(100, pct));
  return '<div class="prog"><div class="prog-top"><span>' + esc(text) + "</span><span>" + pct + '%</span></div><div class="bar ' + status + '"><span style="width:' + pct + '%"></span></div></div>';
}

function memberCardHtml(m) {
  const plan = planById(m.planId);
  const status = m.endDate ? memberStatus(m) : "active";
  const vip = plan.id === "vip" ? " vip" : "";
  return (
    '<article class="pcard' + vip + '">' +
      '<div class="pcard-top"><img src="assets/logo.png" alt=""/><div><small>TAMERLAN FITNESS</small><b>A\'ZO KARTASI</b></div><span class="chip" aria-hidden="true"></span></div>' +
      '<div class="pcard-mid">' + avatar(fullName(m), 52, m.photo) + "<div><strong>" + esc(fullName(m)) + "</strong><em>" + esc(m.code || "TM-YANGI") + "</em></div>" + pill(status) + "</div>" +
      '<div class="pcard-bot"><span>' + esc(plan.name) + "</span><span class=\"mono\">" + esc(m.uid || "NFC yo'q") + "</span><span>" + esc(m.endDate ? leftLabel(m) : "") + "</span></div>" +
      '<div class="nfc-waves" aria-hidden="true"><span></span><span></span><span></span></div>' +
    "</article>"
  );
}

function qrHtml(text) {
  const data = Array.from(new TextEncoder().encode(text));
  const version = data.length <= 53 ? 3 : data.length <= 78 ? 4 : 0;
  if (!version) return '<span class="qr-error">QR kodi yaratilmadi</span>';
  const size = version === 3 ? 29 : 33;
  const dataWords = version === 3 ? 55 : 80;
  const correctionWords = version === 3 ? 15 : 20;
  const bits = [];
  function appendBits(value, count) {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }
  appendBits(4, 4);
  appendBits(data.length, 8);
  data.forEach((byte) => appendBits(byte, 8));
  const capacity = dataWords * 8;
  appendBits(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; codewords.length < dataWords; pad++) codewords.push(pad % 2 ? 0x11 : 0xec);

  function multiply(a, b) {
    let result = 0;
    for (let i = 7; i >= 0; i--) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      if ((b >>> i) & 1) result ^= a;
    }
    return result;
  }
  let generator = [1];
  let root = 1;
  for (let i = 0; i < correctionWords; i++) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiply(coefficient, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const work = codewords.concat(new Array(correctionWords).fill(0));
  for (let i = 0; i < dataWords; i++) {
    const factor = work[i];
    if (!factor) continue;
    generator.forEach((coefficient, index) => { work[i + index] ^= multiply(coefficient, factor); });
  }
  const stream = codewords.concat(work.slice(dataWords)).flatMap((word) => {
    const wordBits = [];
    for (let bit = 7; bit >= 0; bit--) wordBits.push((word >>> bit) & 1);
    return wordBits;
  });

  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  function set(x, y, value) {
    if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = !!value;
  }
  function finder(cx, cy) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(x, y, dark);
      }
    }
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const align = size - 7;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      set(align + dx, align + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const formatData = 8;
  let remainder = formatData << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((remainder >>> bit) & 1) remainder ^= 0x537 << (bit - 10);
  }
  const format = ((formatData << 10) | remainder) ^ 0x5412;
  function formatBit(index) { return ((format >>> index) & 1) !== 0; }
  for (let i = 0; i <= 5; i++) set(8, i, formatBit(i));
  set(8, 7, formatBit(6));
  set(8, 8, formatBit(7));
  set(7, 8, formatBit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, formatBit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, formatBit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, formatBit(i));
  set(8, size - 8, true);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (matrix[y][x] !== null) continue;
        const bit = bitIndex < stream.length ? stream[bitIndex++] : 0;
        set(x, y, Boolean(bit) !== ((x + y) % 2 === 0));
      }
    }
    upward = !upward;
  }
  const blocks = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) blocks.push('<rect x="' + (x + 4) + '" y="' + (y + 4) + '" width="1" height="1"/>');
    }
  }
  const viewSize = size + 8;
  return '<svg class="qr" viewBox="0 0 ' + viewSize + " " + viewSize + '" role="img" aria-label="Zalga kirish uchun umumiy QR kod" shape-rendering="crispEdges"><rect width="' + viewSize + '" height="' + viewSize + '" fill="#fff"/><g fill="#111">' + blocks.join("") + "</g></svg>";
}

function clubAccessQrValue() {
  return window.location.href.split("#")[0] + "#/account";
}

function clubName() {
  return (Gym.state && Gym.state.settings.clubName) || "Tamerlan Fitness";
}
