function visitsOn(date) {
  return Gym.state.logs.filter((l) => l.at.slice(0, 10) === date && l.result === "ok" && l.direction === "in").length;
}

function paySum(list) {
  return list.reduce((sum, p) => sum + (p.amount || 0), 0);
}

function logTable(logs) {
  if (!logs.length) return '<tr><td colspan="5" class="empty">Hozircha yozuv yo\'q</td></tr>';
  return logs.map((l) => {
    const m = memberById(l.memberId);
    const denied = l.result !== "ok";
    const tag = denied ? "no" : l.direction === "in" ? "in" : "out";
    const label = denied ? "Rad" : l.direction === "in" ? "Kirish" : "Chiqish";
    const who = m
      ? '<div class="person">' + avatar(fullName(m), 32, m.photo) + "<div><b>" + esc(fullName(m)) + "</b><small>" + esc(m.code) + "</small></div></div>"
      : '<span class="mono">' + esc(l.uid || "Noma'lum") + "</span>";
    return "<tr><td class=\"mono\">" + esc(formatHM(l.at)) + "<small>" + esc(formatDM(l.at)) + '</small></td><td>' + who + '</td><td><span class="tag tag-' + tag + '">' + label + "</span></td><td>" + esc(l.reason) + "</td><td>" + esc(gateName(l.gateId)) + "</td></tr>";
  }).join("");
}

function scanBanner(result) {
  if (!result) return '<div class="scan-wait"><span class="pulse"></span><b>Kartani kuting</b><small>NFC o\'quvchi UID yozadi yoki qo\'lda kiriting</small></div>';
  const cls = result.duplicate ? "warn" : result.ok ? "ok" : "bad";
  const who = result.member ? fullName(result.member) : (result.uid || "");
  let extra = "";
  if (result.member && result.ok && result.direction === "in" && planById(result.member.planId).kind === "sessions") {
    extra = "<small>Qolgan mashg'ulot: " + (result.sessionsLeft != null ? result.sessionsLeft : result.member.sessionsLeft) + "</small>";
  }
  const meta = result.member ? "<em>" + esc(result.member.code) + " · " + esc(gateName(result.gateId)) + "</em>" : "";
  return '<div class="scan-banner ' + cls + '"><strong>' + esc(result.title) + "</strong><b>" + esc(who) + "</b><span>" + esc(result.reason || "") + "</span>" + extra + meta + "</div>";
}

function insideList() {
  const people = Gym.state.members.filter((m) => Gym.isInside(m.id)).map((m) => {
    const log = Gym.state.logs.find((l) => l.memberId === m.id && l.result === "ok");
    return { m, at: log ? log.at : "" };
  });
  if (!people.length) return '<p class="empty">Hozir zalda a\'zo yo\'q</p>';
  return people.map((item) => '<div class="list-row"><div class="person">' + avatar(fullName(item.m), 36, item.m.photo) + "<div><b>" + esc(fullName(item.m)) + "</b><small>" + esc(item.m.code) + '</small></div></div><b data-ago="' + esc(item.at) + '">' + esc(since(item.at)) + "</b></div>").join("");
}

function sampleButtons() {
  const active = Gym.state.members.filter((m) => memberStatus(m) === "active").slice(0, 3);
  const denied = Gym.state.members.filter((m) => memberStatus(m) === "expired").slice(0, 1);
  return active.concat(denied).map((m) => {
    const st = memberStatus(m);
    return '<button type="button" class="btn sm ghost" data-action="demo-scan" data-uid="' + esc(m.uid) + '">' + esc(fullName(m)) + " · " + esc(STATUS[st].label) + "</button>";
  }).join("");
}

function pageDashboard() {
  const today = todayISO();
  const yday = addDays(today, -1);
  const members = Gym.state.members;
  const expiring = members.filter((m) => memberStatus(m) === "expiring");
  const active = members.filter((m) => {
    const st = memberStatus(m);
    return st === "active" || st === "expiring";
  });
  const inside = members.filter((m) => Gym.isInside(m.id));
  const tVisits = visitsOn(today);
  const yVisits = visitsOn(yday);
  const delta = tVisits - yVisits;
  const deltaText = delta === 0 ? "Kecha bilan teng" : delta > 0 ? "Kechagidan " + delta + " ta ko'p" : "Kechagidan " + Math.abs(delta) + " ta kam";
  const todayPay = paySum(Gym.state.payments.filter((p) => p.date.slice(0, 10) === today));
  const monthPay = paySum(Gym.state.payments.filter((p) => p.date.slice(0, 7) === today.slice(0, 7)));
  const points = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    points.push({ label: weekdayLabel(date), value: visitsOn(date) });
  }
  const watch = members.filter((member) => memberStatus(member) !== "pending").slice().sort((a, b) => {
    const rank = { expired: 0, expiring: 1, active: 2, frozen: 3 };
    const d = rank[memberStatus(a)] - rank[memberStatus(b)];
    return d || daysLeft(a.endDate) - daysLeft(b.endDate);
  }).slice(0, 6);
  const monthPays = Gym.state.payments.filter((p) => p.date.slice(0, 7) === today.slice(0, 7));
  const parts = Object.keys(METHOD_META).map((key) => ({
    label: METHOD_META[key].label,
    color: METHOD_META[key].color,
    value: monthPays.filter((p) => p.method === key).length,
  }));
  const alert = expiring.length
    ? '<div class="alert"><div><b>Muddat tugashiga 3 kundan kam</b><span>' + expiring.length + ' ta a\'zo. Obunani yangilang.</span></div><a class="btn sm" href="#/billing">Obunani yangilash</a></div>'
    : "";
  const watchHtml = watch.map((m) => '<div class="watch"><div class="person">' + avatar(fullName(m), 38, m.photo) + "<div><b>" + esc(fullName(m)) + "</b><small>" + esc(planById(m.planId).name) + " · " + esc(formatDM(m.endDate)) + "</small></div></div>" + pill(memberStatus(m)) + "</div>" + progressHtml(m)).join("");
  return alert +
    '<section class="stats">' +
      statCard("Faol a'zolar", active.length, expiring.length + " tasining muddati tugayapti", "users", "cyan") +
      statCard("Bugungi tashrif", tVisits, deltaText, "scan", "gold") +
      statCard("Hozir zalda", inside.length, "Bitta asosiy kirish-chiqish", "gate", "green") +
      statCard("Bugungi tushum", money(todayPay), "Shu oy " + money(monthPay), "card", "violet") +
    "</section>" +
    '<section class="grid-2">' +
      '<article class="card"><header class="card-h"><h3>Turniket faolligi</h3><span>7 kun</span></header>' + areaChart(points) + "</article>" +
      '<article class="card"><header class="card-h"><h3>Obuna muddati nazorati</h3><a href="#/members">Barchasi</a></header><div class="stack">' + watchHtml + "</div></article>" +
    "</section>" +
    '<section class="grid-2">' +
      '<article class="card"><header class="card-h"><h3>So\'nggi keldi-ketdi</h3><a href="#/turnstile">Jurnal</a></header><div class="table-wrap"><table><thead><tr><th>Vaqt</th><th>A\'zo</th><th>Yo\'nalish</th><th>Sabab</th><th>Eshik</th></tr></thead><tbody>' + logTable(Gym.state.logs.slice(0, 7)) + "</tbody></table></div></article>" +
      '<article class="card"><header class="card-h"><h3>To\'lov turlari</h3><span>Shu oy</span></header>' + donutChart(parts, String(monthPays.length), "to'lov") +
        '<div class="flow"><div><span>01</span><b>NFC karta</b><small>A\'zo kartasi</small></div><i>' + icon("arrow") + '</i><div><span>02</span><b>Turniket</b><small>Kirish / chiqish</small></div><i>' + icon("arrow") + '</i><div><span>03</span><b>Admin tizim</b><small>Jurnal va hisob</small></div></div>' +
        '<div class="actions"><a class="btn" href="#/turnstile">Turniketni ochish</a><a class="btn ghost" href="#/kiosk">Eshik ekrani</a></div></article>' +
    "</section>";
}

function statCard(label, value, sub, ico, tone) {
  return '<article class="stat"><div><span class="stat-label">' + label + '</span><strong class="stat-value">' + value + '</strong><span class="stat-sub">' + sub + '</span></div><span class="stat-ico ' + tone + '">' + icon(ico) + "</span></article>";
}

function pageMembers() {
  if (ui.editId && !memberById(ui.editId)) ui.editId = null;
  const editing = ui.editId ? memberById(ui.editId) : null;
  const code = editing ? editing.code : nextCode();
  const preview = editing || {
    firstName: "Yangi",
    lastName: "a'zo",
    code,
    planId: "monthly",
    uid: "",
    startDate: todayISO(),
    endDate: addDays(todayISO(), 30),
    frozen: false,
  };
  const filters = [["all", "Barchasi"], ["active", "Faol"], ["pending", "Tasdiq kutilmoqda"], ["expiring", "Tugayapti"], ["expired", "Tugagan"], ["frozen", "Muzlatilgan"]];
  const filterHtml = filters.map((f) => {
    const count = f[0] === "all" ? Gym.state.members.length : Gym.state.members.filter((m) => memberStatus(m) === f[0]).length;
    return '<button type="button" class="seg' + (ui.filter === f[0] ? " on" : "") + '" data-action="filter" data-filter="' + f[0] + '">' + f[1] + " <em>" + count + "</em></button>";
  }).join("");
  const q = ui.q.trim().toLowerCase();
  const rows = Gym.state.members.filter((m) => {
    if (ui.filter !== "all" && memberStatus(m) !== ui.filter) return false;
    if (!q) return true;
    return (fullName(m) + " " + m.phone + " " + m.email + " " + m.code + " " + m.uid).toLowerCase().includes(q);
  });
  const plans = PLANS.map((p) => '<label class="plan-pick"><input type="radio" name="planId" value="' + p.id + '"' + (p.id === "monthly" ? " checked" : "") + "><b>" + esc(p.name) + "</b><small>" + money(p.price) + "</small><small>" + esc(p.hint) + "</small></label>").join("");
  const methods = Object.keys(METHOD_META).map((key, i) => '<label class="method"><input type="radio" name="method" value="' + key + '"' + (i === 0 ? " checked" : "") + "><span>" + METHOD_META[key].label + "</span></label>").join("");
  const photoPreview = avatar(editing ? fullName(editing) : "Yangi a'zo", 72, editing && editing.photo);
  const form = '<form id="member-form" class="card" data-editing="' + (editing ? "1" : "0") + '" data-code="' + esc(code) + '" data-plan="' + esc(editing ? editing.planId : "monthly") + '" data-start="' + esc(editing ? editing.startDate : todayISO()) + '" data-end="' + esc(editing ? editing.endDate : "") + '" data-sessions="' + (editing && editing.sessionsLeft != null ? editing.sessionsLeft : "") + '" data-sessions-total="' + (editing && editing.sessionsTotal != null ? editing.sessionsTotal : "") + '">' +
    '<header class="card-h"><h3>' + (editing ? "A'zoni tahrirlash" : "Yangi a'zo") + "</h3></header>" +
    '<div class="split-2"><label class="field">Ism<input name="firstName" required value="' + esc(editing ? editing.firstName : "") + '"></label><label class="field">Familiya<input name="lastName" required value="' + esc(editing ? editing.lastName : "") + '"></label></div>' +
    '<label class="field">Telefon<input name="phone" required value="' + esc(editing ? editing.phone : "") + '" placeholder="+998 90 000 00 00"></label>' +
    '<div class="split-2"><label class="field">Elektron pochta<input type="email" name="email" value="' + esc(editing ? editing.email : "") + '"></label><label class="field">Tug\'ilgan sana<input type="date" name="birthDate" value="' + esc(editing ? editing.birthDate : "") + '"></label></div>' +
    '<div class="split-2"><label class="field">Hudud<input name="region" value="' + esc(editing ? editing.region : "") + '"></label><label class="field">Tuman<input name="district" value="' + esc(editing ? editing.district : "") + '"></label></div><label class="field">Uy manzili<input name="address" value="' + esc(editing ? editing.address : "") + '"></label>' +
    '<div class="member-photo-field"><label class="field">A\'zo rasmi<input id="member-photo-input" name="memberPhoto" type="file" accept="image/jpeg,image/png,image/webp,image/gif"' + (editing && editing.photo ? "" : " required") + '><small class="muted">JPG, PNG, WebP yoki GIF. Rasm bazada saqlanishi uchun avtomatik kichraytiriladi.</small></label><div id="member-photo-preview" class="member-photo-preview">' + photoPreview + '<span>' + (editing && editing.photo ? "Joriy rasm" : "Rasm tanlanmagan") + "</span></div></div>" +
    (editing && editing.accessType === "face"
      ? '<div class="note-box"><b>Xodim tasdig\'i orqali kirish</b><span>Kunlik tarif uchun NFC karta buyurtma qilinmaydi.</span></div>'
      : editing && editing.accessType === "qr"
        ? '<div class="note-box"><b>QR orqali akkaunt</b><span>Barcha a\'zolar zalning bir xil umumiy QR kodidan foydalanadi.</span></div>'
      : editing
        ? '<div class="note-box"><span>NFC karta holati</span><b class="mono">' + esc(editing.uid || "Eski karta bekor qilingan") + '</b>' + (editing.uid
          ? '<span>Kartani almashtirsangiz, eski UID darhol bloklanadi; yangi karta shu a\'zoga beriladi.</span>'
          : '<span>Yangi karta biriktirilguncha a\'zolik va tashrif tarixi saqlanadi.</span>') +
          (Gym.state.cardOrders.some((order) => order.memberId === editing.id && order.status === "pending")
            ? '<span class="pill warn">Yangi karta kutilmoqda</span>'
            : '<button type="button" class="btn sm ghost" data-action="request-card" data-id="' + esc(editing.id) + '">' + ((editing.cardIssuedCount || 0) ? "Kartani almashtirish — " + money(Gym.state.settings.cardReplacementFee) : "Birinchi NFC kartani so'rash — bepul") + "</button>") + "</div>"
        : '<label class="field">NFC UID (ixtiyoriy)<div class="uid-row"><input id="f-uid" name="uid" value="" placeholder="Jismoniy karta UIDsi bo\'lsa kiriting" class="mono"><button type="button" class="btn sm ghost" data-action="gen-uid">Yangi</button></div></label>') +
    (editing
      ? '<div class="note-box"><span>Joriy tarif</span><b>' + esc(planById(editing.planId).name) + "</b>" + progressHtml(editing) + '<label class="check"><input type="checkbox" name="frozen"' + (editing.frozen ? " checked" : "") + "> Obunani muzlatish</label></div>"
      : '<div class="field">Tarif<div class="plan-grid compact">' + plans + "</div></div><div class=\"field\">To'lov<div class=\"methods\">" + methods + "</div></div>") +
    '<label class="field">' + (editing ? "Yangi akkaunt paroli (ixtiyoriy)" : "Akkaunt paroli") + '<input name="accountPassword" type="password" minlength="8" autocomplete="new-password"' + (editing && editing.accountPasswordHash ? "" : " required") + '><small class="muted">' + (editing ? (editing.accountPasswordHash ? "Parolni bo\'sh qoldirsangiz, avvalgi parol saqlanadi." : "Bu a\'zoda hali akkaunt paroli yo\'q — yangi parol kiriting.") : "Akkauntni faqat admin yaratadi; foydalanuvchiga telefon va parolni bering.") + '</small></label>' +
    '<label class="field">Izoh<input name="note" value="' + esc(editing ? editing.note : "") + '"></label>' +
    '<div class="actions"><button class="btn" type="submit">' + (editing ? "Saqlash" : "A'zo qo'shish") + "</button>" +
      (editing ? '<button type="button" class="btn ghost" data-action="cancel-edit">Bekor</button><button type="button" class="btn danger" data-action="delete-member" data-id="' + editing.id + '">O\'chirish</button>' : "") +
    "</div></form>";
  const table = rows.length ? rows.map((m) => '<tr><td><div class="person">' + avatar(fullName(m), 36, m.photo) + "<div><b>" + esc(fullName(m)) + "</b><small>" + esc(m.code) + "</small></div></div></td><td>" + esc(m.phone) + (m.email ? "<small>" + esc(m.email) + "</small>" : "") + "</td><td><b>" + esc(planById(m.planId).name) + "</b><small>" + esc(formatDM(m.endDate)) + "</small></td><td>" + pill(memberStatus(m)) + '</td><td><span class="mono">' + esc(m.accessType === "face" ? "Face ID" : m.accessType === "qr" ? "QR kod" : (m.uid || "Karta kutilmoqda")) + '</span>' + (m.accessType === "nfc" ? '<button type="button" class="text-action" data-action="request-card" data-id="' + esc(m.id) + '">' + ((m.cardIssuedCount || 0) ? "Almashtirish" : "Karta so\'rash") + "</button>" : "") + '</td><td><div class="row-actions"><button type="button" class="icon-btn" title="Tahrir" data-action="edit-member" data-id="' + m.id + '">' + icon("edit") + '</button><button type="button" class="icon-btn" title="To\'lov / obuna" data-action="goto-bill" data-id="' + m.id + '">' + icon("card") + '</button><button type="button" class="icon-btn danger" title="O\'chirish" data-action="delete-member" data-id="' + m.id + '">' + icon("trash") + "</button></div></td></tr>").join("") : '<tr><td colspan="6" class="empty">A\'zo topilmadi</td></tr>';
  const pendingCards = Gym.state.cardOrders.filter((order) => order.status === "pending");
  const cardOrders = '<section class="card table-card"><header class="card-h"><h3>NFC karta buyurtmalari</h3><span>' + pendingCards.length + " ta kutilmoqda</span></header><div class=\"table-wrap\"><table><thead><tr><th>A'zo</th><th>Turi</th><th>Narxi</th><th>Buyurtma</th><th></th></tr></thead><tbody>" +
    (pendingCards.length ? pendingCards.map((order) => {
      const member = memberById(order.memberId);
      return '<tr><td>' + esc(member ? fullName(member) : "A'zo topilmadi") + (order.previousUid ? '<small class="mono">Bekor qilingan UID: ' + esc(order.previousUid) + "</small>" : "") + "</td><td>" + (order.replacement ? "Almashtirish" : "Birinchi karta") + "</td><td>" + money(order.fee) + '</td><td>' + esc(formatDT(order.createdAt)) + '</td><td><button type="button" class="btn sm" data-action="fulfill-card" data-id="' + esc(order.id) + '">UID biriktirish</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="empty">Kutilayotgan buyurtma yo\'q</td></tr>') + "</tbody></table></div>" +
    (ui.cardOrderId && pendingCards.some((order) => order.id === ui.cardOrderId)
      ? '<form id="card-uid-form" class="inline-uid-form"><input type="hidden" name="orderId" value="' + esc(ui.cardOrderId) + '"><label class="field">Jismoniy kartadagi UID<input name="uid" required class="mono" placeholder="04:A1:19:C2:7E:01"></label><button class="btn sm" type="submit">Kartani biriktirish</button><button class="btn sm ghost" type="button" data-action="cancel-card-fulfillment">Bekor</button></form>'
      : "") + "</section>";
  const memberList = '<section class="card table-card"><header class="card-h"><h3>A\'zolar ro\'yxati</h3><div class="member-list-tools"><div class="segs">' + filterHtml + '</div><button type="button" class="btn gold" data-action="add-member">+ Yangi a\'zo qo\'shish</button></div></header><div class="table-wrap"><table><thead><tr><th>A\'zo</th><th>Telefon</th><th>Tarif</th><th>Holat</th><th>NFC</th><th></th></tr></thead><tbody>' + table + "</tbody></table></div></section>";
  if (currentRoute() === "add-member") {
    return '<section class="member-form-page"><div class="member-form-heading"><div><p class="brand-kicker">A\'ZOLAR BOSHQARUVI</p><h2>' + (editing ? "A\'zoni tahrirlash" : "Yangi a\'zo qo\'shish") + '</h2><p class="muted">A\'zo ma\'lumotlari va shaxsiy akkauntini shu alohida panelda yarating.</p></div><button type="button" class="btn ghost" data-action="cancel-edit">A\'zolar ro\'yxatiga qaytish</button></div><section class="member-layout">' + form + '<div><div id="member-preview">' + memberCardHtml(preview) + '</div><p class="muted card-note">Obunali a\'zolar NFC karta bilan, kunlik mijozlar yuz orqali kiradi.</p><button type="button" class="btn ghost" data-action="print-card">Kartani chop etish</button></div></section></section>';
  }
  return '<section class="card"><header class="card-h"><h3>Hamma uchun yagona zal QR kodi</h3><span>Shaxsiy QR berilmaydi</span></header><div class="shared-qr">' + qrHtml(clubAccessQrValue()) + '<p>QR kodni zalda ko\'rinadigan joyga qo\'ying. A\'zo uni skanerlab, admin yaratgan akkauntiga telefon va parol bilan kiradi.</p></div></section>' + cardOrders + memberList;
}

function pageBilling() {
  const selected = memberById(ui.billMember);
  const options = '<option value="">A\'zoni tanlang</option>' + Gym.state.members.map((m) => '<option value="' + m.id + '"' + (m.id === ui.billMember ? " selected" : "") + ">" + esc(fullName(m)) + " · " + esc(m.code) + "</option>").join("");
  const plans = PLANS.map((p) => '<label class="plan-pick"><input type="radio" name="planId" value="' + p.id + '"' + (p.id === ui.billPlan ? " checked" : "") + "><b>" + esc(p.name) + "</b><strong>" + money(p.price) + "</strong><small>" + esc(p.hint) + "</small></label>").join("");
  const methods = Object.keys(METHOD_META).map((key, i) => '<label class="method"><input type="radio" name="method" value="' + key + '"' + (i === 0 ? " checked" : "") + "><span>" + METHOD_META[key].label + "</span></label>").join("");
  const info = selected ? '<div class="note-box"><div class="person">' + avatar(fullName(selected), 40, selected.photo) + "<div><b>" + esc(fullName(selected)) + "</b><small>" + esc(selected.code) + " · " + esc(planById(selected.planId).name) + "</small></div></div>" + pill(memberStatus(selected)) + progressHtml(selected) + "</div>" : "";
  const history = Gym.state.payments.slice(0, 14).map((p) => {
    const m = memberById(p.memberId);
    return "<tr><td>" + esc(formatDT(p.date)) + "</td><td>" + esc(m ? fullName(m) : "O'chirilgan a'zo") + "</td><td>" + esc(planById(p.planId).name) + "</td><td>" + money(p.amount) + "</td><td>" + esc(methodLabel(p.method)) + '</td><td><span class="pill ok">To\'langan</span></td></tr>';
  }).join("");
  const soon = Gym.state.members.filter((m) => memberStatus(m) === "expiring" || memberStatus(m) === "expired").sort((a, b) => daysLeft(a.endDate) - daysLeft(b.endDate)).slice(0, 5);
  const soonHtml = soon.length ? soon.map((m) => '<button type="button" class="list-row btn-row" data-action="goto-bill" data-id="' + m.id + '"><div class="person">' + avatar(fullName(m), 36, m.photo) + "<div><b>" + esc(fullName(m)) + "</b><small>" + esc(leftLabel(m)) + "</small></div></div>" + pill(memberStatus(m)) + "</button>").join("") : '<p class="empty">Muddat bo\'yicha ogohlantirish yo\'q</p>';
  return '<section class="grid-2">' +
    '<form id="bill-form" class="card"><header class="card-h"><h3>Yangi to\'lov</h3><b id="bill-amount">' + money(planById(ui.billPlan).price) + "</b></header>" +
      '<label class="field">A\'zo<select id="bill-member" name="memberId" required>' + options + "</select></label>" + info +
      '<div class="field">Tarif<div class="plan-grid">' + plans + "</div></div>" +
      '<div class="field">Usul<div class="methods">' + methods + "</div></div>" +
      '<button class="btn gold" type="submit">To\'lovni qabul qilish</button></form>' +
    '<article class="card"><header class="card-h"><h3>Muddat nazorati</h3></header><div class="stack">' + soonHtml + "</div></article></section>" +
    '<section class="card table-card"><header class="card-h"><h3>To\'lovlar tarixi</h3></header><div class="table-wrap"><table><thead><tr><th>Sana</th><th>A\'zo</th><th>Tarif</th><th>Summa</th><th>Usul</th><th>Holat</th></tr></thead><tbody>' + (history || '<tr><td colspan="6" class="empty">To\'lov yo\'q</td></tr>') + "</tbody></table></div></section>";
}

function pageTurnstile() {
  const openAccess = Gym.state.settings.openAccess === true;
  const faceMembers = Gym.state.members.filter((member) => openAccess ||
    (member.accessType === "face" && (memberStatus(member) === "active" || memberStatus(member) === "expiring")));
  const faceOptions = '<option value="">Kunlik mijozni tanlang</option>' + faceMembers.map((member) => '<option value="' + esc(member.id) + '">' + esc(fullName(member)) + " · " + esc(leftLabel(member)) + "</option>").join("");
  const sharedQr = '<article class="card qr-scanner"><header class="card-h"><div><h3>Umumiy zal QR kodi</h3><span>Barcha a\'zolar uchun bir xil</span></div><button type="button" class="btn sm ghost" data-action="open-user-display">Mijoz ekranini ochish</button></header><div class="shared-qr">' + qrHtml(clubAccessQrValue()) + '<p>QR-ni zalda ko\'rinadigan joyga qo\'ying. A\'zo skanerlab, telefon va admin bergan parol bilan akkauntiga kiradi.</p></div></article>';
  const faceCheckin = '<form id="face-checkin-form" class="card"><header class="card-h"><h3>Kunlik kirish · Face ID</h3></header><p class="muted">Kunlik tarif uchun NFC kerak emas. Yuzni tanish kamerasi ulanmaguncha, xodim mijozni tekshirib kirishni tasdiqlaydi.</p><label class="field">' + (openAccess ? "Kirish uchun a'zoni tanlang" : "Faol kunlik ruxsat") + '<select name="memberId" required>' + faceOptions + '</select></label><button class="btn gold" type="submit">Xodim tekshirdi — kirishni tasdiqlash</button></form>';
  const accessNotice = openAccess
    ? '<div class="access-open-notice"><b>VAQTINCHA OCHIQ REJIM</b><span>Faol a\'zolar uchun to\'lov tekshiruvi vaqtincha o\'chirilgan. Obunasi tugagan a\'zolar baribir kira olmaydi. Akkauntdan kirish uchun umumiy QR kod baribir skaner qilinadi.</span><small>Demo dastur jismoniy turniketni o\'zi boshqarmaydi.</small></div>'
    : "";
  return accessNotice + '<section class="turn-layout">' +
    '<form id="scan-form" class="card kiosk-card"><img class="logo-badge" src="assets/logo.png" alt="Tamerlan Fitness"><h3>NFC kartani tekkizing</h3><p class="muted">USB o\'quvchi kodni yozib, Enter bosadi.</p>' +
      '<p class="muted">Kirish va chiqish bitta asosiy eshikdagi turniket orqali qayd etiladi.</p>' +
      '<label class="field">Karta UID<input id="scan-uid" name="uid" class="mono big-input" autocomplete="off" placeholder="04:A1:19:C2:7E:01"></label>' +
      '<button class="btn" type="submit">Tekkizish</button>' + scanBanner(ui.lastScan) +
      '<details class="demo-cards"><summary>Sinov kartalari</summary><div class="sample-row">' + sampleButtons() + "</div></details>" +
      '<a class="btn ghost" href="#/kiosk">To\'liq ekran rejim</a></form>' +
    '<div class="stack-lg">' + sharedQr + faceCheckin + '<article class="card"><header class="card-h"><h3>Hozir zalda</h3><b>' + Gym.state.members.filter((m) => Gym.isInside(m.id)).length + '</b></header>' + insideList() + '</article>' +
      '<article class="card"><header class="card-h"><h3>Keldi-ketdi jurnali</h3></header><div class="table-wrap"><table><thead><tr><th>Vaqt</th><th>A\'zo</th><th>Yo\'nalish</th><th>Sabab</th><th>Eshik</th></tr></thead><tbody>' + logTable(Gym.state.logs.slice(0, 18)) + "</tbody></table></div></article></div></section>";
}

function pageKiosk() {
  const s = Gym.state.settings;
  return '<section class="kiosk-screen"><div class="kiosk-box"><img src="assets/logo.png" alt="Tamerlan Fitness"><p class="brand-kicker">FITNESS CLUB</p><h1>' + esc(s.clubName) + '</h1><p class="clock-line"><span data-clock>' + esc(new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })) + "</span> · " + esc(s.openTime) + "–" + esc(s.closeTime) + "</p>" +
    (s.openAccess ? '<div class="access-open-notice"><b>VAQTINCHA OCHIQ REJIM</b><span>Ro\'yxatdagi obunasi tugagan a\'zolar kira olmaydi.</span><small>Demo dastur jismoniy turniketni o\'zi boshqarmaydi.</small></div>' : "") +
    '<p class="muted">Asosiy kirish-chiqish eshigi</p><form id="kiosk-form"><input id="kiosk-uid" name="uid" class="mono" autocomplete="off" placeholder="Kartani tekkizing" autofocus><button class="btn gold" type="submit">Tekkizish</button></form>' +
    scanBanner(ui.lastScan) +
    '<details class="demo-cards"><summary>Sinov kartalari</summary><div class="sample-row">' + sampleButtons() + "</div></details>" +
    '<a class="back-link" href="#/turnstile">Admin panelga qaytish</a></div></section>';
}

function pageDisplay(status) {
  const display = status
    ? status.state === "entry"
      ? '<div class="member-display-result entry"><span class="member-display-icon">✓</span><h2>ZALGA KIRISH</h2></div>'
      : status.state === "exit"
        ? '<div class="member-display-result exit"><span class="member-display-icon">✓</span><h2>ZALDAN CHIQISH</h2></div>'
        : '<div class="member-display-result denied"><span class="member-display-icon">!</span><h2>KIRISHGA RUXSAT YO\'Q</h2><p>Qabulxonaga murojaat qiling</p></div>'
    : '<div class="member-display-wait"><span class="pulse"></span><h2>KARTANI YOKI QR KODNI SKANER QILING</h2><p>Kirish yoki chiqish holati shu ekranda ko\'rinadi</p></div>';
  return '<main class="member-display-screen"><img src="assets/logo.png" alt="Tamerlan Fitness"><p class="brand-kicker">TAMERLAN FITNESS</p>' + display + "</main>";
}

function pageReports() {
  const today = todayISO();
  const members = Gym.state.members;
  const active = members.filter((m) => memberStatus(m) === "active" || memberStatus(m) === "expiring").length;
  const inside = members.filter((m) => Gym.isInside(m.id)).length;
  const monthPay = paySum(Gym.state.payments.filter((p) => p.date.slice(0, 7) === today.slice(0, 7)));
  const tVisits = visitsOn(today);
  const yVisits = visitsOn(addDays(today, -1));
  const bars = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    const value = Math.round(paySum(Gym.state.payments.filter((p) => p.date.slice(0, 7) === key)) / 1000);
    bars.push({ label: MONTHS[d.getMonth()], value, color: i === 0 ? "#f0c14b" : "#3ce1ff" });
  }
  const hours = [];
  let peak = 0;
  let peakH = 7;
  for (let h = 7; h <= 21; h++) {
    const value = Gym.state.logs.filter((l) => l.at.slice(0, 10) === today && l.result === "ok" && l.direction === "in" && Number(l.at.slice(11, 13)) === h).length;
    if (value > peak) { peak = value; peakH = h; }
    hours.push({ label: String(h), value, color: "#7ee7ff" });
  }
  const heatDays = [];
  for (let i = 6; i >= 0; i--) heatDays.push(addDays(today, -i));
  const heatHours = [];
  for (let h = 7; h <= 21; h++) heatHours.push(h);
  let heatMax = 1;
  const heatVals = {};
  heatDays.forEach((date) => {
    heatHours.forEach((h) => {
      const value = Gym.state.logs.filter((l) => l.at.slice(0, 10) === date && l.result === "ok" && l.direction === "in" && Number(l.at.slice(11, 13)) === h).length;
      heatVals[date + "-" + h] = value;
      if (value > heatMax) heatMax = value;
    });
  });
  const heat = '<div class="heat" style="grid-template-columns:52px repeat(' + heatHours.length + ', 1fr)"><span></span>' + heatHours.map((h) => "<span>" + h + "</span>").join("") +
    heatDays.map((date) => '<span>' + weekdayLabel(date) + "</span>" + heatHours.map((h) => {
      const value = heatVals[date + "-" + h];
      const alpha = value ? (0.18 + 0.82 * (value / heatMax)).toFixed(2) : "0.08";
      return '<b style="--a:' + alpha + '" title="' + value + '"></b>';
    }).join("")).join("") + "</div>";
  const methodParts = Object.keys(METHOD_META).map((key) => ({
    label: METHOD_META[key].label,
    color: METHOD_META[key].color,
    value: Gym.state.payments.filter((p) => p.date.slice(0, 7) === today.slice(0, 7) && p.method === key).length,
  }));
  const colors = { daily: "#fb7185", halfmonth: "#f0c14b", monthly: "#3ce1ff", quarter: "#3ee0a0", sessions: "#8b7cff", vip: "#f0c14b" };
  const planParts = PLANS.map((p) => ({
    label: p.name,
    color: colors[p.id],
    value: members.filter((m) => m.planId === p.id && (memberStatus(m) === "active" || memberStatus(m) === "expiring")).length,
  }));
  const counts = {};
  Gym.state.logs.forEach((l) => {
    if (l.result === "ok" && l.direction === "in" && l.at.slice(0, 7) === today.slice(0, 7) && l.memberId) counts[l.memberId] = (counts[l.memberId] || 0) + 1;
  });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
  const topHtml = top.length ? top.map((id, index) => {
    const m = memberById(id);
    return '<div class="list-row"><span class="rank">' + (index + 1) + '</span><div class="person">' + avatar(m ? fullName(m) : "?", 32) + "<div><b>" + esc(m ? fullName(m) : id) + "</b><small>" + counts[id] + " ta kirish</small></div></div></div>";
  }).join("") : '<p class="empty">Bu oy tashrif hali yo\'q</p>';
  const diff = yVisits === 0 ? 0 : Math.round(((tVisits - yVisits) / yVisits) * 100);
  const compare = yVisits === 0 ? "Kecha tashrif yozuvi yo'q." : diff >= 0 ? "Bugungi tashrif kechagidan " + diff + "% yuqori." : "Bugungi tashrif kechagidan " + Math.abs(diff) + "% pastroq.";
  const expiring = members.filter((m) => memberStatus(m) === "expiring").length;
  const summary = compare + " Eng band soat bugun " + pad(peakH) + ":00 (" + peak + " kirish). " + expiring + " ta obuna 3 kun ichida tugaydi.";
  return '<section class="sum-grid">' +
      '<div><b>' + active + "</b><span>Faol a'zolar</span></div>" +
      '<div><b>' + tVisits + "</b><span>Bugungi tashrif</span></div>" +
      '<div><b>' + money(monthPay) + "</b><span>Shu oy tushum</span></div>" +
      '<div><b>' + inside + "</b><span>Hozir zalda</span></div></section>" +
    '<section class="grid-2"><article class="card"><header class="card-h"><h3>Oylik tushum</h3><span>ming so\'m</span></header>' + barChart(bars) + '</article><article class="card"><header class="card-h"><h3>Bugungi soatlar</h3></header>' + barChart(hours) + "</article></section>" +
    '<section class="grid-2"><article class="card"><header class="card-h"><h3>To\'lov turlari</h3></header>' + donutChart(methodParts, String(methodParts.reduce((s, p) => s + p.value, 0)), "shu oy") + '</article><article class="card"><header class="card-h"><h3>Tariflar</h3></header>' + donutChart(planParts, String(active), "faol") + "</article></section>" +
    '<section class="grid-2"><article class="card"><header class="card-h"><h3>Haftalik davomat</h3></header>' + heat + '</article><article class="card"><header class="card-h"><h3>Faol a\'zolar</h3><span>shu oy</span></header>' + topHtml + "</article></section>" +
    '<section class="card xulosa"><header class="card-h"><h3>Umumiy hisobot va xulosa</h3></header><p>' + esc(summary) + "</p></section>";
}

function pageStaff() {
  const editing = ui.staffEdit ? Gym.state.staff.find((s) => s.id === ui.staffEdit) : null;
  const roles = ["Administrator", "Trener", "Qabulxona", "Navbatchi"];
  const shifts = ["07:00-15:00", "15:00-23:00", "07:00-19:00"];
  const roleOpts = roles.map((r) => '<option' + (editing && editing.role === r ? " selected" : "") + ">" + r + "</option>").join("");
  const shiftOpts = shifts.map((r) => '<option' + (editing && editing.shift === r ? " selected" : "") + ">" + r + "</option>").join("");
  const onDuty = Gym.state.staff.filter((s) => s.active).length;
  const cards = Gym.state.staff.map((s) => '<article class="staff-card' + (s.active ? " on" : "") + '">' + avatar(s.name, 48) + '<div class="staff-meta"><b>' + esc(s.name) + "</b><small>" + esc(s.role) + " · " + esc(s.shift) + "</small><small>" + esc(s.phone) + '</small></div><div class="row-actions"><button type="button" class="btn sm ' + (s.active ? "gold" : "ghost") + '" data-action="toggle-staff" data-id="' + s.id + '">' + (s.active ? "Navbatchilikda" : "Ketgan") + '</button><button type="button" class="icon-btn" data-action="edit-staff" data-id="' + s.id + '">' + icon("edit") + '</button><button type="button" class="icon-btn danger" data-action="delete-staff" data-id="' + s.id + '">' + icon("trash") + "</button></div></article>").join("");
  return '<section class="stats slim">' +
      statCard("Navbatchilar", onDuty, Gym.state.staff.length + " ta xodim", "staff", "gold") +
      statCard("Bugungi tashrif", visitsOn(todayISO()), "Turniket jurnali", "scan", "cyan") +
      statCard("Hozir zalda", Gym.state.members.filter((m) => Gym.isInside(m.id)).length, "Ichkaridagi a'zolar", "users", "green") +
      statCard("Turniket", "1", "Asosiy kirish-chiqish", "gate", "violet") +
    "</section>" +
    '<section class="grid-2"><form id="staff-form" class="card"><header class="card-h"><h3>' + (editing ? "Xodimni tahrirlash" : "Xodim qo'shish") + "</h3></header>" +
      '<label class="field">Ism<input name="name" required value="' + esc(editing ? editing.name : "") + '"></label>' +
      '<div class="split-2"><label class="field">Lavozim<select name="role">' + roleOpts + '</select></label><label class="field">Smena<select name="shift">' + shiftOpts + "</select></label></div>" +
      '<label class="field">Telefon<input name="phone" value="' + esc(editing ? editing.phone : "") + '"></label>' +
      '<div class="actions"><button class="btn" type="submit">' + (editing ? "Saqlash" : "Qo'shish") + "</button>" + (editing ? '<button type="button" class="btn ghost" data-action="cancel-staff">Bekor</button>' : "") + "</div></form>" +
      '<div class="stack">' + cards + "</div></section>";
}

function pageMobile() {
  const current = memberById(ui.mobileId) || Gym.state.members[0];
  if (!current) return '<p class="empty">A\'zo yo\'q</p>';
  const options = Gym.state.members.map((m) => '<option value="' + m.id + '"' + (m.id === current.id ? " selected" : "") + ">" + esc(fullName(m)) + "</option>").join("");
  const visits = Gym.state.logs.filter((l) => l.memberId === current.id && l.result === "ok").slice(0, 6);
  const visitHtml = visits.length ? visits.map((l) => "<li><b>" + (l.direction === "in" ? "Kirish" : "Chiqish") + "</b><span>" + esc(formatDT(l.at)) + "</span></li>").join("") : "<li><span>Tashrif yo'q</span></li>";
  return '<section class="mobile-layout"><div><label class="field">A\'zoni tanlang<select id="mobile-member">' + options + '</select></label><div class="device"><div class="device-top"><img src="assets/logo.png" alt=""><div><small>TAMERLAN</small><b>' + esc(clubName()) + "</b></div></div>" +
    memberCardHtml(current) + progressHtml(current) + '<div class="note-box"><b>Umumiy zal QR kodi</b><span>Barcha a\'zolar bir xil QR kodni skanerlab, akkauntiga kiradi.</span></div>' + '<ul class="device-list">' + visitHtml + "</ul></div></div>" +
    '<article class="card"><header class="card-h"><h3>Mijoz kartasi</h3></header><p class="muted">Bu ko\'rinish a\'zo telefonidagi ilova. Qabulxona shu yerdan obuna va oxirgi tashriflarni tekshiradi.</p><div class="stack"><div class="list-row"><span>Telefon</span><b>' + esc(current.phone) + "</b></div><div class=\"list-row\"><span>Tarif</span><b>" + esc(planById(current.planId).name) + "</b></div><div class=\"list-row\"><span>Tugash</span><b>" + esc(formatDM(current.endDate)) + "</b></div><div class=\"list-row\"><span>NFC</span><b class=\"mono\">" + esc(current.uid) + "</b></div><div class=\"list-row\"><span>Holat</span>" + pill(memberStatus(current)) + "</div></div></article></section>";
}

function pageMemberAccount(member) {
  const plan = planById(member.planId);
  const payments = Gym.state.payments.filter((payment) => payment.memberId === member.id);
  const currentPayment = Gym.paymentForCurrentPlan(member);
  const visits = Gym.state.logs.filter((log) => log.memberId === member.id && log.result === "ok").slice(0, 10);
  const accessLabel = member.accessType === "face" ? "Kunlik · xodim tasdig'i" : member.accessType === "qr" ? "Umumiy QR" : "NFC karta";
  const paymentRows = payments.length
    ? payments.map((payment) => '<div class="list-row"><span><b>' + esc(formatDT(payment.date)) + '</b><small>' + esc(payment.description || methodLabel(payment.method)) + '</small></span><b>' + money(payment.amount) + '</b></div>').join("")
    : '<p class="empty">Hozircha to\'lovlar yo\'q. To\'lovni qabulxonada amalga oshiring.</p>';
  const visitRows = visits.length
    ? visits.map((visit) => '<div class="list-row"><span>' + (visit.direction === "in" ? "Zalga kirish" : "Zaldan chiqish") + '</span><b>' + esc(formatDT(visit.at)) + '</b></div>').join("")
    : '<p class="empty">Hozircha tashriflar yo\'q</p>';
  const address = [member.region, member.district, member.address].filter(Boolean).join(", ");
  const status = memberStatus(member);
  const inside = Gym.isInside(member.id);
  const qrReady = !!ui.accountQrReady;
  const visitControls = '<article class="card member-account-qr"><header class="card-h"><h2>Kirish va chiqish</h2><span>' + (inside ? "Hozir zal ichidasiz" : "Hozir zal tashqarisidasiz") + '</span></header><p class="muted">Umumiy zal QR kodini qurilmangiz kamerasi bilan skanerlang. QR o\'qilgach, kirish yoki chiqish amalini tanlang.</p><video id="member-qr-video" playsinline muted aria-label="Umumiy zal QR kodini skanerlash"></video><button type="button" class="btn gold" data-action="start-account-qr-camera">Kamerani ochib QR kodni skanerlash</button><div class="visit-actions"><button type="button" class="btn gold" data-action="member-visit" data-direction="in"' + (!qrReady || inside ? " disabled" : "") + '>Zalga kirish</button><button type="button" class="btn" data-action="member-visit" data-direction="out"' + (!qrReady || !inside ? " disabled" : "") + '>Zaldan chiqish</button></div><p class="muted">' + (qrReady ? "QR tasdiqlandi — kirish yoki chiqishni tanlang." : "Skanerlash uchun kamerani oching.") + '</p></article>';
  return '<section class="member-account"><header class="member-account-header"><div class="account-profile-title">' + avatar(fullName(member), 58, member.photo) + '<div><p class="brand-kicker">' + esc(clubName()) + '</p><h1>Shaxsiy akkaunt</h1><p>' + esc(fullName(member)) + ' · ' + esc(member.code) + '</p></div></div><button type="button" class="btn ghost" data-action="member-logout">Chiqish</button></header>' +
    (Gym.state.settings.openAccess ? '<div class="access-open-notice"><b>VAQTINCHA OCHIQ REJIM</b><span>Faol a\'zolar uchun to\'lov tekshiruvi vaqtincha o\'chirilgan; obunasi tugagan a\'zo kira olmaydi. Akkauntdagi umumiy QR kodni skaner qilish baribir shart.</span></div>' : "") +
    '<div class="member-account-grid"><article class="card member-account-card"><header class="card-h"><h2>Akkaunt va a\'zolik</h2>' + pill(status) + '</header><div class="account-details"><div><small>Telefon</small><b>' + esc(member.phone) + '</b></div><div><small>Email</small><b>' + esc(member.email || "Kiritilmagan") + '</b></div><div><small>Hudud</small><b>' + esc(member.region || "Kiritilmagan") + '</b></div><div><small>Tuman</small><b>' + esc(member.district || "Kiritilmagan") + '</b></div><div class="wide"><small>Uy manzili</small><b>' + esc(address || "Kiritilmagan") + '</b></div><div><small>Tarif</small><b>' + esc(plan.name) + '</b></div><div><small>A\'zolik turi</small><b>' + accessLabel + '</b></div><div><small>Obuna boshlanishi</small><b>' + esc(member.startDate ? formatDM(member.startDate) : "Admin tasdig\'ini kutmoqda") + '</b></div><div><small>Obuna tugashi</small><b>' + esc(member.endDate ? formatDM(member.endDate) : "Admin tasdig\'ini kutmoqda") + '</b></div><div><small>To\'lov holati</small><b>' + (member.registrationStatus === "pending" ? "Tasdiq kutilmoqda" : currentPayment ? "To'langan · " + money(currentPayment.amount) + " · " + formatDT(currentPayment.date) : "Joriy tarif to'lovi qayd etilmagan") + '</b></div>' + (member.accessType === "nfc" ? '<div class="wide"><small>NFC karta holati</small><b class="mono">' + esc(member.uid || "Karta buyurtmasi kutilmoqda") + '</b></div>' : "") + '</div></article>' +
    visitControls +
    '<article class="card"><header class="card-h"><h2>To\'lovlar tarixi</h2><span>' + payments.length + ' ta</span></header><div class="stack">' + paymentRows + '</div></article>' +
    '<article class="card"><header class="card-h"><h2>So\'nggi tashriflar</h2></header><div class="stack">' + visitRows + '</div></article></div></section>';
}

function pageMemberLogin() {
  return '<section class="login-wrap"><form id="member-login-form" class="card login-card"><img src="assets/logo.png" alt="Tamerlan Fitness"><h1>' + esc(clubName()) + '</h1><p>Mijoz akkauntiga kirish</p><label class="field">Telefon raqam<input name="phone" type="tel" autocomplete="username" required placeholder="+998 90 000 00 00"></label><label class="field">Parol<input name="password" type="password" autocomplete="current-password" required></label><button class="btn gold" type="submit">Akkauntga kirish</button><a class="back-link" href="#/dashboard">Administrator kirish sahifasi</a><small class="muted">Akkaunt va parolni zal administratori yaratadi. Login uchun zalning umumiy QR kodini skanerlang.</small><div class="shared-qr">' + qrHtml(clubAccessQrValue()) + '<p>Umumiy zal QR kodi · akkauntga kirish sahifasi</p></div></form></section>';
}

function pageSettings() {
  const s = Gym.state.settings;
  const bot = Gym.telegramStatus;
  const botState = !bot ? "Holat tekshirilmoqda" : !bot.telegramConfigured ? "Bot tokeni sozlanmagan" : bot.telegramOnline ? "Bot ulangan" : "Token sozlangan, bot bilan aloqa kutilmoqda";
  const botUsername = bot && bot.botUsername ? bot.botUsername : "";
  const botLink = '<a id="telegram-bot-link" class="btn sm ghost" href="' + (botUsername ? "https://t.me/" + encodeURIComponent(botUsername) : "#") + '" target="_blank" rel="noopener noreferrer"' + (botUsername ? "" : " hidden") + '>Botni ochish' + (botUsername ? " · @" + esc(botUsername) : "") + "</a>";
  return '<section class="grid-2">' +
    '<form id="settings-form" class="card"><header class="card-h"><h3>Zal ma\'lumoti</h3></header>' +
      '<label class="field">Nomi<input name="clubName" value="' + esc(s.clubName) + '"></label>' +
      '<label class="field">Telefon<input name="phone" value="' + esc(s.phone) + '"></label>' +
      '<label class="field">Manzil<input name="address" value="' + esc(s.address) + '"></label>' +
      '<div class="split-2"><label class="field">Admin<input name="adminName" value="' + esc(s.adminName) + '"></label><label class="field">Login<input name="username" maxlength="128" required value="' + esc(s.username) + '"></label></div>' +
      '<div class="split-2"><label class="field">Ochilish<input type="time" name="openTime" value="' + esc(s.openTime) + '"></label><label class="field">Yopilish<input type="time" name="closeTime" value="' + esc(s.closeTime) + '"></label></div>' +
      '<label class="field">Yo\'qolgan yoki buzilgan NFC karta (so\'m)<input type="number" min="0" step="1000" name="cardReplacementFee" value="' + esc(s.cardReplacementFee) + '"></label>' +
      '<div class="access-mode-setting"><label class="check"><input type="checkbox" name="openAccess"' + (s.openAccess ? " checked" : "") + '> Vaqtincha ochiq kirish rejimi</label><span>Faol a\'zolar uchun to\'lov tekshiruvi vaqtincha o\'chadi. Obunasi yoki mashg\'ulotlari tugagan a\'zolar barcha kirish usullarida bloklanadi. Akkauntdan kirishda umumiy QR kod baribir talab qilinadi.</span></div>' +
      '<label class="check"><input type="checkbox" name="sound"' + (s.sound !== false ? " checked" : "") + "> Turniket tovushi</label>" +
      '<button class="btn" type="submit">Saqlash</button></form>' +
    '<div class="stack-lg"><form id="pass-form" class="card"><header class="card-h"><h3>Parol</h3></header><label class="field">Joriy parol<input type="password" name="current" required></label><div class="split-2"><label class="field">Yangi<input type="password" name="next" minlength="8" required></label><label class="field">Tasdiq<input type="password" name="confirm" minlength="8" required></label></div><button class="btn ghost" type="submit">Parolni yangilash</button></form>' +
      '<article class="card"><header class="card-h"><h3>Asosiy kirish-chiqish eshigi</h3><span>1 ta turniket</span></header><p class="muted">Barcha a\'zolarning kirishi va chiqishi shu bitta eshikdagi turniketda qayd etiladi. Tarixdagi eski turniket yozuvlari ham asosiy eshik sifatida ko\'rsatiladi.</p></article>' +
      '<article class="card"><header class="card-h"><h3>Telegram eslatmalari</h3><span id="telegram-status-label">' + esc(botState) + '</span></header><p class="muted">Bot obuna tugashiga 5 kun va 2 kun qolganda, tugaydigan kuni hamda muddati o\'tgandan keyin xabar yuboradi. Eslatmalar Toshkent vaqti bilan soat 09:00 da yuboriladi. A\'zo botda /start bosib, ro\'yxatda ishlatilgan telefon raqamini o\'zi tasdiqlashi kerak.</p><p class="muted">Tokenni serverdagi .env faylida saqlang; uni dastur oynasiga, chatga yoki kodga kiritmang. Botga faqat ism va obuna holati yuboriladi.</p>' + botLink + '</article>' +
      '<article class="card"><header class="card-h"><h3>Ma\'lumot nusxasi</h3></header><p class="muted">A\'zolar, to\'lovlar va tashriflar shu kompyuterdagi SQLite bazasida saqlanadi. Ma\'lumotlarni tozalash a\'zolar, to\'lovlar, tashriflar va xodimlarni o\'chiradi; klub sozlamalari hamda admin akkaunti saqlanadi.</p><div class="actions"><button type="button" class="btn ghost" data-action="export">JSON nusxa</button><label class="btn ghost file-btn">Tiklash<input id="import-file" type="file" accept="application/json"></label><button type="button" class="btn danger" data-action="reset-demo">Barcha ma\'lumotlarni tozalash</button></div></article></div></section>';
}

function pageLogin() {
  const s = Gym.state.settings;
  return '<section class="login-wrap"><form id="login-form" class="card login-card"><img src="assets/logo.png" alt="Tamerlan Fitness"><h1>' + esc(s.clubName) + '</h1><p>Turniket va a\'zolik tizimi</p><label class="field">Login<input name="username" autocomplete="username" value="' + esc(s.username || "admin") + '" required></label><label class="field">Parol<input name="password" type="password" autocomplete="current-password" required></label><button class="btn gold" type="submit">Kirish</button><a class="btn ghost" href="#/account">Mijoz akkauntiga kirish</a><small class="muted">' + esc(s.address || "") + " · " + esc(s.phone || "") + "</small></form></section>";
}

function renderPage(name) {
  const pages = {
    dashboard: pageDashboard,
    members: pageMembers,
    "add-member": pageMembers,
    billing: pageBilling,
    turnstile: pageTurnstile,
    reports: pageReports,
    staff: pageStaff,
    mobile: pageMobile,
    settings: pageSettings,
    login: pageLogin,
    account: pageMemberLogin,
  };
  return (pages[name] || pageDashboard)();
}
