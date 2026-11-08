const PEOPLE = [
  ["Jasur", "Akmalov"],
  ["Dilshod", "Karimov"],
  ["Madina", "Tursunova"],
  ["Sardor", "Alimov"],
  ["Nilufar", "Yusupova"],
  ["Bekzod", "Rahimov"],
  ["Aziza", "Saidova"],
  ["Sherzod", "Ismoilov"],
  ["Kamola", "Abdullayeva"],
  ["Jamshid", "Ergashev"],
  ["Sevara", "Nazarova"],
  ["Bobur", "Qodirov"],
  ["Malika", "Xolmatova"],
  ["Azizbek", "Soliyev"],
  ["Dilnoza", "Mirzayeva"],
  ["Jahongir", "Toshpo'latov"],
  ["Mohira", "Karimova"],
  ["Shoxrux", "Abdullayev"],
  ["Ulug'bek", "Hamidov"],
  ["Zarina", "Valiyeva"],
  ["Farrux", "Sattorov"],
  ["Diyora", "Ergasheva"],
  ["Sanjar", "Mirzayev"],
  ["Laylo", "Qodirova"],
];

const ASSIGN = [
  { plan: "monthly", start: -12, end: 18 },
  { plan: "monthly", start: -29, end: 1 },
  { plan: "monthly", start: -28, end: 2 },
  { plan: "monthly", start: -36, end: -6 },
  { plan: "vip", start: -80, end: 285 },
  { plan: "sessions", start: -8, end: 37, left: 3 },
  { plan: "monthly", start: -10, end: 20, frozen: true },
  { plan: "quarter", start: -20, end: 70 },
  { plan: "monthly", start: -27, end: 3 },
  { plan: "sessions", start: -15, end: 30, left: 0 },
  { plan: "monthly", start: -8, end: 22 },
  { plan: "vip", start: -40, end: 325 },
  { plan: "monthly", start: -21, end: 9 },
  { plan: "monthly", start: -14, end: 16 },
  { plan: "sessions", start: -5, end: 40, left: 8 },
  { plan: "monthly", start: -23, end: 7 },
  { plan: "quarter", start: -15, end: 75 },
  { plan: "monthly", start: -19, end: 11 },
  { plan: "vip", start: -20, end: 345 },
  { plan: "monthly", start: -26, end: 4 },
  { plan: "monthly", start: -32, end: -2 },
  { plan: "monthly", start: 0, end: 30 },
  { plan: "sessions", start: -20, end: 25, left: 2 },
  { plan: "monthly", start: -17, end: 13 },
];

function defaultSettings() {
  return {
    clubName: "Tamerlan Fitness",
    phone: "+998 71 200 45 45",
    address: "Toshkent, Chilonzor tumani",
    adminName: "Administrator",
    username: "admin",
    openTime: "06:00",
    closeTime: "23:00",
    sound: true,
    openAccess: true,
    cardReplacementFee: 20000,
    gates: [{ id: "g1", name: "Asosiy kirish-chiqish", zone: "Asosiy eshik" }],
  };
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeUid(i) {
  const hex = (0xa4c000 + i * 74621).toString(16).toUpperCase().padStart(12, "0").slice(-12);
  return hex.match(/.{2}/g).join(":");
}

function makePhone(i) {
  const n = String(7000000 + i * 104729).slice(0, 7);
  return "+998 9" + (i % 8) + " " + n.slice(0, 3) + " " + n.slice(3, 5) + " " + n.slice(5, 7);
}

function stampAt(date, h, mi) {
  const at = date + "T" + pad(h) + ":" + pad(mi) + ":00";
  if (at > nowISO()) return null;
  return at;
}

function buildSeed() {
  const today = todayISO();
  const rand = mulberry32(20261108);
  const members = [];
  const payments = [];
  const logs = [];
  const methods = ["cash", "card", "click", "payme"];

  PEOPLE.forEach((person, i) => {
    const spec = ASSIGN[i];
    const plan = planById(spec.plan);
    const start = addDays(today, spec.start);
    const end = addDays(today, spec.end);
    const member = {
      id: "m" + (i + 1),
      code: "TM-" + (2401 + i),
      firstName: person[0],
      lastName: person[1],
      phone: makePhone(i + 1),
      uid: makeUid(i + 1),
      planId: plan.id,
      startDate: start,
      endDate: end,
      sessionsLeft: plan.kind === "sessions" ? spec.left : null,
      sessionsTotal: plan.kind === "sessions" ? plan.sessions : null,
      frozen: !!spec.frozen,
      accessType: "nfc",
      registrationStatus: "active",
      cardIssuedCount: 1,
      note: "",
      createdAt: start + "T09:00:00",
    };
    members.push(member);
    let payAt = start + "T" + pad(8 + (i % 6)) + ":" + pad((i * 7) % 60) + ":00";
    if (start === today && payAt > nowISO()) payAt = nowISO();
    payments.push({
      id: "p" + (i + 1),
      memberId: member.id,
      planId: plan.id,
      amount: plan.price,
      method: methods[i % 4],
      date: payAt,
    });
  });

  function addSale(member, planId, method, hour, minute) {
    const plan = planById(planId);
    if (plan.kind === "sessions") {
      member.sessionsLeft = plan.sessions;
      member.sessionsTotal = plan.sessions;
      member.startDate = today;
      member.endDate = addDays(today, plan.days);
    } else if (daysLeft(member.endDate) >= 0 && !member.frozen) {
      member.endDate = addDays(member.endDate, plan.days);
    } else {
      member.startDate = today;
      member.endDate = addDays(today, plan.days);
    }
    member.planId = plan.id;
    member.frozen = false;
    let payAt = today + "T" + pad(hour) + ":" + pad(minute) + ":00";
    if (payAt > nowISO()) payAt = nowISO();
    payments.push({
      id: "pt-" + member.id,
      memberId: member.id,
      planId,
      amount: plan.price,
      method,
      date: payAt,
    });
  }

  addSale(members[0], "monthly", "cash", 9, 20);
  addSale(members[10], "monthly", "click", 11, 5);

  for (let back = 5; back >= 1; back--) {
    const date = addDays(today, -30 * back);
    for (let i = 0; i < 8; i++) {
      const vip = back === 4 && i === 0;
      payments.push({
        id: "h-" + back + "-" + i,
        memberId: members[i].id,
        planId: vip ? "vip" : i % 5 === 0 ? "sessions" : "monthly",
        amount: vip ? 3200000 : i % 5 === 0 ? 280000 : 350000,
        method: methods[(i + back) % 4],
        date: date + "T" + pad(10 + i) + ":15:00",
      });
    }
  }

  let seq = 1;
  for (let day = 14; day >= 0; day--) {
    const date = addDays(today, -day);
    members.forEach((m) => {
      const st = memberStatus(m);
      if (st === "expired" || st === "frozen") {
        if (day === 0 && st === "expired" && rand() > 0.45) {
          const at = stampAt(date, 8 + Math.floor(rand() * 8), Math.floor(rand() * 60));
          if (!at) return;
          const reason = m.planId === "sessions" && (m.sessionsLeft || 0) <= 0 ? "Mashg'ulotlar tugagan" : "Obuna muddati tugagan";
          logs.push({
            id: "l" + seq++,
            memberId: m.id,
            uid: m.uid,
            direction: "in",
            result: "no",
            reason,
            gateId: "g1",
            at,
          });
        }
        return;
      }
      const chance = day === 0 ? 0.75 : 0.52;
      if (rand() > chance) return;
      const h = 6 + Math.floor(rand() * 12);
      const inAt = stampAt(date, h, Math.floor(rand() * 60));
      if (!inAt) return;
      logs.push({
        id: "l" + seq++,
        memberId: m.id,
        uid: m.uid,
        direction: "in",
        result: "ok",
        reason: "Kirish",
        gateId: "g1",
        at: inAt,
      });
      const leave = day === 0 ? rand() > 0.42 : true;
      if (leave) {
        const outAt = stampAt(date, Math.min(22, h + 1 + Math.floor(rand() * 3)), Math.floor(rand() * 60));
        if (outAt) {
          logs.push({
            id: "l" + seq++,
            memberId: m.id,
            uid: m.uid,
            direction: "out",
            result: "ok",
            reason: "Chiqish",
            gateId: "g1",
            at: outAt,
          });
        }
      }
    });
  }

  logs.sort((a, b) => b.at.localeCompare(a.at));

  return {
    version: 1,
    members,
    payments,
    logs,
    cardOrders: [],
    staff: [
      { id: "s1", name: "Malika Karimova", role: "Administrator", phone: "+998 90 111 22 33", shift: "07:00-15:00", active: true },
      { id: "s2", name: "Jasur Toshmatov", role: "Trener", phone: "+998 90 222 33 44", shift: "07:00-15:00", active: true },
      { id: "s3", name: "Nodira Aliyeva", role: "Trener", phone: "+998 93 333 44 55", shift: "15:00-23:00", active: true },
      { id: "s4", name: "Bekzod Saidov", role: "Qabulxona", phone: "+998 97 444 55 66", shift: "07:00-15:00", active: true },
      { id: "s5", name: "Dilshod Xolmurodov", role: "Navbatchi", phone: "+998 88 555 66 77", shift: "15:00-23:00", active: false },
    ],
    settings: defaultSettings(),
  };
}
