"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pbkdf2Sync } = require("node:crypto");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createRuntime, daysUntil, phoneKey, tashkentDate } = require("../server");
const TEST_ADMIN_PASSWORD = "test-admin-password-123";

function createTestRuntime(options = {}) {
  return createRuntime({ adminPassword: TEST_ADMIN_PASSWORD, ...options });
}

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tamerlan-fitness-"));
  return {
    directory,
    dbPath: path.join(directory, "gym.sqlite3"),
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function testState(endDate = "2026-03-15") {
  return {
    members: [{
      id: "member-1",
      firstName: "Ali",
      lastName: "Valiyev",
      phone: "+998 90 123 45 67",
      planId: "monthly",
      endDate,
      registrationStatus: "active",
      frozen: false,
    }],
    payments: [],
    logs: [],
    staff: [],
    settings: {},
  };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";")[0];
}

async function loginAdmin(baseUrl) {
  const response = await fetch(baseUrl + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: TEST_ADMIN_PASSWORD }),
  });
  return { response, result: await response.json(), cookie: cookieFrom(response) };
}

test("phone matching accepts Uzbekistan numbers with or without country code", () => {
  assert.equal(phoneKey("+998 90 123 45 67"), phoneKey("90 123 45 67"));
});

test("subscription date reminders use the Uzbekistan calendar", () => {
  const morningInTashkent = new Date("2026-03-10T04:00:00.000Z");
  assert.equal(tashkentDate(morningInTashkent), "2026-03-10");
  assert.equal(daysUntil("2026-03-15", tashkentDate(morningInTashkent)), 5);
  assert.equal(daysUntil("2026-03-09", tashkentDate(morningInTashkent)), -1);
});

test("new databases reject weak administrator passwords", async (t) => {
  const temp = temporaryDatabase();
  const runtime = createRuntime({ dbPath: temp.dbPath, token: "", adminPassword: "short" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await assert.rejects(runtime.ready, /kamida 12/);
});

test("legacy multiple turnstiles migrate to one main entrance and exit", async (t) => {
  const temp = temporaryDatabase();
  const state = testState();
  state.settings.gates = [
    { id: "g1", name: "Old main gate", zone: "Entrance" },
    { id: "g2", name: "Old hall gate", zone: "Inside" },
  ];
  state.logs = [
    { id: "log-1", memberId: "member-1", gateId: "g2", direction: "in" },
    { id: "log-2", memberId: "member-1", gateId: "g1", direction: "out" },
  ];
  const seedRuntime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  await seedRuntime.ready;
  await seedRuntime.writeState(state, true);
  const legacyDb = new DatabaseSync(temp.dbPath);
  legacyDb.prepare("UPDATE app_state SET data = ? WHERE id = 1").run(JSON.stringify(state));
  legacyDb.close();
  await seedRuntime.close();

  const runtime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  const saved = await runtime.readState();
  assert.deepEqual(saved.settings.gates, [
    { id: "g1", name: "Asosiy kirish-chiqish", zone: "Asosiy eshik" },
  ]);
  assert.deepEqual(saved.logs.map((log) => log.gateId), ["g1", "g1"]);
  const db = new DatabaseSync(temp.dbPath);
  const persisted = JSON.parse(db.prepare("SELECT data FROM app_state WHERE id = 1").get().data);
  db.close();
  assert.equal(persisted.settings.gates.length, 1);
});

test("admin session protects state API and initializes state once", async (t) => {
  const temp = temporaryDatabase();
  const runtime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;
  t.after(() => new Promise((resolve) => runtime.server.close(resolve)));

  const page = await fetch(baseUrl + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Tamerlan Fitness/);

  assert.equal((await fetch(baseUrl + "/api/state")).status, 401);
  const unauthenticatedBootstrap = await fetch(baseUrl + "/api/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(testState()),
  });
  assert.equal(unauthenticatedBootstrap.status, 401);

  const login = await loginAdmin(baseUrl);
  assert.equal(login.response.status, 200);
  const headers = { cookie: login.cookie };
  const initial = await fetch(baseUrl + "/api/state", { headers });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).state, null);

  const unauthorizedUpdate = await fetch(baseUrl + "/api/state", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(testState()),
  });
  assert.equal(unauthorizedUpdate.status, 403);

  const first = await fetch(baseUrl + "/api/bootstrap", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-csrf-token": login.result.csrf },
    body: JSON.stringify(testState()),
  }).then((response) => response.json());
  assert.equal(first.state.members[0].id, "member-1");

  const duplicateBootstrap = await fetch(baseUrl + "/api/bootstrap", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-csrf-token": login.result.csrf },
    body: JSON.stringify({ ...testState(), members: [] }),
  });
  assert.equal(duplicateBootstrap.status, 409);

  const updatedState = testState("2026-04-01");
  const updated = await fetch(baseUrl + "/api/state", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json", "x-csrf-token": login.result.csrf },
    body: JSON.stringify(updatedState),
  }).then((response) => response.json());
  assert.equal(updated.state.members[0].endDate, "2026-04-01");
  assert.equal(Object.prototype.hasOwnProperty.call(updated.state.settings, "password"), false);
});

test("admin can initialize an empty club without demo members or revenue", async (t) => {
  const temp = temporaryDatabase();
  const runtime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + runtime.server.address().port;
  t.after(() => new Promise((resolve) => runtime.server.close(resolve)));

  const login = await loginAdmin(baseUrl);
  const response = await fetch(baseUrl + "/api/bootstrap", {
    method: "POST",
    headers: {
      cookie: login.cookie,
      "content-type": "application/json",
      "x-csrf-token": login.result.csrf,
    },
    body: JSON.stringify({ members: [], payments: [], logs: [], staff: [], settings: {} }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.state.members.length, 0);
  assert.equal(result.state.payments.length, 0);
  assert.equal(result.state.logs.length, 0);
  assert.equal(result.state.staff.length, 0);
});

test("member login is isolated to the member account and visits require its session", async (t) => {
  const temp = temporaryDatabase();
  const runtime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + runtime.server.address().port;
  t.after(() => new Promise((resolve) => runtime.server.close(resolve)));

  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const salt = "member-test-salt";
  const state = testState(endDate);
  Object.assign(state.members[0], {
    accountSalt: salt,
    accountPasswordHash: pbkdf2Sync("member-pass", salt, 120000, 32, "sha256").toString("hex"),
    startDate: new Date().toISOString().slice(0, 10),
    internalSecret: "must-not-be-returned",
  });
  state.members.push({ id: "member-2", phone: "+998 91 987 65 43", accountPasswordHash: "other-hash" });
  state.payments.push({ id: "payment-2", memberId: "member-2", amount: 999999 });
  state.logs.push({ id: "log-2", memberId: "member-2", result: "ok", direction: "in" });
  state.settings.openAccess = true;
  runtime.writeState(state, true);

  assert.equal((await fetch(baseUrl + "/api/state")).status, 401);
  const loginResponse = await fetch(baseUrl + "/api/member/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "+998 90 123 45 67", password: "member-pass" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const headers = { cookie: cookieFrom(loginResponse) };
  assert.equal(login.account.member.id, "member-1");
  assert.equal(Object.prototype.hasOwnProperty.call(login.account.member, "accountPasswordHash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(login.account.member, "internalSecret"), false);
  assert.equal(login.account.payments.some((payment) => payment.memberId !== "member-1"), false);
  assert.equal(login.account.logs.some((entry) => entry.memberId !== "member-1"), false);
  assert.equal((await fetch(baseUrl + "/api/state", { headers })).status, 401);

  const missingCsrf = await fetch(baseUrl + "/api/member/visit", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ direction: "in" }),
  });
  assert.equal(missingCsrf.status, 403);

  const visit = await fetch(baseUrl + "/api/member/visit", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-csrf-token": login.csrf },
    body: JSON.stringify({ direction: "in" }),
  });
  assert.equal(visit.status, 200);
  const visitResult = await visit.json();
  assert.equal(visitResult.ok, true);
  assert.equal(visitResult.account.logs.length, 1);
  assert.equal(visitResult.account.logs[0].memberId, "member-1");
});

test("legacy plaintext administrator password migrates into a hash", async (t) => {
  const temp = temporaryDatabase();
  const legacyState = testState();
  legacyState.settings = { username: "legacy-admin", password: "legacy-password" };
  const legacyDb = new DatabaseSync(temp.dbPath);
  legacyDb.exec(`
    CREATE TABLE app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb.prepare("INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)").run(
    JSON.stringify(legacyState),
    new Date().toISOString(),
  );
  legacyDb.close();

  const runtime = createTestRuntime({ dbPath: temp.dbPath, token: "" });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + runtime.server.address().port;
  t.after(() => new Promise((resolve) => runtime.server.close(resolve)));

  const loginResponse = await fetch(baseUrl + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "legacy-admin", password: "legacy-password" }),
  });
  assert.equal(loginResponse.status, 200);
  const sessionResponse = await fetch(baseUrl + "/api/session?role=admin", {
    headers: { cookie: cookieFrom(loginResponse) },
  });
  const session = await sessionResponse.json();
  assert.equal(Object.prototype.hasOwnProperty.call(session.state.settings, "password"), false);
  const db = new DatabaseSync(temp.dbPath);
  const account = db.prepare("SELECT password_hash FROM admin_account WHERE id = 1").get();
  db.close();
  assert.equal(account.password_hash.includes("legacy-password"), false);
});

test("bot links only a member's own registered phone contact", async (t) => {
  const temp = temporaryDatabase();
  const sentMessages = [];
  const runtime = createTestRuntime({
    dbPath: temp.dbPath,
    token: "test-token",
    telegramFetch: async (url, options) => {
      const method = new URL(url).pathname.split("/").pop();
      const payload = JSON.parse(options.body);
      if (method === "sendMessage") sentMessages.push(payload);
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await runtime.writeState(testState(), true);

  await runtime.handleTelegramMessage({
    chat: { id: 501, type: "private" },
    from: { id: 501 },
    text: "/start",
  });
  assert.equal(sentMessages[0].reply_markup.keyboard[0][0].request_contact, true);
  assert.match(sentMessages[0].text, /Assalomu alaykum/);
  assert.match(sentMessages[0].text, /5 kun va 2 kun/);
  assert.match(sentMessages[0].text, /Bot to'lov qabul qilmaydi/);

  await runtime.handleTelegramMessage({
    chat: { id: 501, type: "private" },
    from: { id: 501 },
    text: "/help",
  });
  assert.match(sentMessages[1].text, /Tamerlan Fitness botidan foydalanish/);
  assert.match(sentMessages[1].text, /turniketni boshqarmaydi/);

  await runtime.handleTelegramMessage({
    chat: { id: 501, type: "private" },
    from: { id: 501 },
    contact: { user_id: 999, phone_number: "+998901234567" },
  });
  const db = new DatabaseSync(temp.dbPath);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM telegram_links").get().count, 0);
  db.close();

  await runtime.handleTelegramMessage({
    chat: { id: 501, type: "private" },
    from: { id: 501 },
    contact: { user_id: 501, phone_number: "+998901234567" },
  });
  const verifyDb = new DatabaseSync(temp.dbPath);
  const link = verifyDb.prepare("SELECT member_id, chat_id FROM telegram_links").get();
  verifyDb.close();
  assert.equal(link.member_id, "member-1");
  assert.equal(link.chat_id, "501");
  assert.match(sentMessages[sentMessages.length - 1].text, /Akkauntingiz ulandi/);
});

test("bot explains its purpose and signup process when a new user starts it", async (t) => {
  const temp = temporaryDatabase();
  const sentMessages = [];
  const runtime = createTestRuntime({
    dbPath: temp.dbPath,
    token: "test-token",
    telegramFetch: async (url, options) => {
      if (new URL(url).pathname.endsWith("/sendMessage")) sentMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;

  await runtime.handleTelegramMessage({
    chat: { id: 700, type: "private" },
    from: { id: 700 },
    text: "/start",
  });
  assert.match(sentMessages[0].text, /Assalomu alaykum/);
  assert.match(sentMessages[0].text, /5 kun va 2 kun/);
  assert.match(sentMessages[0].text, /telefon raqamingizni/);
  assert.match(sentMessages[0].text, /turniketni boshqarmaydi/);
  assert.equal(sentMessages[0].reply_markup.keyboard[0][0].request_contact, true);
});

test("Telegram webhook requires its secret and processes valid updates", async (t) => {
  const temp = temporaryDatabase();
  const sentMessages = [];
  const secret = "telegram_webhook_secret-test_123";
  const runtime = createTestRuntime({
    dbPath: temp.dbPath,
    token: "test-token",
    webhookSecret: secret,
    telegramFetch: async (url, options) => {
      if (new URL(url).pathname.endsWith("/sendMessage")) sentMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => runtime.server.close(resolve)));
  const baseUrl = "http://127.0.0.1:" + runtime.server.address().port;
  const update = JSON.stringify({
    update_id: 1,
    message: { chat: { id: 700, type: "private" }, from: { id: 700 }, text: "/start" },
  });

  const rejected = await fetch(baseUrl + "/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" },
    body: update,
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(baseUrl + "/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: update,
  });
  assert.equal(accepted.status, 200);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Assalomu alaykum/);
});

test("subscription reminders send at five, two, zero, and one day overdue only once", async (t) => {
  const temp = temporaryDatabase();
  const sentMessages = [];
  const runtime = createTestRuntime({
    dbPath: temp.dbPath,
    token: "test-token",
    telegramFetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      if (new URL(url).pathname.endsWith("/sendMessage")) sentMessages.push(payload.text);
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  });
  t.after(async () => {
    await runtime.close();
    temp.cleanup();
  });
  await runtime.ready;
  await runtime.writeState(testState(), true);
  runtime.status.online = true;
  const db = new DatabaseSync(temp.dbPath);
  db.prepare("INSERT INTO telegram_links (member_id, chat_id, linked_at) VALUES (?, ?, ?)").run("member-1", "501", new Date().toISOString());

  await runtime.runReminderSweep(new Date("2026-03-10T04:00:00.000Z"));
  await runtime.runReminderSweep(new Date("2026-03-10T04:01:00.000Z"));
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /5 kun qoldi/);

  const member = testState().members[0];
  for (const [endDate, day, expected] of [
    ["2026-03-12", "2026-03-10", /2 kun qoldi/],
    ["2026-03-10", "2026-03-10", /bugun tugaydi/],
    ["2026-03-09", "2026-03-10", /kirish taqiqlanadi/],
  ]) {
    member.endDate = endDate;
    await runtime.writeState({ ...testState(endDate), members: [member] }, false);
    await runtime.runReminderSweep(new Date(day + "T04:00:00.000Z"));
    assert.match(sentMessages[sentMessages.length - 1], expected);
  }
  assert.equal(sentMessages.length, 4);
  db.close();
});
