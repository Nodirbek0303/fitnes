const PLANS = [
  { id: "daily", name: "1 kunlik kirish", days: 1, price: 30000, kind: "period", access: "face", hint: "1 kun · yuz orqali kirish" },
  { id: "halfmonth", name: "15 kunlik obuna", days: 15, price: 300000, kind: "period", access: "nfc", hint: "15 kun · NFC karta" },
  { id: "monthly", name: "30 kunlik obuna", days: 30, price: 350000, kind: "period", access: "nfc", hint: "30 kun · NFC karta" },
  { id: "quarter", name: "Choraklik", days: 90, price: 900000, kind: "period", hint: "90 kun cheksiz kirish" },
  { id: "sessions", name: "12 mashg'ulot", days: 45, price: 280000, kind: "sessions", sessions: 12, hint: "45 kun ichida 12 kirish" },
  { id: "vip", name: "Yillik VIP", days: 365, price: 3200000, kind: "period", hint: "365 kun, VIP karta" },
];

const METHOD_META = {
  cash: { label: "Naqd", color: "#3ee0a0" },
  card: { label: "Karta", color: "#3ce1ff" },
  click: { label: "Click", color: "#f0c14b" },
  payme: { label: "Payme", color: "#8b7cff" },
};

const STATUS = {
  active: { label: "Faol", cls: "ok" },
  expiring: { label: "Tugayapti", cls: "warn" },
  expired: { label: "Tugagan", cls: "bad" },
  frozen: { label: "Muzlatilgan", cls: "ice" },
  pending: { label: "Tasdiq kutilmoqda", cls: "warn" },
};

const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function money(n) {
  const v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function nowISO() {
  const d = new Date();
  return todayISO() + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function addDays(dateStr, days) {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function daysLeft(end) {
  const a = new Date();
  a.setHours(12, 0, 0, 0);
  const b = new Date(String(end).slice(0, 10) + "T12:00:00");
  return Math.round((b - a) / 86400000);
}

function daysBetween(a, b) {
  const da = new Date(String(a).slice(0, 10) + "T12:00:00");
  const db = new Date(String(b).slice(0, 10) + "T12:00:00");
  return Math.round((db - da) / 86400000);
}

function planById(id) {
  return PLANS.find((p) => p.id === id) || PLANS[0];
}

function methodLabel(id) {
  return (METHOD_META[id] && METHOD_META[id].label) || id || "";
}

function fullName(m) {
  if (!m) return "Noma'lum a'zo";
  return (m.firstName + " " + m.lastName).trim();
}

function memberStatus(m) {
  if (!m) return "expired";
  if (m.registrationStatus === "pending") return "pending";
  if (m.frozen) return "frozen";
  const left = daysLeft(m.endDate);
  const plan = planById(m.planId);
  const noSessions = plan.kind === "sessions" && (m.sessionsLeft || 0) <= 0;
  if (left < 0 || noSessions) return "expired";
  if (left <= 3) return "expiring";
  if (plan.kind === "sessions" && (m.sessionsLeft || 0) <= 2) return "expiring";
  return "active";
}

function leftLabel(m) {
  if (m.registrationStatus === "pending") return "To'lov tasdig'i kutilmoqda";
  const plan = planById(m.planId);
  if (plan.kind === "sessions") {
    return (m.sessionsLeft || 0) + " ta mashg'ulot";
  }
  const left = daysLeft(m.endDate);
  if (left < 0) return "Muddati tugagan";
  if (left === 0) return "Bugun tugaydi";
  return left + " kun qoldi";
}

function formatDM(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d + "." + m + "." + y;
}

function formatHM(iso) {
  if (!iso) return "";
  return iso.slice(11, 16);
}

function formatDT(iso) {
  return formatDM(iso) + " " + formatHM(iso);
}

function weekdayLabel(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  return WEEKDAYS[d.getDay()];
}

function monthLabel(key) {
  const m = Number(key.slice(5, 7)) - 1;
  return MONTHS[m] + " " + key.slice(2, 4);
}

function since(iso) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "hozir";
  if (mins < 60) return mins + " daq";
  return Math.floor(mins / 60) + " soat " + (mins % 60) + " daq";
}

function uidKey(s) {
  return String(s || "").toUpperCase().replace(/[^0-9A-F]/g, "");
}

function normUid(s) {
  const hex = uidKey(s);
  if (hex.length < 8) return "";
  return hex.match(/.{1,2}/g).join(":");
}

function randomUid() {
  const bytes = new Uint8Array(6);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

function randomQrToken() {
  const bytes = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashAccountPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(salt),
    iterations: 120000,
    hash: "SHA-256",
  }, key, 256);
  return Array.from(new Uint8Array(bits)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
}
