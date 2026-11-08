"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { randomBytes, pbkdf2: pbkdf2Callback, scryptSync, timingSafeEqual } = require("node:crypto");
const { createDatabase } = require("./database");

const ROOT = __dirname;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8000;
const TASHKENT_ZONE = "Asia/Tashkent";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAMES = { admin: "gym_admin_session", member: "gym_member_session" };
const MAIN_GATE = { id: "g1", name: "Asosiy kirish-chiqish", zone: "Asosiy eshik" };
const pbkdf2 = promisify(pbkdf2Callback);
const REMINDER_DAYS = new Set([5, 2, 0, -1]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function loadEnvironment(filePath = path.join(ROOT, ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) return;
    const value = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) =>
      doubleQuoted === undefined ? singleQuoted : doubleQuoted);
    process.env[match[1]] = value;
  });
}

function tashkentDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TASHKENT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function tashkentHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TASHKENT_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour").value);
}

function daysUntil(date, today) {
  const target = Date.parse(date + "T00:00:00Z");
  const current = Date.parse(today + "T00:00:00Z");
  return Number.isFinite(target) && Number.isFinite(current)
    ? Math.round((target - current) / 86400000)
    : null;
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("998") ? digits.slice(3) : digits;
}

function validateState(state) {
  const username = state && state.settings && state.settings.username;
  return !!state &&
    typeof state === "object" &&
    Array.isArray(state.members) &&
    Array.isArray(state.payments) &&
    Array.isArray(state.logs) &&
    Array.isArray(state.staff) &&
    state.settings &&
    typeof state.settings === "object" &&
    (username === undefined || (typeof username === "string" && username.trim().length > 0 && username.length <= 128));
}

function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(String(password), salt, 64);
  return salt.toString("hex") + ":" + hash.toString("hex");
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(storedHash)) return false;
  const [saltHex, hashHex] = storedHash.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password), Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const cookies = new Map();
  String(header || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  });
  return cookies;
}

function sanitizedMember(member) {
  if (!member) return null;
  const allowedFields = [
    "id", "code", "firstName", "lastName", "phone", "email", "birthDate", "region",
    "district", "address", "planId", "startDate", "endDate", "sessionsLeft",
    "sessionsTotal", "accessType", "uid", "frozen", "registrationStatus",
    "cardIssuedCount", "photo", "note", "createdAt",
  ];
  return Object.fromEntries(allowedFields
    .filter((key) => Object.prototype.hasOwnProperty.call(member, key))
    .map((key) => [key, member[key]]));
}

function reminderText(member, daysLeft) {
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ").trim() || "A'zo";
  const endDate = String(member.endDate || "").slice(0, 10) || "sana belgilanmagan";
  if (daysLeft === 5) {
    return "Assalomu alaykum, " + name + "! Obunangiz tugashiga 5 kun qoldi (" + endDate + "). Uzluksiz kirish uchun to'lovni vaqtida yangilang.";
  }
  if (daysLeft === 2) {
    return "Assalomu alaykum, " + name + "! Obunangiz tugashiga 2 kun qoldi (" + endDate + "). Iltimos, to'lovni oldindan yangilang.";
  }
  if (daysLeft === 0) {
    return "Assalomu alaykum, " + name + "! Obunangiz bugun tugaydi. Zalga kirishda uzilish bo'lmasligi uchun bugun to'lov qiling.";
  }
  return "Assalomu alaykum, " + name + "! Obunangiz muddati o'tdi. To'lov qilmaguningizcha zalga kirish taqiqlanadi. Kirishni tiklash uchun obunani yangilang.";
}

function createRuntime(options = {}) {
  const db = createDatabase({
    dbPath: options.dbPath,
    connectionString: options.databaseUrl,
  });
  const schema = `
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_links (
      member_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      linked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_reminders (
      member_id TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_left INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      sent_at TEXT,
      last_error TEXT,
      PRIMARY KEY (member_id, end_date, days_left)
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      user_id TEXT NOT NULL,
      csrf TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at BIGINT NOT NULL
    );
  `;

  const token = options.token === undefined ? process.env.TELEGRAM_BOT_TOKEN || "" : options.token;
  const telegramFetch = options.telegramFetch || fetch;
  const webhookSecret = options.webhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const status = { configured: !!token, online: false, botUsername: "" };
  let botStopped = false;
  let botPromise = null;
  let reminderTimer = null;
  let pollOffset = 0;

  async function readState(database = db) {
    const row = await database.prepare("SELECT data FROM app_state WHERE id = 1").get();
    if (!row) return null;
    const state = JSON.parse(row.data);
    state.settings = state.settings || {};
    state.settings.gates = [MAIN_GATE];
    if (Array.isArray(state.logs)) {
      state.logs.forEach((log) => { log.gateId = MAIN_GATE.id; });
    }
    const normalized = JSON.stringify(state);
    if (normalized !== row.data) {
      await database.prepare("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1").run(
        normalized,
        new Date().toISOString(),
      );
    }
    return state;
  }

  async function rememberAdminAccount(state, database = db) {
    const username = String(state.settings.username || "admin").trim();
    const existing = await database.prepare("SELECT username, password_hash FROM admin_account WHERE id = 1").get();
    if (!existing) {
      const password = String(state.settings.password || options.adminPassword || process.env.ADMIN_PASSWORD || "");
      if (password.length < 12) throw new Error("ADMIN_PASSWORD kamida 12 belgidan iborat bo'lishi kerak");
      await database.prepare("INSERT INTO admin_account (id, username, password_hash, updated_at) VALUES (1, ?, ?, ?)").run(
        username,
        hashPassword(password),
        new Date().toISOString(),
      );
    } else if (existing.username !== username) {
      await database.prepare("UPDATE admin_account SET username = ?, updated_at = ? WHERE id = 1").run(username, new Date().toISOString());
    }
    if (Object.prototype.hasOwnProperty.call(state.settings, "password")) delete state.settings.password;
  }

  function accountSettings(state) {
    const allowedFields = [
      "clubName", "phone", "address", "adminName", "username", "openTime", "closeTime",
      "sound", "openAccess", "cardReplacementFee", "gates",
    ];
    const settings = Object.fromEntries(allowedFields
      .filter((key) => Object.prototype.hasOwnProperty.call(state.settings, key))
      .map((key) => [key, state.settings[key]]));
    return settings;
  }

  async function writeState(state, onlyIfEmpty) {
    if (!validateState(state)) {
      return { ok: false, error: "Ma'lumotlar bazasi uchun ilova ma'lumotlari noto'g'ri" };
    }
    state = JSON.parse(JSON.stringify(state));
    state.settings.gates = [MAIN_GATE];
    state.logs.forEach((log) => { log.gateId = MAIN_GATE.id; });
    try {
      await db.transaction(async (database) => {
      await rememberAdminAccount(state, database);
      const data = JSON.stringify(state);
      const updatedAt = new Date().toISOString();
      if (onlyIfEmpty) {
        await database.prepare("INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING").run(data, updatedAt);
      } else {
        await database.prepare(`
          INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
        `).run(data, updatedAt);
      }
      const savedState = await readState(database);
      const memberIds = new Set(savedState.members.map((member) => String(member.id)));
      const linkedMembers = await database.prepare("SELECT member_id FROM telegram_links").all();
      const reminderMembers = await database.prepare("SELECT DISTINCT member_id FROM telegram_reminders").all();
      const deleteLink = database.prepare("DELETE FROM telegram_links WHERE member_id = ?");
      const deleteReminders = database.prepare("DELETE FROM telegram_reminders WHERE member_id = ?");
      for (const link of linkedMembers) {
        if (memberIds.has(link.member_id)) continue;
        await deleteLink.run(link.member_id);
      }
      for (const reminder of reminderMembers) {
        if (!memberIds.has(reminder.member_id)) await deleteReminders.run(reminder.member_id);
      }
      });
      return { ok: true, state: await readState() };
    } catch (error) {
      throw error;
    }
  }

  const ready = (async () => {
    await db.exec(schema);
    const persistedState = await readState();
    if (persistedState) {
      const hasLegacyPassword = Object.prototype.hasOwnProperty.call(persistedState.settings, "password");
      const hasAdminAccount = !!(await db.prepare("SELECT 1 FROM admin_account WHERE id = 1").get());
      if (hasLegacyPassword || !hasAdminAccount) {
        await rememberAdminAccount(persistedState);
        await db.prepare("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1").run(
          JSON.stringify(persistedState),
          new Date().toISOString(),
        );
      }
    } else if (!(await db.prepare("SELECT 1 FROM admin_account WHERE id = 1").get())) {
      const password = String(options.adminPassword || process.env.ADMIN_PASSWORD || "");
      if (password.length < 12) throw new Error("Yangi bazaga ADMIN_PASSWORD (kamida 12 belgi) sozlang");
      await db.prepare("INSERT INTO admin_account (id, username, password_hash, updated_at) VALUES (1, ?, ?, ?)").run(
        options.adminUsername || process.env.ADMIN_USERNAME || "admin",
        hashPassword(password),
        new Date().toISOString(),
      );
    }
  })();

  async function createSession(response, role, userId) {
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
    await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(Date.now());
    await db.prepare("INSERT INTO auth_sessions (token, role, user_id, csrf, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      token, role, String(userId), csrf, expiresAt,
    );
    response.setHeader("set-cookie", COOKIE_NAMES[role] + "=" + token +
      "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + Math.floor(SESSION_MAX_AGE_MS / 1000) +
      (process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : ""));
    return csrf;
  }

  async function sessionFor(request, role) {
    const token = parseCookies(request.headers.cookie).get(COOKIE_NAMES[role]);
    if (!token) return null;
    const session = await db.prepare(
      "SELECT role, user_id, csrf, expires_at FROM auth_sessions WHERE token = ?",
    ).get(token);
    if (!session || session.role !== role || Number(session.expires_at) <= Date.now()) {
      if (session) await db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
      return null;
    }
    return { token, session: { role: session.role, userId: session.user_id, csrf: session.csrf } };
  }

  async function clearSession(response, request, role) {
    const current = await sessionFor(request, role);
    if (current) await db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(current.token);
    response.setHeader("set-cookie", COOKIE_NAMES[role] + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
      (process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : ""));
  }

  function sameOrigin(request) {
    if (request.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
      return parsed.protocol === forwardedProtocol + ":" &&
        parsed.host.toLowerCase() === String(request.headers.host || "").toLowerCase();
    } catch {
      return false;
    }
  }

  function validCsrf(request, session) {
    return sameOrigin(request) &&
      !!session &&
      String(request.headers["x-csrf-token"] || "") === session.csrf;
  }

  async function memberAccount(memberId) {
    const state = await readState();
    const member = state && state.members.find((item) => item.id === memberId);
    if (!member) return null;
    return {
      member: sanitizedMember(member),
      payments: state.payments.filter((payment) => payment.memberId === memberId),
      logs: state.logs.filter((log) => log.memberId === memberId),
      cardOrders: (state.cardOrders || []).filter((order) => order.memberId === memberId),
      settings: accountSettings(state),
    };
  }

  function memberSubscriptionStatus(member, today = tashkentDate()) {
    if (!member || member.registrationStatus === "pending") return "pending";
    if (member.frozen) return "frozen";
    const remaining = daysUntil(String(member.endDate || "").slice(0, 10), today);
    const sessionsExpired = member.planId === "sessions" && Number(member.sessionsLeft || 0) <= 0;
    if (remaining === null || remaining < 0 || sessionsExpired) return "expired";
    return remaining <= 3 || (member.planId === "sessions" && Number(member.sessionsLeft || 0) <= 2)
      ? "expiring"
      : "active";
  }

  function memberEntryDeniedReason(member) {
    if (member.planId === "sessions" && Number(member.sessionsLeft || 0) <= 0) {
      return "Mashg'ulotlar tugagan. Obunani yangilang — kirish taqiqlangan";
    }
    return "Obuna muddati tugagan. To'lov qiling va obunani yangilang — kirish taqiqlangan";
  }

  async function persistMemberVisit(memberId, direction) {
    const state = await readState();
    const member = state && state.members.find((item) => item.id === memberId);
    if (!member) return { ok: false, error: "A'zo topilmadi" };
    if (direction !== "in" && direction !== "out") return { ok: false, error: "Noto'g'ri kirish/chiqish amali" };
    const previousVisit = state.logs.find((log) => log.memberId === memberId && log.result === "ok");
    const inside = !!(previousVisit && previousVisit.direction === "in");
    if (direction === "in" && inside) return { ok: false, error: "Siz allaqachon zal ichidasiz" };
    if (direction === "out" && !inside) return { ok: false, error: "Chiqishdan oldin zalga kirish qayd etilmagan" };
    if (direction === "in") {
      const subscriptionStatus = memberSubscriptionStatus(member);
      if (subscriptionStatus === "expired") {
        return { ok: false, error: memberEntryDeniedReason(member) };
      }
      if (subscriptionStatus === "pending") return { ok: false, error: "To'lov admin tasdig'ini kutmoqda" };
      if (subscriptionStatus === "frozen") return { ok: false, error: "Obuna muzlatilgan" };
      if (state.settings.openAccess !== true) {
        const prices = { daily: 30000, halfmonth: 300000, monthly: 350000, quarter: 900000, sessions: 280000, vip: 3200000 };
        const requiredPrice = prices[member.planId] || prices.monthly;
        const hasPayment = state.payments.some((payment) =>
          payment.memberId === member.id &&
          payment.planId === member.planId &&
          payment.description !== "NFC karta almashtirish" &&
          Number(payment.amount) >= requiredPrice &&
          String(payment.date || "").slice(0, 10) >= String(member.startDate || "").slice(0, 10));
        if (!hasPayment) return { ok: false, error: "Joriy tarif uchun to'lov tasdig'i topilmadi" };
        if (member.planId === "sessions") {
          if (Number(member.sessionsLeft || 0) <= 0) return { ok: false, error: "Mashg'ulotlar tugagan" };
          member.sessionsLeft = Number(member.sessionsLeft) - 1;
        }
      }
    }

    const at = new Date();
    const log = {
      id: "l" + randomBytes(12).toString("hex"),
      uid: "",
      memberId,
      gateId: MAIN_GATE.id,
      at: tashkentDate(at) + "T" + new Intl.DateTimeFormat("en-GB", {
        timeZone: TASHKENT_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(at),
      direction,
      result: "ok",
      reason: direction === "in" ? "Kirish · akkaunt va umumiy QR orqali" : "Chiqish · akkaunt va umumiy QR orqali",
    };
    state.logs.unshift(log);
    const saved = await writeState(state, false);
    if (!saved.ok) return { ok: false, error: saved.error };
    return {
      ok: true,
      direction,
      log,
      reason: direction === "in" ? "Zalga kirish qayd etildi" : "Zaldan chiqish qayd etildi",
      account: await memberAccount(memberId),
    };
  }

  async function getMember(memberId) {
    const state = await readState();
    return state && state.members.find((member) => member.id === memberId) || null;
  }

  async function telegramCall(method, payload, timeoutMs = 15000) {
    const response = await telegramFetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error("Telegram " + method + " javobi muvaffaqiyatsiz (HTTP " + response.status + ")");
    }
    return result.result;
  }

  async function sendMessage(chatId, text, replyMarkup) {
    const payload = { chat_id: chatId, text };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await telegramCall("sendMessage", payload);
  }

  async function handleTelegramMessage(message) {
    if (!message || !message.chat || message.chat.type !== "private") return;
    const chatId = String(message.chat.id);
    const fromId = String(message.from && message.from.id || "");
    const text = String(message.text || "").trim();

    if (text === "/start" || text.startsWith("/start ")) {
      const existing = await db.prepare("SELECT member_id FROM telegram_links WHERE chat_id = ?").get(chatId);
      const introduction = [
        "Assalomu alaykum! Tamerlan Fitness a'zolik yordamchi botiga xush kelibsiz.",
        "",
        "Botning vazifasi — obunangiz tugashini eslatib turish. Telegram akkauntingizni a'zolik profilingizga bog'laganingizdan so'ng, obuna tugashiga 5 kun va 2 kun qolganda, tugaydigan kuni hamda muddati o'tganidan keyin eslatma yuboriladi.",
        "",
        "Ulanish uchun ro'yxatdan o'tishda administratorga bergan telefon raqamingizni pastdagi tugma orqali o'zingiz yuboring. Telefon raqami profilingiz bilan mos kelsa, akkaunt avtomatik ulanadi.",
        "",
        "Bot to'lov qabul qilmaydi, akkaunt yaratmaydi va turniketni boshqarmaydi. To'lov va profil bo'yicha zal administratoriga murojaat qiling. Buyruqlar: /help — yordam.",
      ].join("\n");
      if (existing) {
        const member = await getMember(existing.member_id);
        const greeting = member
          ? "Qayta xush kelibsiz, " + ([member.firstName, member.lastName].filter(Boolean).join(" ").trim() || "a'zo") + "!\n\nTelegram akkauntingiz profilingizga ulangan.\n\n"
          : "Qayta xush kelibsiz!\n\nTelegram akkauntingiz avvalgi a'zo profiliga ulangan.\n\n";
        await sendMessage(chatId, greeting + introduction);
        return;
      }
      await sendMessage(chatId, introduction + "\n\nA'zolik profilingizni ulash uchun telefon raqamingizni yuboring.", {
        keyboard: [[{ text: "Telefon raqamimni yuborish", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return;
    }

    if (text === "/help") {
      await sendMessage(chatId, [
        "Tamerlan Fitness botidan foydalanish:",
        "",
        "1. A'zolik akkauntini zal administratori yaratadi.",
        "2. /start bosing va o'zingizning Telegram telefon kontaktingizni yuboring.",
        "3. Bot raqamni administrator ro'yxatidagi raqam bilan tekshiradi.",
        "4. Profil ulanganidan keyin obuna tugashiga 5 kun va 2 kun qolganda, tugaydigan kuni hamda muddati o'tganidan keyin eslatma olasiz.",
        "",
        "Bot eslatma xizmati uchun. U to'lov olmaydi, a'zolik akkauntini yaratmaydi va turniketni boshqarmaydi. Raqamingiz topilmasa yoki to'lov/profil bo'yicha savol bo'lsa, zal administratoriga murojaat qiling.",
        "",
        "Buyruqlar: /start — botni boshlash va telefonni ulash; /help — shu yordam.",
      ].join("\n"));
      return;
    }

    const contact = message.contact;
    if (!contact) {
      await sendMessage(chatId, "Telefon raqamingizni ulash uchun /start bosing va “Telefon raqamimni yuborish” tugmasidan foydalaning.");
      return;
    }
    if (!contact.user_id || String(contact.user_id) !== fromId) {
      await sendMessage(chatId, "Faqat o'zingizga tegishli Telegram kontaktini yuboring.");
      return;
    }

    const key = phoneKey(contact.phone_number);
    if (!key) {
      await sendMessage(chatId, "Telefon raqamini aniqlab bo'lmadi. Qaytadan urinib ko'ring.");
      return;
    }
    const state = await readState();
    const matches = state ? state.members.filter((member) => phoneKey(member.phone) === key) : [];
    if (matches.length !== 1) {
      await sendMessage(chatId, matches.length
        ? "Bu telefon raqami bir nechta a'zoga biriktirilgan. Administrator bilan bog'laning."
        : "Bu raqam dasturda topilmadi. Administrator ro'yxatdan o'tkazgan telefon raqamini yuboring.");
      return;
    }

    const member = matches[0];
    const chatOwner = await db.prepare("SELECT member_id FROM telegram_links WHERE chat_id = ?").get(chatId);
    if (chatOwner && chatOwner.member_id !== member.id) {
      await sendMessage(chatId, "Bu Telegram akkaunti boshqa a'zoga ulangan. Administrator bilan bog'laning.");
      return;
    }
    const linkedAt = new Date().toISOString();
    await db.prepare("DELETE FROM telegram_links WHERE member_id = ?").run(member.id);
    await db.prepare("INSERT INTO telegram_links (member_id, chat_id, linked_at) VALUES (?, ?, ?)").run(member.id, chatId, linkedAt);
    await sendMessage(chatId, "Rahmat, " + ([member.firstName, member.lastName].filter(Boolean).join(" ").trim() || "a'zo") + "! Akkauntingiz ulandi. Obuna tugashidan 5 kun va 2 kun oldin, tugaydigan kuni hamda muddati o'tganidan keyin eslatma olasiz.", {
      remove_keyboard: true,
    });
  }

  async function runReminderSweep(now = new Date()) {
    if (!token || (!status.online && !process.env.VERCEL)) return { sent: 0, skipped: 0 };
    if (tashkentHour(now) < 9) return { sent: 0, skipped: 0 };
    const today = tashkentDate(now);
    const state = await readState();
    if (!state) return { sent: 0, skipped: 0 };
    let sent = 0;
    let skipped = 0;

    for (const member of state.members) {
      if (!member || member.registrationStatus === "pending" || member.frozen) continue;
      const date = String(member.endDate || "").slice(0, 10);
      const daysLeft = daysUntil(date, today);
      if (!REMINDER_DAYS.has(daysLeft)) continue;
      const link = await db.prepare("SELECT chat_id FROM telegram_links WHERE member_id = ?").get(member.id);
      if (!link) continue;

      const existing = await db.prepare(`
        SELECT status, last_attempt_at FROM telegram_reminders
        WHERE member_id = ? AND end_date = ? AND days_left = ?
      `).get(member.id, date, daysLeft);
      if (existing && existing.status === "sent") {
        skipped++;
        continue;
      }
      if (existing && existing.last_attempt_at &&
          Date.now() - Date.parse(existing.last_attempt_at) < 15 * 60 * 1000) {
        skipped++;
        continue;
      }

      const attemptedAt = new Date().toISOString();
      await db.prepare(`
        INSERT INTO telegram_reminders (member_id, end_date, days_left, status, attempts, last_attempt_at, last_error)
        VALUES (?, ?, ?, 'pending', 1, ?, NULL)
        ON CONFLICT(member_id, end_date, days_left) DO UPDATE SET
          status = 'pending',
          attempts = telegram_reminders.attempts + 1,
          last_attempt_at = excluded.last_attempt_at,
          last_error = NULL
      `).run(member.id, date, daysLeft, attemptedAt);
      try {
        await sendMessage(link.chat_id, reminderText(member, daysLeft));
        await db.prepare(`
          UPDATE telegram_reminders SET status = 'sent', sent_at = ?, last_error = NULL
          WHERE member_id = ? AND end_date = ? AND days_left = ?
        `).run(new Date().toISOString(), member.id, date, daysLeft);
        sent++;
      } catch (error) {
        await db.prepare(`
          UPDATE telegram_reminders SET last_error = ?
          WHERE member_id = ? AND end_date = ? AND days_left = ?
        `).run(error.message, member.id, date, daysLeft);
        console.error("A'zolik eslatmasi yuborilmadi (" + member.id + "): " + error.message);
      }
    }
    return { sent, skipped };
  }

  async function configureTelegramWebhook() {
    const appUrl = options.publicAppUrl || process.env.PUBLIC_APP_URL || "";
    if (!token || !webhookSecret || !appUrl) return false;
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET 1–256 belgi, faqat harf, raqam, _ yoki - bo'lishi kerak");
    }
    const webhookUrl = new URL("/api/telegram/webhook", appUrl);
    if (webhookUrl.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL HTTPS manzil bo'lishi kerak");
    }
    await telegramCall("setWebhook", {
      url: webhookUrl.toString(),
      secret_token: webhookSecret,
      allowed_updates: ["message"],
    });
    const bot = await telegramCall("getMe", {});
    status.botUsername = bot.username || "";
    status.online = true;
    return true;
  }

  async function handleTelegramWebhook(request, response) {
    if (request.method !== "POST") {
      jsonResponse(response, 405, { error: "Bu so'rov usuli qo'llab-quvvatlanmaydi" });
      return;
    }
    if (!token || !webhookSecret) {
      jsonResponse(response, 503, { error: "Telegram webhook sozlanmagan" });
      return;
    }
    const received = Buffer.from(String(request.headers["x-telegram-bot-api-secret-token"] || ""));
    const expected = Buffer.from(webhookSecret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      jsonResponse(response, 403, { error: "Webhook so'rovi tasdiqlanmadi" });
      return;
    }
    const update = await readJson(request);
    await handleTelegramMessage(update.message);
    jsonResponse(response, 200, { ok: true });
  }

  async function pollTelegram() {
    while (!botStopped) {
      try {
        if (!status.online) {
          const bot = await telegramCall("getMe", {});
          status.botUsername = bot.username || "";
          status.online = true;
          console.log("Telegram bot ishga tushdi" + (status.botUsername ? ": @" + status.botUsername : ""));
        }
        const updates = await telegramCall("getUpdates", {
          offset: pollOffset,
          timeout: 25,
          allowed_updates: ["message"],
        }, 35000);
        for (const update of updates) {
          pollOffset = Math.max(pollOffset, Number(update.update_id) + 1);
          try {
            await handleTelegramMessage(update.message);
          } catch (error) {
            console.error("Telegram xabariga ishlov berilmadi: " + error.message);
          }
        }
      } catch (error) {
        status.online = false;
        status.botUsername = "";
        console.error("Telegram bot bilan aloqa uzildi: " + error.message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  function startBackgroundTasks() {
    if (!token || botPromise || process.env.VERCEL) return;
    botStopped = false;
    botPromise = pollTelegram();
    void runReminderSweep().catch((error) => console.error("Eslatmalarni tekshirish xatosi: " + error.message));
    reminderTimer = setInterval(() => {
      void runReminderSweep().catch((error) => console.error("Eslatmalarni tekshirish xatosi: " + error.message));
    }, 60 * 1000);
    if (typeof reminderTimer.unref === "function") reminderTimer.unref();
  }

  function jsonResponse(response, statusCode, value) {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  }

  async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new Error("So'rov hajmi 32 MB dan oshdi");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("JSON ma'lumotini o'qib bo'lmadi");
    }
  }

  const dummyAdminHash = hashPassword("invalid administrator password");

  function loginAttemptKey(request, role) {
    const forwardedAddress = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const address = process.env.VERCEL && forwardedAddress
      ? forwardedAddress
      : String(request.socket && request.socket.remoteAddress || "local");
    return role + ":" + address;
  }

  async function loginAllowed(request, role) {
    const key = loginAttemptKey(request, role);
    const now = Date.now();
    await db.prepare("DELETE FROM login_attempts WHERE window_started_at < ?").run(
      now - 15 * 60 * 1000,
    );
    const attempt = await db.prepare(
      "SELECT attempts, window_started_at FROM login_attempts WHERE attempt_key = ?",
    ).get(key);
    if (!attempt || now - Number(attempt.window_started_at) >= 15 * 60 * 1000) {
      await db.prepare(`
        INSERT INTO login_attempts (attempt_key, attempts, window_started_at) VALUES (?, 1, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET attempts = 1, window_started_at = excluded.window_started_at
      `).run(key, now);
      return true;
    }
    if (Number(attempt.attempts) >= 10) return false;
    await db.prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE attempt_key = ?").run(key);
    return true;
  }

  async function handleLogin(request, response, role) {
    if (!sameOrigin(request)) {
      jsonResponse(response, 403, { error: "So'rov manbasi tasdiqlanmadi" });
      return;
    }
    if (!await loginAllowed(request, role)) {
      response.setHeader("retry-after", "900");
      jsonResponse(response, 429, { error: "Kirish urinishlari ko'p. Biroz kutib qayta urinib ko'ring." });
      return;
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      jsonResponse(response, 400, { error: "Login ma'lumotlari yaroqsiz" });
      return;
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (password.length > 256 || username.length > 128) {
      jsonResponse(response, 400, { error: "Login ma'lumotlari yaroqsiz" });
      return;
    }

    if (role === "admin") {
      const account = await db.prepare("SELECT username, password_hash FROM admin_account WHERE id = 1").get();
      const usernameMatches = !!account && username === account.username;
      const passwordMatches = verifyPassword(password, account ? account.password_hash : dummyAdminHash);
      if (!usernameMatches || !passwordMatches) {
        jsonResponse(response, 401, { error: "Login yoki parol noto'g'ri" });
        return;
      }
      await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").run(loginAttemptKey(request, role));
      const csrf = await createSession(response, "admin", "admin");
      jsonResponse(response, 200, { ok: true, role: "admin", csrf, username: account.username });
      return;
    }

    const key = phoneKey(body.phone);
    const state = await readState();
    const matches = state
      ? state.members.filter((member) => phoneKey(member.phone) === key)
      : [];
    const member = matches.length === 1 ? matches[0] : null;
    const salt = member && member.accountSalt ? String(member.accountSalt) : "invalid-member-account-salt";
    const candidate = await pbkdf2(password, salt, 120000, 32, "sha256");
    const expected = member && /^[a-f0-9]{64}$/i.test(member.accountPasswordHash || "")
      ? Buffer.from(member.accountPasswordHash, "hex")
      : Buffer.alloc(32);
    const passwordMatches = expected.length === candidate.length && timingSafeEqual(expected, candidate);
    if (!member || !passwordMatches) {
      jsonResponse(response, 401, { error: "Telefon yoki parol noto'g'ri" });
      return;
    }
    await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").run(loginAttemptKey(request, role));
    const csrf = await createSession(response, "member", member.id);
    jsonResponse(response, 200, { ok: true, role: "member", csrf, account: await memberAccount(member.id) });
  }

  async function handleRequest(request, response) {
    await ready;
    let url;
    try {
      url = new URL(request.url, "http://" + (request.headers.host || "127.0.0.1"));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("referrer-policy", "same-origin");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (!sameOrigin(request)) {
        jsonResponse(response, 403, { error: "So'rov manbasi tasdiqlanmadi" });
        return;
      }
    }
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        jsonResponse(response, 200, {
          ok: true,
          telegramConfigured: status.configured,
          telegramOnline: status.online,
          botUsername: status.botUsername,
          timezone: TASHKENT_ZONE,
          reminderDays: Array.from(REMINDER_DAYS).sort((a, b) => b - a),
        });
        return;
      }

      if (url.pathname === "/api/telegram/webhook") {
        await handleTelegramWebhook(request, response);
        return;
      }

      if (url.pathname === "/api/cron/reminders" && request.method === "GET") {
        const cronSecret = process.env.CRON_SECRET || "";
        if (cronSecret.length < 32) {
          jsonResponse(response, 503, { error: "Cron xizmati sozlanmagan" });
          return;
        }
        if (request.headers.authorization !== "Bearer " + cronSecret) {
          jsonResponse(response, 401, { error: "Cron so'rovi tasdiqlanmadi" });
          return;
        }
        const result = await runReminderSweep();
        jsonResponse(response, 200, { ok: true, ...result });
        return;
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        const role = url.searchParams.get("role") === "member" ? "member" : "admin";
        const authenticated = await sessionFor(request, role);
        const state = await readState();
        if (role === "member") {
          const account = authenticated ? await memberAccount(authenticated.session.userId) : null;
          if (authenticated && !account) await clearSession(response, request, "member");
          jsonResponse(response, 200, {
            role: account ? "member" : null,
            csrf: account ? authenticated.session.csrf : "",
            account,
            settings: account ? account.settings : state ? accountSettings(state) : null,
          });
          return;
        }
        jsonResponse(response, 200, {
          role: authenticated ? "admin" : null,
          csrf: authenticated ? authenticated.session.csrf : "",
          state: authenticated ? state : null,
          settings: state ? accountSettings(state) : {
            username: (await db.prepare("SELECT username FROM admin_account WHERE id = 1").get()).username,
          },
        });
        return;
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        if (!String(request.headers["content-type"] || "").includes("application/json")) {
          jsonResponse(response, 415, { error: "So'rov application/json bo'lishi kerak" });
          return;
        }
        await handleLogin(request, response, "admin");
        return;
      }

      if (url.pathname === "/api/member/login" && request.method === "POST") {
        if (!String(request.headers["content-type"] || "").includes("application/json")) {
          jsonResponse(response, 415, { error: "So'rov application/json bo'lishi kerak" });
          return;
        }
        await handleLogin(request, response, "member");
        return;
      }

      if (url.pathname === "/api/logout" || url.pathname === "/api/member/logout") {
        if (request.method !== "POST") {
          jsonResponse(response, 405, { error: "Bu so'rov usuli qo'llab-quvvatlanmaydi" });
          return;
        }
        const role = url.pathname === "/api/logout" ? "admin" : "member";
        const current = await sessionFor(request, role);
        if (current && !validCsrf(request, current.session)) {
          jsonResponse(response, 403, { error: "So'rov tasdiqlanmadi" });
          return;
        }
        await clearSession(response, request, role);
        jsonResponse(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        const current = await sessionFor(request, "admin");
        if (!current) {
          jsonResponse(response, 401, { error: "Administrator sifatida tizimga kiring" });
          return;
        }
        if (!validCsrf(request, current.session)) {
          jsonResponse(response, 403, { error: "So'rov tasdiqlanmadi" });
          return;
        }
        if (!String(request.headers["content-type"] || "").includes("application/json")) {
          jsonResponse(response, 415, { error: "So'rov application/json bo'lishi kerak" });
          return;
        }
        if (await readState()) {
          jsonResponse(response, 409, { error: "Ma'lumotlar bazasi allaqachon ishga tushirilgan" });
          return;
        }
        const initialState = await readJson(request);
        if (!initialState || typeof initialState !== "object" || Array.isArray(initialState)) {
          jsonResponse(response, 400, { error: "Boshlang'ich ma'lumotlar noto'g'ri" });
          return;
        }
        const result = await writeState(initialState, true);
        jsonResponse(response, result.ok ? 200 : 400, result.ok
          ? { ok: true, state: result.state, settings: accountSettings(result.state) }
          : { error: result.error });
        return;
      }

      if (url.pathname === "/api/member/visit" && request.method === "POST") {
        const current = await sessionFor(request, "member");
        if (!current) {
          jsonResponse(response, 401, { error: "Akkauntga qayta kiring" });
          return;
        }
        if (!validCsrf(request, current.session)) {
          jsonResponse(response, 403, { error: "So'rov tasdiqlanmadi" });
          return;
        }
        const body = await readJson(request);
        const result = await persistMemberVisit(current.session.userId, body.direction);
        jsonResponse(response, result.ok ? 200 : 403, result);
        return;
      }

      if (url.pathname === "/api/password" && request.method === "POST") {
        const current = await sessionFor(request, "admin");
        if (!current) {
          jsonResponse(response, 401, { error: "Administrator sifatida qayta kiring" });
          return;
        }
        if (!validCsrf(request, current.session)) {
          jsonResponse(response, 403, { error: "So'rov tasdiqlanmadi" });
          return;
        }
        const body = await readJson(request);
        const account = await db.prepare("SELECT password_hash FROM admin_account WHERE id = 1").get();
        if (!verifyPassword(body.current, account.password_hash)) {
          jsonResponse(response, 403, { error: "Joriy parol xato" });
          return;
        }
        const next = String(body.next || "");
        if (next.length < 8 || next.length > 256) {
          jsonResponse(response, 400, { error: "Yangi parol 8 va 256 belgi orasida bo'lishi kerak" });
          return;
        }
        await db.prepare("UPDATE admin_account SET password_hash = ?, updated_at = ? WHERE id = 1").run(
          hashPassword(next),
          new Date().toISOString(),
        );
        await db.prepare("DELETE FROM auth_sessions WHERE role = 'admin'").run();
        const csrf = await createSession(response, "admin", "admin");
        jsonResponse(response, 200, { ok: true, csrf });
        return;
      }

      if (url.pathname === "/api/state" && (request.method === "GET" || request.method === "PUT")) {
        const current = await sessionFor(request, "admin");
        if (!current) {
          jsonResponse(response, 401, { error: "Administrator sifatida tizimga kiring" });
          return;
        }
        if (request.method === "GET") {
          jsonResponse(response, 200, { state: await readState() });
          return;
        }
        if (!validCsrf(request, current.session)) {
          jsonResponse(response, 403, { error: "So'rov tasdiqlanmadi" });
          return;
        }
        if (!String(request.headers["content-type"] || "").includes("application/json")) {
          jsonResponse(response, 415, { error: "So'rov application/json bo'lishi kerak" });
          return;
        }
        const state = await readJson(request);
        const result = await writeState(state, false);
        jsonResponse(response, result.ok ? 200 : 400, result);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        jsonResponse(response, 404, { error: "API manzili topilmadi" });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        jsonResponse(response, 405, { error: "Bu so'rov usuli qo'llab-quvvatlanmaydi" });
        return;
      }
    } catch (error) {
      if (error.message.includes("32 MB")) {
        jsonResponse(response, 413, { error: error.message });
      } else if (error.message.startsWith("JSON ma'lumotini")) {
        jsonResponse(response, 400, { error: error.message });
      } else {
        console.error("So'rovni bajarishda xatolik: " + error.message);
        jsonResponse(response, 500, { error: "Serverda xatolik yuz berdi" });
      }
      return;
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!["/index.html"].includes(relativePath) &&
        !relativePath.startsWith("/js/") &&
        !relativePath.startsWith("/css/") &&
        !relativePath.startsWith("/assets/")) {
      response.writeHead(404).end();
      return;
    }
    const filePath = path.resolve(ROOT, "." + relativePath);
    if (!filePath.startsWith(ROOT + path.sep)) {
      response.writeHead(404).end();
      return;
    }
    fs.readFile(filePath, (error, contents) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
        return;
      }
      response.writeHead(200, {
        "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "content-length": contents.length,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    });
  }

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error("So'rov boshlanishida xatolik: " + error.message);
      if (!response.headersSent) jsonResponse(response, 500, { error: "Serverda xatolik yuz berdi" });
      else response.end();
    });
  });

  return {
    server,
    handler: handleRequest,
    ready,
    status,
    readState,
    writeState,
    handleTelegramMessage,
    runReminderSweep,
    configureTelegramWebhook,
    startBackgroundTasks,
    close() {
      botStopped = true;
      if (reminderTimer) clearInterval(reminderTimer);
      return db.close();
    },
  };
}

if (require.main === module) {
  loadEnvironment();
  const runtime = createRuntime();
  const host = DEFAULT_HOST;
  const port = Number(process.env.PORT || DEFAULT_PORT);
  runtime.ready.then(() => {
    runtime.server.listen(port, host, () => {
      console.log("Tamerlan Fitness server: http://" + host + ":" + port);
      console.log(runtime.status.configured
        ? "Telegram bot sozlangan, ulanish tekshirilmoqda."
        : "Telegram eslatmalari o'chiq. TELEGRAM_BOT_TOKEN ni .env fayliga kiriting.");
    });
    runtime.startBackgroundTasks();
  }).catch((error) => {
    console.error("Server sozlamalari yaroqsiz: " + error.message);
    process.exitCode = 1;
  });
  process.on("SIGINT", () => {
    void runtime.close();
    runtime.server.close(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void runtime.close();
    runtime.server.close(() => process.exit(0));
  });
}

module.exports = {
  createRuntime,
  daysUntil,
  phoneKey,
  reminderText,
  tashkentDate,
};
