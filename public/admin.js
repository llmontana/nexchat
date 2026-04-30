import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { isAdminEmail } from "./admin-config.js";

const firebaseConfig = {
  apiKey: "AIzaSyBRX7sufaar-yZYDXVc15eqXCdvJNDoDjs",
  authDomain: "nexchat-69594.firebaseapp.com",
  projectId: "nexchat-69594",
  storageBucket: "nexchat-69594.firebasestorage.app",
  messagingSenderId: "148906324351",
  appId: "1:148906324351:web:c63be7bcf0a02ee3cc6a4a",
  measurementId: "G-1CGEGTP1ZH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const adminAuthOverlay = document.getElementById("adminAuthOverlay");
const adminAuthForm = document.getElementById("adminAuthForm");
const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const adminAuthSubmitButton = document.getElementById("adminAuthSubmitButton");
const adminGoogleLoginButton = document.getElementById("adminGoogleLoginButton");
const adminAuthStatus = document.getElementById("adminAuthStatus");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const adminSessionName = document.getElementById("adminSessionName");
const adminSessionEmail = document.getElementById("adminSessionEmail");
const adminStatusBadge = document.getElementById("adminStatusBadge");
const statTotalUsers = document.getElementById("statTotalUsers");
const statGirls = document.getElementById("statGirls");
const statBoys = document.getElementById("statBoys");
const statDiamonds = document.getElementById("statDiamonds");
const adminUserSearch = document.getElementById("adminUserSearch");
const adminUsersList = document.getElementById("adminUsersList");
const adminRecentList = document.getElementById("adminRecentList");
const adminBanList = document.getElementById("adminBanList");

let allUsers = [];
let currentAdminToken = "";
let recentSessions = [];
let activeBans = [];

function setStatus(text, isError = false) {
  adminAuthStatus.textContent = text;
  adminAuthStatus.classList.toggle("error", isError);
}

function setPanelStatus(text) {
  adminStatusBadge.textContent = text;
}

function setAuthBusy(busy) {
  adminAuthSubmitButton.disabled = busy;
  adminGoogleLoginButton.disabled = busy;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return map[char];
  });
}

function formatDate(value) {
  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : null;

  if (!date) {
    return "Bilinmiyor";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

async function getAdminToken() {
  if (!auth.currentUser) {
    throw new Error("Aktif admin oturumu bulunamadi.");
  }

  currentAdminToken = await auth.currentUser.getIdToken();
  return currentAdminToken;
}

async function callAdminApi(path, options = {}) {
  const token = await getAdminToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Admin isteği başarısız oldu.");
  }

  return data;
}

async function syncSessionPresence(user, username = "") {
  const idToken = await user.getIdToken();
  await fetch("/api/session-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      username
    })
  });
}

function getRecentSessionByUid(uid) {
  return recentSessions.find((item) => item.uid === uid) || null;
}

function isIpCurrentlyBanned(ip) {
  if (!ip) {
    return false;
  }

  return activeBans.some((item) => item.ip === ip);
}

function renderUsersList() {
  const keyword = adminUserSearch.value.trim().toLocaleLowerCase("tr-TR");
  const filtered = allUsers.filter((user) => {
    if (!keyword) {
      return true;
    }

    return (
      String(user.username || "").toLocaleLowerCase("tr-TR").includes(keyword) ||
      String(user.email || "").toLocaleLowerCase("tr-TR").includes(keyword)
    );
  });

  if (filtered.length === 0) {
    adminUsersList.innerHTML =
      '<article class="admin-empty">Eşleşen kullanıcı bulunamadı.</article>';
    return;
  }

  adminUsersList.innerHTML = filtered
    .map((user) => {
      const genderLabel =
        user.gender === "kiz" ? "Kız" : user.gender === "erkek" ? "Erkek" : "Belirsiz";
      const session = getRecentSessionByUid(user.uid);
      const userIp = session?.ip || "";
      const userIpLabel = userIp || "IP yok";
      const banButtonLabel = isIpCurrentlyBanned(userIp) ? "IP Banlı" : "IP Banla";
      return `
        <article class="admin-user-item">
          <div class="admin-user-main">
            <strong>${escapeHtml(user.username || "İsimsiz")}</strong>
            <span>${escapeHtml(user.email || "E-posta yok")}</span>
            <span>${escapeHtml(userIpLabel)}</span>
          </div>
          <div class="admin-user-meta">
            <span>${escapeHtml(genderLabel)}</span>
            <span>${escapeHtml(String(Number(user.diamonds || 0)))} ◈</span>
          </div>
          <div class="admin-user-actions">
            <div class="admin-diamond-editor">
              <input
                type="number"
                min="0"
                value="${escapeHtml(String(Number(user.diamonds || 0)))}"
                data-diamond-input="${escapeHtml(user.uid || "")}"
              />
              <button
                class="ghost-button admin-inline-button"
                type="button"
                data-action="save-diamonds"
                data-uid="${escapeHtml(user.uid || "")}"
              >
                Kaydet
              </button>
            </div>
            <button
              class="ghost-button admin-inline-button"
              type="button"
              data-action="ban-ip"
              data-ip="${escapeHtml(userIp)}"
              ${userIp ? "" : "disabled"}
            >
              ${escapeHtml(banButtonLabel)}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecentList() {
  const recent = [...allUsers]
    .sort((a, b) => {
      const aTime = typeof a.lastLoginAt?.toDate === "function" ? a.lastLoginAt.toDate().getTime() : 0;
      const bTime = typeof b.lastLoginAt?.toDate === "function" ? b.lastLoginAt.toDate().getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 8);

  if (recent.length === 0) {
    adminRecentList.innerHTML =
      '<article class="admin-empty">Henüz gösterilecek hareket yok.</article>';
    return;
  }

  adminRecentList.innerHTML = recent
    .map(
      (user) => `
        <article class="admin-recent-item">
          <div>
            <strong>${escapeHtml(user.username || "İsimsiz")}</strong>
            <span>${escapeHtml(user.ip || "IP yok")}</span>
          </div>
          <span>${escapeHtml(formatDate(user.lastLoginAt || user.createdAt || user.lastSeen))}</span>
        </article>
      `
    )
    .join("");
}

function renderBanList() {
  if (activeBans.length === 0) {
    adminBanList.innerHTML = '<article class="admin-empty">Aktif IP banı yok.</article>';
    return;
  }

  adminBanList.innerHTML = activeBans
    .map(
      (ban) => `
        <article class="admin-ban-item">
          <div>
            <strong>${escapeHtml(ban.ip)}</strong>
            <span>${escapeHtml(ban.reason || "Belirtilmedi")}</span>
            <span>Bitiş: ${escapeHtml(formatDate(new Date(ban.expiresAt)))}</span>
          </div>
          <button
            class="ghost-button admin-inline-button"
            type="button"
            data-action="unban-ip"
            data-ip="${escapeHtml(ban.ip)}"
          >
            Banı Kaldır
          </button>
        </article>
      `
    )
    .join("");
}

function renderStats() {
  const totalUsers = allUsers.length;
  const girls = allUsers.filter((user) => user.gender === "kiz").length;
  const boys = allUsers.filter((user) => user.gender === "erkek").length;
  const diamonds = allUsers.reduce((sum, user) => sum + Number(user.diamonds || 0), 0);

  statTotalUsers.textContent = String(totalUsers);
  statGirls.textContent = String(girls);
  statBoys.textContent = String(boys);
  statDiamonds.textContent = String(diamonds);
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);
  const existing = userSnapshot.exists() ? userSnapshot.data() : null;
  const adminByEmail = isAdminEmail(user.email || "");

  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email || "",
      lastLoginAt: serverTimestamp(),
      isAdmin: Boolean(existing?.isAdmin || adminByEmail)
    },
    { merge: true }
  );

  return {
    ...(existing || {}),
    uid: user.uid,
    email: user.email || "",
    isAdmin: Boolean(existing?.isAdmin || adminByEmail)
  };
}

async function loadDashboard() {
  const snapshot = await getDocs(collection(db, "users"));
  allUsers = snapshot.docs.map((item) => item.data());

  const [sessionsResult, bansResult] = await Promise.allSettled([
    callAdminApi("/api/admin/recent-sessions"),
    callAdminApi("/api/admin/bans")
  ]);

  recentSessions =
    sessionsResult.status === "fulfilled" && Array.isArray(sessionsResult.value.sessions)
      ? sessionsResult.value.sessions
      : [];
  activeBans =
    bansResult.status === "fulfilled" && Array.isArray(bansResult.value.bans)
      ? bansResult.value.bans
      : [];

  renderStats();
  renderUsersList();
  renderRecentList();
  renderBanList();

  if (sessionsResult.status === "rejected" || bansResult.status === "rejected") {
    setPanelStatus("Verilerin bir kısmı yüklenemedi");
    return;
  }

  setPanelStatus("Panel hazır");
}

async function updateUserDiamonds(uid, amount) {
  await setDoc(
    doc(db, "users", uid),
    {
      diamonds: Math.max(0, Number(amount) || 0)
    },
    { merge: true }
  );
}

async function createIpBan(ip) {
  const response = await callAdminApi("/api/admin/bans", {
    method: "POST",
    body: JSON.stringify({
      ip,
      reason: "Admin panelinden engellendi"
    })
  });
  activeBans = Array.isArray(response.bans) ? response.bans : [];
  renderUsersList();
  renderBanList();
}

async function removeIpBan(ip) {
  const response = await callAdminApi(`/api/admin/bans/${encodeURIComponent(ip)}`, {
    method: "DELETE"
  });
  activeBans = Array.isArray(response.bans) ? response.bans : [];
  renderUsersList();
  renderBanList();
}

async function signInWithProvider() {
  setAuthBusy(true);
  setStatus("Google ile giriş yapılıyor...");

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setAuthBusy(false);
  }
}

adminAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthBusy(true);
  setStatus("Giriş yapılıyor...");

  try {
    await signInWithEmailAndPassword(auth, adminEmail.value.trim(), adminPassword.value);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setAuthBusy(false);
  }
});

adminGoogleLoginButton.addEventListener("click", async () => {
  await signInWithProvider();
});

adminLogoutButton.addEventListener("click", async () => {
  adminLogoutButton.disabled = true;
  try {
    await signOut(auth);
  } finally {
    adminLogoutButton.disabled = false;
  }
});

adminUserSearch.addEventListener("input", () => {
  renderUsersList();
});

adminUsersList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  button.disabled = true;

  try {
    if (button.dataset.action === "save-diamonds") {
      const uid = button.dataset.uid || "";
      const input = adminUsersList.querySelector(`[data-diamond-input="${uid}"]`);
      const value = Number(input?.value || 0);
      await updateUserDiamonds(uid, value);
      await loadDashboard();
      setPanelStatus("Elmas bakiyesi güncellendi");
    } else if (button.dataset.action === "ban-ip") {
      const ip = button.dataset.ip || "";
      if (ip && !isIpCurrentlyBanned(ip)) {
        await createIpBan(ip);
        setPanelStatus("IP ban listesine eklendi");
      }
    }
  } catch (error) {
    setPanelStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

adminBanList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='unban-ip']");
  if (!button) {
    return;
  }

  button.disabled = true;
  try {
    await removeIpBan(button.dataset.ip || "");
    setPanelStatus("IP banı kaldırıldı");
  } catch (error) {
    setPanelStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    adminAuthOverlay.classList.remove("hidden");
    adminLogoutButton.disabled = true;
    adminSessionName.textContent = "Hazır";
    adminSessionEmail.textContent = "Yetkili hesap bekleniyor";
    setPanelStatus("Giriş bekleniyor");
    return;
  }

  try {
    const profile = await ensureUserProfile(user);
    if (!profile.isAdmin) {
      await signOut(auth);
      window.location.replace("/");
      return;
    }

    adminAuthOverlay.classList.add("hidden");
    adminLogoutButton.disabled = false;
    adminSessionName.textContent = profile.username || "Admin";
    adminSessionEmail.textContent = user.email || "Yetkili hesap";
    setStatus("Giriş başarılı");
    setPanelStatus("Veriler yükleniyor");
    try {
      await syncSessionPresence(user, profile.username || "Admin");
    } catch (error) {
      console.error("Admin session sync başarısız:", error);
    }
    await loadDashboard();
  } catch (error) {
    setStatus(error.message, true);
    setPanelStatus("Panel yüklenemedi");
  }
});

setPanelStatus("Giriş bekleniyor");
