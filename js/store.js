const Gym = {
  state: null,
  auth: null,
  listeners: [],
  _scheduled: false,
  _ready: false,
  _saveQueue: Promise.resolve(),
  telegramStatus: null,
};

function normalizeState(data) {
  const defaults = defaultSettings();
  const incoming = data.settings || {};
  const settings = Object.assign({}, defaults, incoming);
  delete settings.password;
  settings.gates = defaults.gates;
  const members = (data.members || []).map((member) => Object.assign({
    accessType: planById(member.planId).access || "nfc",
    registrationStatus: "active",
    cardIssuedCount: member.uid ? 1 : 0,
    email: "",
    birthDate: "",
    region: "",
    district: "",
    address: "",
    accountSalt: "",
    accountPasswordHash: "",
    photo: "",
  }, member));
  members.forEach((member) => { delete member.qrToken; });
  const revokedCards = (data.revokedCards || []).slice();
  const cardOrders = (data.cardOrders || []).map((order) => Object.assign({}, order));
  cardOrders.forEach((order) => {
    if (order.status !== "pending" || !order.replacement) return;
    const member = members.find((item) => item.id === order.memberId);
    if (!member || !member.uid) return;
    order.previousUid = order.previousUid || member.uid;
    if (!revokedCards.some((card) => uidKey(card.uid) === uidKey(member.uid))) {
      revokedCards.unshift({
        uid: member.uid,
        memberId: member.id,
        revokedAt: order.createdAt || nowISO(),
        reason: "Yo'qolgan yoki buzilgan karta almashtirilmoqda",
      });
    }
    member.uid = "";
  });
  return {
    version: 1,
    members,
    payments: data.payments || [],
    logs: (data.logs || []).map((log) => Object.assign({}, log, { gateId: "g1" })),
    staff: data.staff || [],
    cardOrders,
    revokedCards,
    settings,
  };
}

Gym.save = function () {
  if (!this._ready || !this.state || !this.auth || this.auth.role !== "admin") return this._saveQueue;
  this.state = normalizeState(this.state);
  const data = JSON.stringify(this.state);
  this._saveQueue = this._saveQueue.then(async () => {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": this.auth.csrf },
      body: data,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        this.auth = null;
        this.state = normalizeState({ settings: this.state ? this.state.settings : {} });
        this._ready = false;
        this.listeners.forEach((listener) => listener());
      }
      throw new Error(result.error || "Server ma'lumotni saqlamadi");
    }
  }).catch((error) => {
    window.dispatchEvent(new CustomEvent("gym-save-error", {
      detail: { message: "Ma'lumot serverga saqlanmadi: " + error.message },
    }));
  });
  return this._saveQueue;
};

Gym.emit = function () {
  this.save();
  if (this._scheduled) return;
  this._scheduled = true;
  const self = this;
  queueMicrotask(function () {
    self._scheduled = false;
    self.listeners.forEach((fn) => fn());
  });
};

Gym.subscribe = function (fn) {
  this.listeners.push(fn);
};

Gym.init = async function () {
  const adminResponse = await fetch("/api/session?role=admin", { cache: "no-store" });
  const adminSession = await adminResponse.json();
  if (!adminResponse.ok) throw new Error(adminSession.error || "Server sessiyasini tekshirib bo'lmadi");
  if (adminSession.role === "admin") {
    this.auth = { role: "admin", csrf: adminSession.csrf };
    if (adminSession.state) {
      this.state = normalizeState(adminSession.state);
      this._ready = true;
      return;
    }
    await this.initializeAdminState(adminSession);
    return;
  }

  const memberResponse = await fetch("/api/session?role=member", { cache: "no-store" });
  const memberSession = await memberResponse.json();
  if (!memberResponse.ok) throw new Error(memberSession.error || "A'zo sessiyasini tekshirib bo'lmadi");
  if (memberSession.role === "member" && memberSession.account) {
    this.auth = { role: "member", csrf: memberSession.csrf, account: memberSession.account };
    this.setMemberAccount(memberSession.account);
    this._ready = true;
    return;
  }
  this.auth = null;
  this.state = normalizeState({ settings: adminSession.settings || memberSession.settings || {} });
  this._ready = false;
};

Gym.initializeAdminState = async function (session) {
  let data = session.state;
  if (!data) {
    let raw = null;
    try {
      raw = localStorage.getItem("tamerlan-fitness-v1");
    } catch (error) {
      throw new Error("Eski ma'lumotni o'qib bo'lmadi: " + error.message);
    }
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        throw new Error("Eski ma'lumotlar nusxasi buzilgan: " + error.message);
      }
      if (!data || !Array.isArray(data.members)) {
        throw new Error("Eski ma'lumotlar nusxasi noto'g'ri tuzilgan");
      }
    } else {
      data = {
        members: [],
        payments: [],
        logs: [],
        staff: [],
        settings: session.settings || defaultSettings(),
      };
    }
    data = normalizeState(data);
    const initializeResponse = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": this.auth.csrf },
      body: JSON.stringify(data),
    });
    if (!initializeResponse.ok && initializeResponse.status !== 409) {
      const initialized = await initializeResponse.json();
      throw new Error(initialized.error || "Ma'lumotlar bazasini boshlash amalga oshmadi");
    }
    const refreshedResponse = await fetch("/api/session?role=admin", { cache: "no-store" });
    const refreshed = await refreshedResponse.json();
    if (!refreshedResponse.ok || !refreshed.state) {
      throw new Error(refreshed.error || "Boshlang'ich ma'lumotlarni serverdan qayta o'qib bo'lmadi");
    }
    session = refreshed;
    data = refreshed.state;
  }
  if (!data || !Array.isArray(data.members)) throw new Error("Serverdan kelgan a'zolar ma'lumoti noto'g'ri");
  this.auth.csrf = session.csrf || this.auth.csrf;
  this.state = normalizeState(data);
  this._ready = true;
};

Gym.setMemberAccount = function (account) {
  this.auth = { role: "member", csrf: this.auth ? this.auth.csrf : "", account };
  this.state = normalizeState({
    members: [account.member],
    payments: account.payments,
    logs: account.logs,
    cardOrders: account.cardOrders,
    settings: account.settings,
  });
};

Gym.adminLogin = async function (username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Administrator tizimiga kirib bo'lmadi");
  this.auth = { role: "admin", csrf: result.csrf };

  const sessionResponse = await fetch("/api/session?role=admin", { cache: "no-store" });
  const session = await sessionResponse.json();
  if (!sessionResponse.ok) throw new Error(session.error || "Server ma'lumotini o'qib bo'lmadi");
  await this.initializeAdminState(session);
};

Gym.memberLogin = async function (phone, password) {
  const response = await fetch("/api/member/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Akkauntga kirib bo'lmadi");
  this.auth = { role: "member", csrf: result.csrf, account: result.account };
  this.setMemberAccount(result.account);
  this._ready = true;
};

Gym.logout = async function () {
  const role = this.auth && this.auth.role;
  if (role) {
    const response = await fetch(role === "member" ? "/api/member/logout" : "/api/logout", {
      method: "POST",
      headers: { "x-csrf-token": this.auth.csrf },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Tizimdan chiqib bo'lmadi");
  }
  this.auth = null;
  this.state = normalizeState({ settings: this.state ? this.state.settings : {} });
  this._ready = false;
};

Gym.refreshTelegramStatus = async function () {
  const response = await fetch("/api/health", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error("Telegram bot holatini tekshirib bo'lmadi");
  this.telegramStatus = result;
  return result;
};

Gym.isInside = function (id) {
  const log = this.state.logs.find((l) => l.memberId === id && l.result === "ok");
  return !!(log && log.direction === "in");
};

function memberById(id) {
  return Gym.state.members.find((m) => m.id === id) || null;
}

function expiredMembershipReason(member) {
  const plan = planById(member.planId);
  if (plan.kind === "sessions" && (member.sessionsLeft || 0) <= 0 && daysLeft(member.endDate) >= 0) {
    return "Mashg'ulotlar tugagan. Obunani yangilang — kirish taqiqlangan";
  }
  return "Obuna muddati tugagan. To'lov qiling va obunani yangilang — kirish taqiqlangan";
}

function gateName(id) {
  return "Asosiy kirish-chiqish";
}

function nextCode() {
  let max = 2400;
  Gym.state.members.forEach((m) => {
    const n = parseInt(String(m.code).replace(/\D/g, ""), 10);
    if (n > max) max = n;
  });
  return "TM-" + (max + 1);
}

Gym.addMember = function (payload) {
  const phoneKey = String(payload.phone || "").replace(/\D/g, "");
  if (phoneKey.length < 7) return { error: "Telefon raqamini to'liq kiriting" };
  if (this.state.members.some((member) => member.phone.replace(/\D/g, "") === phoneKey)) {
    return { error: "Bu telefon raqami bilan a'zo avval ro'yxatdan o'tgan" };
  }
  if (!payload.accountSalt || !payload.accountPasswordHash) {
    return { error: "A'zo akkaunti uchun kamida 8 belgili parol belgilang" };
  }
  const accessType = payload.accessType || planById(payload.planId).access || "nfc";
  const uid = accessType === "nfc" ? (normUid(payload.uid) || (payload.requestCard ? "" : randomUid())) : "";
  if (uid && this.state.members.some((m) => uidKey(m.uid) === uidKey(uid))) {
    return { error: "Bu NFC karta boshqa a'zoga biriktirilgan" };
  }
  const plan = planById(payload.planId);
  const today = todayISO();
  const member = {
    id: nid("m"),
    code: nextCode(),
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    phone: payload.phone.trim(),
    email: (payload.email || "").trim(),
    birthDate: payload.birthDate || "",
    region: (payload.region || "").trim(),
    district: (payload.district || "").trim(),
    address: (payload.address || "").trim(),
    uid,
    accountSalt: payload.accountSalt,
    accountPasswordHash: payload.accountPasswordHash,
    photo: payload.photo || "",
    accessType,
    planId: plan.id,
    startDate: today,
    endDate: addDays(today, Math.max(0, plan.days - 1)),
    sessionsLeft: plan.kind === "sessions" ? plan.sessions : null,
    sessionsTotal: plan.kind === "sessions" ? plan.sessions : null,
    frozen: false,
    registrationStatus: "active",
    cardIssuedCount: uid ? 1 : 0,
    note: (payload.note || "").trim(),
    createdAt: nowISO(),
  };
  this.state.members.unshift(member);
  if (payload.recordPayment !== false) {
    this.state.payments.unshift({
      id: nid("p"),
      memberId: member.id,
      planId: plan.id,
      amount: plan.price,
      method: payload.method || "cash",
      date: nowISO(),
    });
  }
  if (accessType === "nfc" && payload.requestCard && !uid) this.requestCard(member.id);
  this.emit();
  return member;
};

Gym.requestCard = function (memberId) {
  const member = memberById(memberId);
  if (!member) return { error: "A'zo topilmadi" };
  if (member.accessType !== "nfc") return { error: "Kunlik tarif uchun NFC karta kerak emas" };
  if (this.state.cardOrders.some((order) => order.memberId === memberId && order.status === "pending")) {
    return { error: "Bu a'zoda NFC karta buyurtmasi kutilmoqda" };
  }
  const replacement = (member.cardIssuedCount || 0) > 0;
  const oldUid = normUid(member.uid);
  if (oldUid && !this.state.revokedCards.some((card) => uidKey(card.uid) === uidKey(oldUid))) {
    this.state.revokedCards.unshift({
      uid: oldUid,
      memberId,
      revokedAt: nowISO(),
      reason: "Yo'qolgan yoki buzilgan karta almashtirilmoqda",
    });
  }
  member.uid = "";
  this.state.cardOrders.unshift({
    id: nid("co"),
    memberId,
    fee: replacement ? this.state.settings.cardReplacementFee : 0,
    replacement,
    previousUid: oldUid,
    status: "pending",
    createdAt: nowISO(),
  });
  this.emit();
  return { ok: true };
};

Gym.fulfillCardOrder = function (orderId, rawUid) {
  const order = this.state.cardOrders.find((item) => item.id === orderId && item.status === "pending");
  if (!order) return { error: "Kutilayotgan karta buyurtmasi topilmadi" };
  const member = memberById(order.memberId);
  if (!member) return { error: "Buyurtma egasi topilmadi" };
  const uid = normUid(rawUid);
  if (!uid) return { error: "Haqiqiy NFC karta UID kiriting" };
  if (this.state.members.some((item) => item.id !== member.id && uidKey(item.uid) === uidKey(uid))) {
    return { error: "Bu NFC karta boshqa a'zoga biriktirilgan" };
  }
  if (this.state.revokedCards.some((card) => uidKey(card.uid) === uidKey(uid))) {
    return { error: "Bu karta bekor qilingan. Boshqa NFC kartani kiriting" };
  }
  if (order.fee) {
    this.state.payments.unshift({
      id: nid("p"),
      memberId: member.id,
      planId: member.planId,
      amount: order.fee,
      method: "cash",
      date: nowISO(),
      description: "NFC karta almashtirish",
    });
  }
  member.uid = uid;
  member.cardIssuedCount = (member.cardIssuedCount || 0) + 1;
  order.status = "fulfilled";
  order.completedAt = nowISO();
  this.emit();
  return { ok: true };
};

Gym.updateMember = function (id, payload) {
  const member = memberById(id);
  if (!member) return { error: "A'zo topilmadi" };
  const phoneKey = String(payload.phone || "").replace(/\D/g, "");
  if (phoneKey.length < 7) return { error: "Telefon raqamini to'liq kiriting" };
  if (this.state.members.some((item) => item.id !== id && item.phone.replace(/\D/g, "") === phoneKey)) {
    return { error: "Bu telefon raqami boshqa a'zoga biriktirilgan" };
  }
  const uid = member.accessType === "face" ? "" : member.uid;
  if (member.accessType === "nfc" && payload.uid && normUid(payload.uid) !== member.uid) {
    return { error: "Kartani almashtirish uchun NFC karta buyurtmasidan foydalaning" };
  }
  member.firstName = payload.firstName.trim();
  member.lastName = payload.lastName.trim();
  member.phone = payload.phone.trim();
  member.email = (payload.email || "").trim();
  member.birthDate = payload.birthDate || "";
  member.region = (payload.region || "").trim();
  member.district = (payload.district || "").trim();
  member.address = (payload.address || "").trim();
  member.uid = uid;
  member.note = (payload.note || "").trim();
  member.frozen = !!payload.frozen;
  if (typeof payload.photo === "string") member.photo = payload.photo;
  if (payload.accountSalt && payload.accountPasswordHash) {
    member.accountSalt = payload.accountSalt;
    member.accountPasswordHash = payload.accountPasswordHash;
  }
  this.emit();
  return { ok: true };
};

Gym.memberVisit = async function (memberId, direction) {
  if (!this.auth || this.auth.role !== "member") {
    return { ok: false, reason: "A'zo akkauntiga qayta kiring" };
  }
  const response = await fetch("/api/member/visit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": this.auth.csrf },
    body: JSON.stringify({ direction }),
  });
  const result = await response.json();
  if (response.status === 401) {
    this.auth = null;
    this.state = normalizeState({ settings: this.state ? this.state.settings : {} });
    this._ready = false;
    this.listeners.forEach((listener) => listener());
  }
  if (!response.ok || !result.ok) return { ok: false, reason: result.error || "Tashrif qayd etilmadi" };
  this.auth.account = result.account;
  this.setMemberAccount(result.account);
  return result;
};

Gym.deleteMember = function (id) {
  this.state.members = this.state.members.filter((m) => m.id !== id);
  this.emit();
};

Gym.sell = function (payload) {
  const member = memberById(payload.memberId);
  if (!member) return { error: "A'zo tanlanmagan" };
  const plan = planById(payload.planId);
  const previousAccess = member.accessType;
  const today = todayISO();
  if (plan.kind === "sessions") {
    const carry = member.planId === "sessions" && daysLeft(member.endDate) >= 0 ? member.sessionsLeft || 0 : 0;
    member.sessionsLeft = carry + plan.sessions;
    member.sessionsTotal = plan.sessions;
    member.startDate = today;
    member.endDate = addDays(today, Math.max(0, plan.days - 1));
  } else {
    const open = member.registrationStatus !== "pending" && !member.frozen && daysLeft(member.endDate) >= 0 && memberStatus(member) !== "expired";
    const base = open ? member.endDate : today;
    if (!open) member.startDate = today;
    member.endDate = addDays(base, open ? plan.days : Math.max(0, plan.days - 1));
    member.sessionsLeft = null;
    member.sessionsTotal = null;
  }
  member.planId = plan.id;
  member.accessType = previousAccess === "qr" && plan.access !== "face" ? "qr" : (plan.access || "nfc");
  if (member.accessType === "face") {
    member.uid = "";
    this.state.cardOrders.forEach((order) => {
      if (order.memberId === member.id && order.status === "pending") order.status = "cancelled";
    });
  } else if (previousAccess === "face" && !member.uid) {
    this.requestCard(member.id);
  }
  member.frozen = false;
  member.registrationStatus = "active";
  this.state.payments.unshift({
    id: nid("p"),
    memberId: member.id,
    planId: plan.id,
    amount: plan.price,
    method: payload.method || "cash",
    date: nowISO(),
  });
  this.emit();
  return { ok: true, member };
};

Gym.scan = function (rawUid) {
  const raw = String(rawUid || "").trim();
  const openAccess = this.state.settings.openAccess === true;
  if (!raw) {
    return { ok: false, empty: true, title: "KUTILMOQDA", reason: "Karta UID kiriting" };
  }
  const key = uidKey(raw);
  const gateId = "g1";
  const at = nowISO();
  if (key.length < 8 && !openAccess) {
    return { ok: false, title: "RAD ETILDI", reason: "UID to'liq emas" };
  }
  const member = this.state.members.find((m) => uidKey(m.uid) === key);
  const revokedCard = this.state.revokedCards.find((card) => uidKey(card.uid) === key);
  if (!openAccess && member && member.accessType !== "nfc") {
    return { ok: false, title: "RAD ETILDI", reason: "Bu a'zo yuz orqali kirishdan foydalanadi", member, gateId };
  }
  const entry = {
    id: nid("l"),
    uid: normUid(raw) || (openAccess ? raw.slice(0, 80) : ""),
    gateId,
    at,
    memberId: member ? member.id : revokedCard ? revokedCard.memberId : null,
    direction: "in",
    result: "no",
    reason: "",
  };
  if (!member) {
    if (openAccess) {
      entry.result = "ok";
      entry.reason = "Vaqtincha ochiq rejim · ro'yxatdan o'tmagan karta";
      this.state.logs.unshift(entry);
      this.emit();
      return {
        ok: true,
        direction: "in",
        title: "VAQTINCHA KIRISH",
        reason: "Ochiq rejim yoqilgan — karta tekshiruvisiz kirishga ruxsat",
        uid: entry.uid,
        gateId: entry.gateId,
      };
    }
    entry.reason = revokedCard ? "Yo'qolgan yoki buzilgan karta bekor qilingan" : "Karta ro'yxatda yo'q";
    this.state.logs.unshift(entry);
    this.emit();
    return {
      ok: false,
      title: "RAD ETILDI",
      reason: entry.reason,
      uid: entry.uid,
      member: revokedCard ? memberById(revokedCard.memberId) : null,
      gateId: entry.gateId,
    };
  }
  const last = this.state.logs.find((l) => l.memberId === member.id && l.result === "ok");
  if (last && Date.now() - new Date(last.at).getTime() < 5000) {
    return {
      ok: last.direction === "in" || last.direction === "out",
      duplicate: true,
      direction: last.direction,
      title: "QAYTA O'QILDI",
      reason: "Shu karta hozirgina o'qilgan",
      member,
      gateId: entry.gateId,
    };
  }
  const inside = !!(last && last.direction === "in");
  if (inside) {
    entry.result = "ok";
    entry.direction = "out";
    entry.reason = "Chiqish";
    this.state.logs.unshift(entry);
    this.emit();
    return { ok: true, direction: "out", title: "CHIQISH", reason: "Yo'l ochildi", member, gateId: entry.gateId     };
  }
  const status = memberStatus(member);
  if (status === "expired") {
    entry.reason = expiredMembershipReason(member);
    this.state.logs.unshift(entry);
    this.emit();
    return { ok: false, title: "RAD ETILDI", reason: entry.reason, member, gateId: entry.gateId };
  }
  if (!openAccess && member.registrationStatus === "pending") {
    entry.reason = "Ro'yxatdan o'tish admin tasdig'ini kutmoqda";
    this.state.logs.unshift(entry);
    this.emit();
    return { ok: false, title: "RAD ETILDI", reason: entry.reason, member, gateId: entry.gateId };
  }
  if (!openAccess && member.frozen) {
    entry.reason = "Obuna muzlatilgan";
    this.state.logs.unshift(entry);
    this.emit();
    return { ok: false, title: "RAD ETILDI", reason: entry.reason, member, gateId: entry.gateId };
  }
  if (!openAccess && planById(member.planId).kind === "sessions") {
    member.sessionsLeft = Math.max(0, (member.sessionsLeft || 0) - 1);
  }
  entry.result = "ok";
  entry.direction = "in";
  entry.reason = openAccess ? "Kirish · vaqtincha ochiq rejim" : "Kirish";
  this.state.logs.unshift(entry);
  this.emit();
  return {
    ok: true,
    direction: "in",
    title: openAccess ? "VAQTINCHA KIRISH" : "KIRISH",
    reason: openAccess ? "Ochiq rejim yoqilgan — obuna tekshiruvisiz kirishga ruxsat" : "Xush kelibsiz",
    member,
    gateId: entry.gateId,
    sessionsLeft: member.sessionsLeft,
  };
};

Gym.scanFace = function (memberId) {
  const openAccess = this.state.settings.openAccess === true;
  const member = memberById(memberId);
  const gateId = "g1";
  if (!member) return { ok: false, title: "RAD ETILDI", reason: "A'zo topilmadi" };
  if (!openAccess && member.accessType !== "face") return { ok: false, title: "RAD ETILDI", reason: "Bu a'zo NFC karta bilan kiradi", member };
  const last = this.state.logs.find((log) => log.memberId === member.id && log.result === "ok");
  if (last && Date.now() - new Date(last.at).getTime() < 5000) {
    return { ok: true, duplicate: true, direction: last.direction, title: "QAYTA O'QILDI", reason: "Shu a'zo hozirgina tasdiqlandi", member, gateId };
  }
  if (last && last.direction === "in") {
    const exit = {
      id: nid("l"), uid: "", memberId: member.id, gateId,
      at: nowISO(), direction: "out", result: "ok", reason: "Chiqish · yuz xodim tomonidan tasdiqlandi",
    };
    this.state.logs.unshift(exit);
    this.emit();
    return { ok: true, direction: "out", title: "CHIQISH", reason: "Chiqish qayd etildi", member, gateId: exit.gateId };
  }
  const status = memberStatus(member);
  if (status === "expired") {
    return { ok: false, title: "RAD ETILDI", reason: expiredMembershipReason(member), member, gateId };
  }
  if (!openAccess && status !== "active" && status !== "expiring") {
    return { ok: false, title: "RAD ETILDI", reason: status === "pending" ? "To'lov admin tasdig'ini kutmoqda" : "Kunlik kirish muddati tugagan", member, gateId };
  }
  const entry = {
    id: nid("l"), uid: "", memberId: member.id, gateId,
    at: nowISO(), direction: "in", result: "ok", reason: openAccess ? "Kirish · xodim tasdiqladi, vaqtincha ochiq rejim" : "Kirish · yuz xodim tomonidan tasdiqlandi",
  };
  this.state.logs.unshift(entry);
  this.emit();
  return { ok: true, direction: "in", title: openAccess ? "VAQTINCHA KIRISH" : "KIRISH", reason: openAccess ? "Ochiq rejim yoqilgan — to'lov tekshiruvisiz kirishga ruxsat" : "Kirish qayd etildi", member, gateId: entry.gateId };
};

Gym.paymentForCurrentPlan = function (member) {
  if (!member || member.registrationStatus !== "active") return null;
  const plan = planById(member.planId);
  return this.state.payments.find((payment) =>
    payment.memberId === member.id &&
    payment.planId === plan.id &&
    payment.description !== "NFC karta almashtirish" &&
    Number(payment.amount) >= plan.price &&
    String(payment.date || "").slice(0, 10) >= String(member.startDate || "").slice(0, 10)
  ) || null;
};

Gym.saveStaff = function (payload) {
  const name = payload.name.trim();
  if (!name) return { error: "Xodim ismini kiriting" };
  if (payload.id) {
    const person = this.state.staff.find((s) => s.id === payload.id);
    if (!person) return { error: "Xodim topilmadi" };
    person.name = name;
    person.role = payload.role;
    person.phone = payload.phone.trim();
    person.shift = payload.shift;
  } else {
    this.state.staff.unshift({
      id: nid("s"),
      name,
      role: payload.role,
      phone: payload.phone.trim(),
      shift: payload.shift,
      active: true,
    });
  }
  this.emit();
  return { ok: true };
};

Gym.toggleStaff = function (id) {
  const person = this.state.staff.find((s) => s.id === id);
  if (!person) return;
  person.active = !person.active;
  this.emit();
};

Gym.deleteStaff = function (id) {
  this.state.staff = this.state.staff.filter((s) => s.id !== id);
  this.emit();
};

Gym.updateSettings = function (patch) {
  Object.assign(this.state.settings, patch);
  this.emit();
};

Gym.changePassword = async function (current, next) {
  const response = await fetch("/api/password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": this.auth ? this.auth.csrf : "" },
    body: JSON.stringify({ current, next }),
  });
  const result = await response.json();
  if (!response.ok) return { error: result.error || "Parolni yangilab bo'lmadi" };
  this.auth.csrf = result.csrf;
  return { ok: true };
};

Gym.reset = function () {
  const settings = Object.assign({}, this.state.settings);
  this.state = normalizeState({
    members: [],
    payments: [],
    logs: [],
    staff: [],
    settings,
  });
  this.emit();
};

Gym.replace = function (data) {
  this.state = normalizeState(data);
  this.emit();
};
