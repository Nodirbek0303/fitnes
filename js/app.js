const ui = {
  editId: null,
  staffEdit: null,
  billMember: "",
  billPlan: "monthly",
  filter: "all",
  q: "",
  lastScan: null,
  mobileId: "",
  cardOrderId: "",
  displayStatus: null,
  accountQrReady: false,
};

const DISPLAY_STATUS_KEY = "tamerlan-fitness-display-status";
const DISPLAY_CHANNEL_NAME = "tamerlan-fitness-member-display-v1";
const PAGE_META = {
  dashboard: ["Boshqaruv paneli", "Klub faoliyati bo'yicha qisqa ma'lumot"],
  members: ["A'zolar", "A'zolik va NFC kartalarni boshqaring"],
  "add-member": ["Yangi a'zo qo'shish", "A'zoni va uning akkauntini yarating"],
  billing: ["To'lovlar", "Obunalarni yangilang va to'lovlarni kuzating"],
  turnstile: ["Turniket", "Kirish-chiqish nazorati va tashriflar jurnali"],
  reports: ["Hisobotlar", "Davomat va tushum tahlili"],
  staff: ["Xodimlar", "Jamoa va navbatchilik jadvali"],
  mobile: ["Mijoz kartasi", "A'zo ilovasi ko'rinishini tekshiring"],
  settings: ["Sozlamalar", "Klub, turniket va ma'lumotlar boshqaruvi"],
};
const BACKUP_ROUTE = {
  dashboard: "dashboard",
  members: "dashboard",
  "add-member": "members",
  billing: "dashboard",
  turnstile: "dashboard",
  reports: "dashboard",
  staff: "dashboard",
  mobile: "members",
  settings: "dashboard",
};

let focusAfterRender = "";
let toastTimer = 0;
let adminRouteHistory = [];
let skipAdminRouteHistory = false;
let qrCameraStream = null;
let qrCameraFrame = 0;
let qrCameraActive = false;
let displayChannel = null;
let displayStatusTimer = 0;

function isAuthenticated() {
  return !!(Gym.auth && Gym.auth.role === "admin");
}

function currentMember() {
  return Gym.auth && Gym.auth.role === "member"
    ? Gym.state.members.find((member) => member.id === Gym.auth.account.member.id) || null
    : null;
}

function currentRoute() {
  return (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
}

function goBack() {
  const current = currentRoute();
  const previous = adminRouteHistory.length > 1
    ? adminRouteHistory[adminRouteHistory.length - 2]
    : BACKUP_ROUTE[current] || "dashboard";
  if (previous === current) return;
  if (adminRouteHistory.length > 1) {
    adminRouteHistory.pop();
    skipAdminRouteHistory = true;
  }
  location.hash = "#/" + previous;
}

function trackAdminRoute() {
  const route = currentRoute();
  if (!Object.prototype.hasOwnProperty.call(PAGE_META, route)) return;
  if (skipAdminRouteHistory) {
    skipAdminRouteHistory = false;
    return;
  }
  if (adminRouteHistory[adminRouteHistory.length - 1] === route) return;
  if (adminRouteHistory.length > 1 && adminRouteHistory[adminRouteHistory.length - 2] === route) {
    adminRouteHistory.pop();
    return;
  }
  adminRouteHistory.push(route);
}

function showToast(message, kind) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = "toast show" + (kind ? " " + kind : "");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function showStartupError(error) {
  const root = document.getElementById("app");
  if (!root) return;
  let hasLegacyData = false;
  let legacyStorageError = "";
  try {
    hasLegacyData = !!localStorage.getItem("tamerlan-fitness-v1");
  } catch (storageError) {
    legacyStorageError = '<small class="muted">Eski nusxani tekshirib bo\'lmadi: ' + esc(storageError.message) + "</small>";
  }
  root.innerHTML = '<section class="login-wrap"><article class="card login-card"><h1>Server bilan ulanish yo\'q</h1><p>Dastur ma\'lumotlari xavfsiz saqlanishi uchun uni server orqali ishga tushiring.</p><p class="hint">Windows papkasidagi start.bat faylini ishga tushiring, so\'ng http://127.0.0.1:8000 manzilini oching.</p><p class="muted">' + esc(error.message || "Noma'lum server xatosi") + "</p>" + (hasLegacyData ? '<button class="btn ghost" type="button" data-action="export-legacy-backup">Eski ma\'lumotlar nusxasini yuklab olish</button><small class="muted">Server ishga tushgach, Sozlamalar bo\'limidan bu JSON nusxani tiklang.</small>' : "") + legacyStorageError + "</article></section>";
}

function updateTelegramStatusUI() {
  const status = Gym.telegramStatus;
  const label = document.getElementById("telegram-status-label");
  if (label) {
    label.textContent = !status ? "Holat tekshirilmoqda"
      : !status.telegramConfigured ? "Bot tokeni sozlanmagan"
      : status.telegramOnline ? "Bot ulangan"
      : "Token sozlangan, bot bilan aloqa kutilmoqda";
  }
  const link = document.getElementById("telegram-bot-link");
  if (link && status && status.botUsername) {
    link.href = "https://t.me/" + encodeURIComponent(status.botUsername);
    link.textContent = "Botni ochish · @" + status.botUsername;
    link.hidden = false;
  }
}

function requestFocus(selector) {
  focusAfterRender = selector;
}

function navItem(route, label, iconName) {
  return '<a class="nav-link' + (currentRoute() === route ? " active" : "") + '" href="#/' + route + '">' +
    icon(iconName) + "<span>" + label + "</span></a>";
}

function renderShell(route) {
  const meta = PAGE_META[route] || PAGE_META.dashboard;
  const search = route === "members"
    ? '<label class="global-search">' + icon("search") + '<input id="member-search" type="search" placeholder="A\'zoni qidirish..." value="' + esc(ui.q) + '" aria-label="A’zolarni qidirish"></label>'
    : "";
  return '<div class="app-shell">' +
    '<aside class="sidebar"><a class="brand" href="#/dashboard"><img src="assets/logo.png" alt=""><span><b>' + esc(clubName()) + '</b><small>FITNESS MANAGEMENT</small></span></a>' +
      '<div class="nav-caption">MENYU</div><nav class="main-nav">' +
        navItem("dashboard", "Bosh sahifa", "dashboard") +
        navItem("members", "A'zolar", "users") +
        navItem("billing", "To'lovlar", "card") +
        navItem("turnstile", "Turniket", "gate") +
        navItem("reports", "Hisobotlar", "chart") +
        navItem("staff", "Xodimlar", "staff") +
        navItem("mobile", "Mijoz kartasi", "phone") +
      '</nav><div class="nav-caption nav-caption-bottom">TIZIM</div><nav class="main-nav">' +
        navItem("settings", "Sozlamalar", "settings") +
      '</nav><div class="sidebar-foot"><span class="online-dot"></span><span>Tizim ishlayapti</span></div></aside>' +
    '<div class="main-area"><header class="topbar"><div class="topbar-heading"><button class="btn sm ghost back-button" type="button" data-action="back" aria-label="Oldingi panelga qaytish">' + icon("back") + '<span>Orqaga</span></button><button class="mobile-menu icon-btn" type="button" aria-label="Menyuni ochish" data-action="toggle-menu">' + icon("menu") + '</button><div><h1>' + meta[0] + '</h1><p>' + meta[1] + "</p></div></div>" +
      '<div class="topbar-tools">' + search + '<span class="today-label">' + esc(formatDM(todayISO())) + '</span><button type="button" class="user-menu" data-action="logout" title="Tizimdan chiqish">' + avatar(Gym.state.settings.adminName || "Admin", 36) + '<span><b>' + esc(Gym.state.settings.adminName || "Administrator") + '</b><small>Administrator</small></span>' + icon("logout") + "</button></div></header>" +
      '<main id="page-content" class="page-content">' + renderPage(route) + "</main>" +
      '<footer class="app-footer"><span>' + esc(clubName()) + '</span><span>Fitness management · Local mode</span></footer></div></div>';
}

function render() {
  const root = document.getElementById("app");
  if (!root || !Gym.state) return;
  const route = currentRoute();

  if (Gym.auth && Gym.auth.role === "member") {
    if (route !== "account") location.hash = "#/account";
    const member = currentMember();
    root.innerHTML = member ? pageMemberAccount(member) : pageMemberLogin();
  } else if (route === "account" || route === "register") {
    if (isAuthenticated()) {
      location.hash = "#/dashboard";
      root.innerHTML = renderShell("dashboard");
    } else {
      root.innerHTML = pageMemberLogin();
    }
  } else if (!isAuthenticated()) {
    root.innerHTML = pageLogin();
  } else if (route === "display") {
    root.innerHTML = pageDisplay(ui.displayStatus);
  } else if (route === "kiosk") {
    root.innerHTML = pageKiosk();
  } else {
    const page = Object.prototype.hasOwnProperty.call(PAGE_META, route) ? route : "dashboard";
    if (page !== route) location.hash = "#/" + page;
    root.innerHTML = renderShell(page);
  }

  if (focusAfterRender) {
    const target = root.querySelector(focusAfterRender);
    if (target) {
      target.focus();
      if (typeof target.setSelectionRange === "function") {
        const end = target.value.length;
        target.setSelectionRange(end, end);
      }
    }
    focusAfterRender = "";
  } else if (route === "turnstile" && isAuthenticated()) {
    const input = root.querySelector("#scan-uid");
    if (input) input.focus();
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function handleScan(form) {
  const values = formValues(form);
  const result = Gym.scan(values.uid);
  ui.lastScan = result.empty ? null : result;
  if (!result.empty) publishDisplayStatus(result);
  render();
  requestAnimationFrame(() => {
    const input = document.querySelector(currentRoute() === "kiosk" ? "#kiosk-uid" : "#scan-uid");
    if (input) {
      input.value = "";
      input.focus();
    }
  });
  if (result.ok && !result.duplicate && Gym.state.settings.sound) playScanTone();
}

function stopQrCamera() {
  qrCameraActive = false;
  if (qrCameraFrame) cancelAnimationFrame(qrCameraFrame);
  qrCameraFrame = 0;
  if (qrCameraStream) qrCameraStream.getTracks().forEach((track) => track.stop());
  const video = document.getElementById("qr-video") || document.getElementById("member-qr-video");
  if (video) video.classList.remove("active");
  qrCameraStream = null;
}

function handleAccountClubQr(token) {
  if (String(token || "").trim() !== clubAccessQrValue()) {
    ui.accountQrReady = false;
    showToast("Bu QR zalning umumiy kodi emas. Kamerani qayta ochib, to'g'ri kodni skanerlang.", "error");
    render();
    return;
  }
  ui.accountQrReady = true;
  showToast("Umumiy zal QR kodi tasdiqlandi");
  render();
}

function setDisplayStatus(status) {
  if (!status || !["entry", "exit", "denied"].includes(status.state) || !Number.isFinite(status.at)) return;
  if (Date.now() - status.at > 10000) return;
  ui.displayStatus = status;
  window.clearTimeout(displayStatusTimer);
  if (currentRoute() === "display") render();
  displayStatusTimer = window.setTimeout(() => {
    ui.displayStatus = null;
    if (currentRoute() === "display") render();
  }, 8000);
}

function publishDisplayStatus(result) {
  const status = {
    state: result.ok ? (result.direction === "out" ? "exit" : "entry") : "denied",
    at: Date.now(),
  };
  let storageError = null;
  try {
    localStorage.setItem(DISPLAY_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    storageError = error;
  }
  if (displayChannel) displayChannel.postMessage(status);
  if (storageError) showToast("Mijoz ekraniga holat yuborilmadi: " + storageError.message, "error");
}

async function startQrCamera(purpose) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Bu brauzer kamera orqali QR skanerlashni qo'llamaydi. Qo'llab-quvvatlanadigan brauzerda va HTTPS saytida oching.", "error");
    return;
  }
  const accountScan = purpose === "account";
  const video = document.getElementById(accountScan ? "member-qr-video" : "qr-video");
  if (!video) {
    showToast("QR kamera oynasi topilmadi", "error");
    return;
  }
  try {
    stopQrCamera();
    const supported = await window.BarcodeDetector.getSupportedFormats();
    if (!supported.includes("qr_code")) {
      showToast("Bu brauzer QR formatini kamera orqali o'qiy olmaydi. Boshqa brauzerda urinib ko'ring.", "error");
      return;
    }
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    qrCameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    video.srcObject = qrCameraStream;
    video.classList.add("active");
    await video.play();
    qrCameraActive = true;
    showToast("QR kodni kamera oldiga tuting");
    const detect = async () => {
      if (!qrCameraActive || !video.videoWidth) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) {
          const value = codes[0].rawValue;
          stopQrCamera();
          if (accountScan) handleAccountClubQr(value);
          return;
        }
      } catch (error) {
        stopQrCamera();
        showToast("Kamera QR kodini o'qiy olmadi: " + error.message, "error");
        return;
      }
      qrCameraFrame = requestAnimationFrame(detect);
    };
    qrCameraFrame = requestAnimationFrame(detect);
  } catch (error) {
    stopQrCamera();
    showToast("QR kamerani ishga tushirib bo'lmadi: " + error.message, "error");
  }
}

function playScanTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.06, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  oscillator.onended = () => context.close();
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const values = formValues(form);

  switch (form.id) {
    case "login-form":
      try {
        await Gym.adminLogin(values.username, values.password);
      } catch (error) {
        showToast(error.message, "error");
        return;
      }
      location.hash = "#/dashboard";
      render();
      break;
    case "member-login-form": {
      try {
        await Gym.memberLogin(values.phone, values.password);
      } catch (error) {
        showToast(error.message, "error");
        return;
      }
      ui.accountQrReady = false;
      location.hash = "#/account";
      render();
      break;
    }
    case "member-form": {
      let accountSalt = "";
      let accountPasswordHash = "";
      let memberPhoto = null;
      const photoFile = form.elements.memberPhoto.files[0];
      if (photoFile) {
        try {
          memberPhoto = await prepareMemberPhoto(photoFile);
        } catch (error) {
          showToast(error.message, "error");
          return;
        }
      } else if (form.dataset.editing !== "1" || !Gym.state.members.find((member) => member.id === ui.editId)?.photo) {
        showToast("A'zo rasmini tanlang", "error");
        return;
      }
      const accountPassword = String(values.accountPassword || "");
      if (accountPassword) {
        if (accountPassword.length < 8) {
          showToast("Akkaunt paroli kamida 8 belgidan iborat bo'lishi kerak", "error");
          return;
        }
        accountSalt = randomQrToken();
        try {
          accountPasswordHash = await hashAccountPassword(accountPassword, accountSalt);
        } catch (error) {
          showToast("Akkaunt parolini xavfsiz saqlab bo'lmadi: " + error.message, "error");
          return;
        }
      }
      const payload = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim(),
        email: values.email || "",
        birthDate: values.birthDate || "",
        region: values.region || "",
        district: values.district || "",
        address: values.address || "",
        uid: (values.uid || "").trim(),
        note: values.note || "",
        planId: values.planId || "monthly",
        method: values.method || "cash",
        frozen: form.elements.frozen ? form.elements.frozen.checked : false,
        requestCard: form.dataset.editing !== "1",
        accountSalt,
        accountPasswordHash,
        photo: memberPhoto || undefined,
      };
      if (form.dataset.editing === "1") {
        const result = Gym.updateMember(ui.editId, payload);
        if (result.error) {
          showToast(result.error, "error");
          return;
        }
        showToast("A'zo ma'lumotlari saqlandi");
      } else {
        const result = Gym.addMember(payload);
        if (result.error) {
          showToast(result.error, "error");
          return;
        }
        showToast("Yangi a'zo qo'shildi");
      }
      ui.editId = null;
      ui.memberPhotoData = "";
      location.hash = "#/members";
      break;
    }
    case "bill-form": {
      const result = Gym.sell({
        memberId: values.memberId,
        planId: values.planId || ui.billPlan,
        method: values.method || "cash",
      });
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      ui.billMember = result.member.id;
      ui.billPlan = "monthly";
      showToast("To'lov qabul qilindi");
      break;
    }
    case "scan-form":
    case "kiosk-form":
      handleScan(form);
      break;
    case "face-checkin-form": {
      const result = Gym.scanFace(values.memberId);
      ui.lastScan = result;
      publishDisplayStatus(result);
      if (result.ok) showToast(result.direction === "out" ? "Chiqish qayd etildi" : "Kirish tasdiqlandi");
      else showToast(result.reason, "error");
      render();
      break;
    }
    case "staff-form": {
      const result = Gym.saveStaff(Object.assign({}, values, { id: ui.staffEdit || "" }));
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      ui.staffEdit = null;
      showToast("Xodim ma'lumotlari saqlandi");
      break;
    }
    case "settings-form":
      Gym.updateSettings({
        clubName: values.clubName.trim(),
        phone: values.phone.trim(),
        address: values.address.trim(),
        adminName: values.adminName.trim(),
        username: values.username.trim(),
        openTime: values.openTime,
        closeTime: values.closeTime,
        sound: form.elements.sound.checked,
        openAccess: form.elements.openAccess.checked,
        cardReplacementFee: Math.max(0, Number(values.cardReplacementFee) || 0),
      });
      showToast("Sozlamalar saqlandi");
      break;
    case "pass-form": {
      if (values.next !== values.confirm) {
        showToast("Yangi parollar mos kelmadi", "error");
        return;
      }
      const result = await Gym.changePassword(values.current, values.next);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      showToast("Parol yangilandi");
      form.reset();
      break;
    }
    case "card-uid-form": {
      const result = Gym.fulfillCardOrder(values.orderId, values.uid);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      ui.cardOrderId = "";
      showToast("NFC karta a'zoga biriktirildi");
      break;
    }
    default:
      return;
  }
  render();
}

function updateMemberPreview(form) {
  const preview = document.getElementById("member-preview");
  if (!preview) return;
  const values = formValues(form);
  const editing = form.dataset.editing === "1";
  const planId = editing ? form.dataset.plan : (values.planId || "monthly");
  const plan = planById(planId);
  const member = {
    id: ui.editId,
    firstName: values.firstName || "Yangi",
    lastName: values.lastName || "a'zo",
    code: form.dataset.code,
    uid: values.uid || "",
    planId,
    startDate: editing ? form.dataset.start : todayISO(),
    endDate: editing ? form.dataset.end : addDays(todayISO(), plan.days),
    sessionsLeft: editing ? Number(form.dataset.sessions) : plan.sessions,
    sessionsTotal: editing ? Number(form.dataset.sessionsTotal) : plan.sessions,
    photo: ui.memberPhotoData || (editing ? editing.photo : ""),
    frozen: editing && form.elements.frozen ? form.elements.frozen.checked : false,
  };
  preview.innerHTML = memberCardHtml(member);
}

async function prepareMemberPhoto(file) {
  if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    throw new Error("JPG, PNG, WebP yoki GIF rasm tanlang");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("Rasm hajmi 8 MB dan kichik bo'lishi kerak");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error("Rasmni ochib bo'lmadi: " + error.message);
  }
  try {
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Rasmni kichraytirish uchun canvas yaratilmadi");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    bitmap.close();
  }
}

async function previewMemberPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const photo = await prepareMemberPhoto(file);
    ui.memberPhotoData = photo;
    const preview = document.getElementById("member-photo-preview");
    const form = input.form;
    if (preview && form) {
      preview.innerHTML = avatar(fullName({
        firstName: form.elements.firstName.value,
        lastName: form.elements.lastName.value,
      }), 72, photo) + "<span>Yangi rasm</span>";
    }
    updateMemberPreview(form);
  } catch (error) {
    input.value = "";
    ui.memberPhotoData = "";
    showToast(error.message, "error");
  }
}

function downloadBackup() {
  downloadStateBackup(Gym.state);
}

function downloadStateBackup(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tamerlan-fitness-" + todayISO() + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Nusxa yuklab olindi");
}

function downloadLegacyBackup() {
  let raw;
  try {
    raw = localStorage.getItem("tamerlan-fitness-v1");
  } catch (error) {
    showToast("Eski ma'lumotlarni o'qib bo'lmadi: " + error.message, "error");
    return;
  }
  if (!raw) {
    showToast("Brauzerda eski ma'lumot topilmadi", "error");
    return;
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (error) {
    showToast("Eski ma'lumotlar JSON nusxasi buzilgan: " + error.message, "error");
    return;
  }
  if (!state || !Array.isArray(state.members) || !Array.isArray(state.payments) ||
      !Array.isArray(state.logs) || !Array.isArray(state.staff)) {
    showToast("Eski ma'lumotlar nusxasi noto'g'ri tuzilgan", "error");
    return;
  }
  downloadStateBackup(state);
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.members) || !Array.isArray(data.payments) ||
        !Array.isArray(data.logs) || !Array.isArray(data.staff)) {
      throw new Error("Nusxa faylining tuzilishi noto'g'ri");
    }
    Gym.replace(data);
    ui.editId = null;
    ui.staffEdit = null;
    showToast("Nusxa muvaffaqiyatli tiklandi");
  } catch (error) {
    showToast(error.message || "Nusxa faylini o'qib bo'lmadi", "error");
  }
}

async function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  switch (action) {
    case "export-legacy-backup":
      downloadLegacyBackup();
      break;
    case "back":
      goBack();
      break;
    case "request-card": {
      const result = Gym.requestCard(id);
      if (result.error) showToast(result.error, "error");
      else showToast("NFC karta buyurtmasi qabul qilindi");
      break;
    }
    case "fulfill-card":
      ui.cardOrderId = id;
      render();
      document.querySelector("#card-uid-form input[name=uid]")?.focus();
      break;
    case "cancel-card-fulfillment":
      ui.cardOrderId = "";
      render();
      break;
    case "logout":
      try {
        await Gym.logout();
        location.hash = "#/dashboard";
        render();
      } catch (error) {
        showToast(error.message, "error");
      }
      break;
    case "member-logout":
      try {
        await Gym.logout();
        ui.accountQrReady = false;
        location.hash = "#/account";
        render();
      } catch (error) {
        showToast(error.message, "error");
      }
      break;
    case "start-account-qr-camera":
      startQrCamera("account");
      break;
    case "member-visit": {
      const member = currentMember();
      if (!member) {
        void Gym.logout().catch((error) => showToast(error.message, "error"));
        location.hash = "#/account";
        render();
        break;
      }
      if (!ui.accountQrReady) {
        showToast("Avval umumiy zal QR kodini skanerlang", "error");
        break;
      }
      let result;
      try {
        result = await Gym.memberVisit(member.id, button.dataset.direction);
      } catch (error) {
        showToast(error.message, "error");
        break;
      }
      if (!result.ok) {
        showToast(result.reason, "error");
        break;
      }
      ui.accountQrReady = false;
      publishDisplayStatus(result);
      showToast(result.reason);
      render();
      break;
    }
    case "filter":
      ui.filter = button.dataset.filter || "all";
      render();
      break;
    case "edit-member":
      ui.editId = id;
      ui.memberPhotoData = Gym.state.members.find((member) => member.id === id)?.photo || "";
      location.hash = "#/add-member";
      render();
      document.querySelector("#member-form input[name=firstName]")?.focus();
      break;
    case "add-member":
      ui.editId = null;
      ui.memberPhotoData = "";
      location.hash = "#/add-member";
      render();
      document.querySelector("#member-form input[name=firstName]")?.focus();
      break;
    case "cancel-edit":
      ui.editId = null;
      ui.memberPhotoData = "";
      location.hash = "#/members";
      render();
      break;
    case "gen-uid": {
      const input = document.getElementById("f-uid");
      if (input) {
        input.value = randomUid();
        updateMemberPreview(input.form);
        input.focus();
      }
      break;
    }
    case "delete-member":
      if (window.confirm("Ushbu a'zoni o'chirishni xohlaysizmi?")) {
        Gym.deleteMember(id);
        if (ui.editId === id) {
          ui.editId = null;
          location.hash = "#/members";
        }
        showToast("A'zo o'chirildi");
      }
      break;
    case "goto-bill":
      ui.billMember = id;
      ui.billPlan = "monthly";
      location.hash = "#/billing";
      render();
      break;
    case "demo-scan": {
      const input = document.querySelector(currentRoute() === "kiosk" ? "#kiosk-uid" : "#scan-uid");
      if (input) {
        input.value = button.dataset.uid || "";
        handleScan(input.form);
      }
      break;
    }
    case "start-qr-camera":
      startQrCamera();
      break;
    case "open-user-display": {
      const url = window.location.href.split("#")[0] + "#/display";
      const display = window.open(url, "tamerlan-member-display", "popup,width=1100,height=800");
      if (display) {
        display.focus();
        showToast("Mijoz ekrani ochildi. Uni ikkinchi monitorga o'tkazing.");
      } else {
        showToast("Mijoz ekranini ochish uchun brauzerda popup oynalarga ruxsat bering.", "error");
      }
      break;
    }
    case "toggle-staff":
      Gym.toggleStaff(id);
      break;
    case "edit-staff":
      ui.staffEdit = id;
      render();
      document.querySelector("#staff-form input[name=name]")?.focus();
      break;
    case "cancel-staff":
      ui.staffEdit = null;
      render();
      break;
    case "delete-staff":
      if (window.confirm("Ushbu xodimni o'chirishni xohlaysizmi?")) {
        Gym.deleteStaff(id);
        if (ui.staffEdit === id) ui.staffEdit = null;
        showToast("Xodim o'chirildi");
      }
      break;
    case "export":
      downloadBackup();
      break;
    case "reset-demo":
      if (window.confirm("Barcha a'zolar, to'lovlar, tashriflar va xodimlar o'chiriladi. Klub sozlamalari va admin akkaunti saqlanadi. Davom etasizmi?")) {
        Gym.reset();
        ui.editId = null;
        ui.staffEdit = null;
        ui.billMember = "";
        ui.lastScan = null;
        showToast("A'zolar, to'lovlar, tashriflar va xodimlar tozalandi");
      }
      break;
    case "print-card":
      document.body.classList.add("printing-card");
      window.print();
      window.setTimeout(() => document.body.classList.remove("printing-card"), 500);
      break;
    case "toggle-menu":
      document.querySelector(".sidebar")?.classList.toggle("open");
      break;
    default:
      break;
  }
}

function startApp() {
  Gym.subscribe(render);
  window.addEventListener("gym-save-error", (event) => {
    showToast(event.detail.message, "error");
  });
  if ("BroadcastChannel" in window) {
    displayChannel = new BroadcastChannel(DISPLAY_CHANNEL_NAME);
    displayChannel.addEventListener("message", (event) => setDisplayStatus(event.data));
  }
  window.addEventListener("storage", (event) => {
    if (event.key === DISPLAY_STATUS_KEY && event.newValue) {
      try {
        setDisplayStatus(JSON.parse(event.newValue));
      } catch (error) {
        showToast("Mijoz ekrani holatini o'qib bo'lmadi: " + error.message, "error");
      }
    }
  });
  try {
    const savedStatus = localStorage.getItem(DISPLAY_STATUS_KEY);
    if (savedStatus) setDisplayStatus(JSON.parse(savedStatus));
  } catch (error) {
    showToast("Mijoz ekrani holatini tiklab bo'lmadi: " + error.message, "error");
  }
  document.getElementById("app").addEventListener("submit", handleSubmit);
  document.getElementById("app").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) void handleAction(button);
  });
  document.getElementById("app").addEventListener("input", (event) => {
    if (event.target.id === "member-search") {
      ui.q = event.target.value;
      const position = event.target.selectionStart;
      render();
      const search = document.getElementById("member-search");
      if (search) {
        search.focus();
        search.setSelectionRange(position, position);
      }
    } else if (event.target.form && event.target.form.id === "member-form") {
      updateMemberPreview(event.target.form);
    }
  });
  document.getElementById("app").addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "member-photo-input") {
      previewMemberPhoto(target);
    } else if (target.id === "mobile-member") {
      ui.mobileId = target.value;
      render();
    } else if (target.id === "bill-member") {
      ui.billMember = target.value;
      render();
    } else if (target.name === "planId" && target.form && target.form.id === "bill-form") {
      ui.billPlan = target.value;
      render();
    } else if (target.id === "import-file" && target.files && target.files[0]) {
      importBackup(target.files[0]);
      target.value = "";
    }
  });
  window.addEventListener("hashchange", () => {
    trackAdminRoute();
    stopQrCamera();
    ui.accountQrReady = false;
    render();
  });
  Gym.init().then(() => {
    const initialRoute = currentRoute();
    if (Object.prototype.hasOwnProperty.call(PAGE_META, initialRoute)) adminRouteHistory.push(initialRoute);
    render();
    Gym.refreshTelegramStatus().then(updateTelegramStatusUI).catch((error) => {
      if (currentRoute() === "settings") showToast(error.message, "error");
    });
    window.setInterval(() => {
      document.querySelectorAll("[data-clock]").forEach((el) => {
        el.textContent = new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
      });
      document.querySelectorAll("[data-ago]").forEach((el) => {
        el.textContent = since(el.dataset.ago);
      });
    }, 30000);
    window.setInterval(() => {
      Gym.refreshTelegramStatus().then(updateTelegramStatusUI).catch((error) => {
        if (currentRoute() === "settings") showToast(error.message, "error");
      });
    }, 15000);
  }).catch((error) => {
    showStartupError(error);
  });
}

document.addEventListener("DOMContentLoaded", startApp, { once: true });
