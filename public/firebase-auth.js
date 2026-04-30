import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
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

const authOverlay = document.getElementById("authOverlay");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmitButton = document.getElementById("authSubmitButton");
const authModeButton = document.getElementById("authModeButton");
const authStatus = document.getElementById("authStatus");
const logoutButton = document.getElementById("logoutButton");
const sessionBadge = document.getElementById("sessionBadge");
const googleLoginButton = document.getElementById("googleLoginButton");
const usernameOverlay = document.getElementById("usernameOverlay");
const usernameForm = document.getElementById("usernameForm");
const usernameInput = document.getElementById("usernameInput");
const genderInput = document.getElementById("genderInput");
const genderGirlButton = document.getElementById("genderGirlButton");
const genderBoyButton = document.getElementById("genderBoyButton");
const usernameSubmitButton = document.getElementById("usernameSubmitButton");
const usernameStatus = document.getElementById("usernameStatus");
const friendsSearch = document.getElementById("friendsSearch");
const friendsList = document.getElementById("friendsList");
const friendsCount = document.querySelector(".friends-count");
const incomingRequestsList = document.getElementById("incomingRequestsList");
const outgoingRequestsList = document.getElementById("outgoingRequestsList");
const incomingRequestsCount = document.getElementById("incomingRequestsCount");
const outgoingRequestsCount = document.getElementById("outgoingRequestsCount");
const chatTitle = document.getElementById("chatTitle");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSendButton = document.getElementById("chatSendButton");
const closeChatButton = document.getElementById("closeChatButton");
const diamondBalance = document.getElementById("diamondBalance");
const diamondCountBadge = document.getElementById("diamondCountBadge");
const buyDiamondsButton = document.getElementById("buyDiamondsButton");
const premiumGirlButton = document.getElementById("premiumGirlButton");
const premiumBoyButton = document.getElementById("premiumBoyButton");

let authMode = "login";
const googleProvider = new GoogleAuthProvider();
let pendingProfileUser = null;
let currentUserProfile = null;
let currentFriends = [];
let currentIncomingRequests = [];
let currentOutgoingRequests = [];
let currentMessages = [];
let searchResults = [];
let selectedFriend = null;
let isChatPanelOpen = false;
let friendsUnsubscribe = null;
let incomingUnsubscribe = null;
let outgoingUnsubscribe = null;
let chatUnsubscribe = null;
let searchTimeoutId = null;
const ADMIN_PANEL_PATH = "/admin.html";
const mutualRequestResolutions = new Set();
let currentUserProfileUnsubscribe = null;
const PREMIUM_FILTER_COSTS = {
  kiz: 9,
  erkek: 5
};
const PRESENCE_HEARTBEAT_MS = 45000;
const PRESENCE_ONLINE_WINDOW_MS = 90000;
const friendPresenceMap = new Map();
const friendPresenceUnsubscribers = new Map();
let presenceHeartbeatTimer = null;

function setAuthStatus(text, isError = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", isError);
}

function setUsernameStatus(text, isError = false) {
  usernameStatus.textContent = text;
  usernameStatus.classList.toggle("error", isError);
}

function updateDiamondUi(amount = 0) {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  diamondBalance.textContent = `${safeAmount} Elmas`;
  diamondCountBadge.textContent = String(safeAmount);
  if (premiumGirlButton) {
    premiumGirlButton.disabled = safeAmount < PREMIUM_FILTER_COSTS.kiz;
  }
  if (premiumBoyButton) {
    premiumBoyButton.disabled = safeAmount < PREMIUM_FILTER_COSTS.erkek;
  }
}

function openChatPanel() {
  isChatPanelOpen = true;
  document.body.classList.add("chat-open");
}

function closeChatPanel() {
  isChatPanelOpen = false;
  document.body.classList.remove("chat-open");
}

function syncGenderSelection() {
  const selectedGender = genderInput.value;
  const buttons = [genderGirlButton, genderBoyButton];

  for (const button of buttons) {
    const active = button.dataset.gender === selectedGender;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function sanitizeUsername(value) {
  return value.trim().replace(/\s+/g, "").replace(/[^\p{L}\p{N}_]/gu, "");
}

function normalizeUsernameLookup(value) {
  return sanitizeUsername(value).toLocaleLowerCase("tr-TR");
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

function formatChatTime(value) {
  if (!value) {
    return "şimdi";
  }

  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : null;

  if (!date) {
    return "şimdi";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

function getConversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

function getItemDisplayName(item) {
  return item?.username || "isimsiz";
}

function getInitials(item) {
  return "";
}

function isPresenceOnline(presence) {
  if (!presence) {
    return false;
  }

  const lastSeen =
    typeof presence.lastSeenAt?.toDate === "function"
      ? presence.lastSeenAt.toDate().getTime()
      : presence.lastSeenAt instanceof Date
        ? presence.lastSeenAt.getTime()
        : 0;

  return Boolean(presence.online) && Date.now() - lastSeen < PRESENCE_ONLINE_WINDOW_MS;
}

function findFriendByUid(uid) {
  return currentFriends.find((item) => item.uid === uid);
}

function findOutgoingByUid(uid) {
  return currentOutgoingRequests.find((item) => item.uid === uid);
}

function findIncomingByUid(uid) {
  return currentIncomingRequests.find((item) => item.uid === uid);
}

function setAuthUiBusy(busy) {
  authSubmitButton.disabled = busy;
  authModeButton.disabled = busy;
  googleLoginButton.disabled = busy;
}

function notifyUserProfileUpdated() {
  if (!currentUserProfile) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("user-profile-updated", {
      detail: {
        user: currentUserProfile
      }
    })
  );
}

function updateAuthMode() {
  const isLogin = authMode === "login";
  authSubmitButton.textContent = isLogin ? "Giriş Yap" : "Kayıt Ol";
  authModeButton.textContent = isLogin ? "Hesap Oluştur" : "Giriş Ekranına Dön";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  setAuthStatus(isLogin ? "Hazır" : "Yeni hesap oluşturabilirsin");
}

function renderRequestList(targetElement, items, emptyText, mode) {
  if (items.length === 0) {
    targetElement.innerHTML = `<article class="request-empty">${escapeHtml(emptyText)}</article>`;
    return;
  }

  targetElement.innerHTML = items
    .map((item) => {
      const title = escapeHtml(getItemDisplayName(item));
      const subtitle = escapeHtml(
        mode === "incoming" ? "Seni eklemek istiyor" : "İsteğin bekliyor"
      );

      return `
        <article class="request-item">
          <div>
            <strong>${title}</strong>
            <span>${subtitle}</span>
          </div>
          <div class="request-actions">
            ${
              mode === "incoming"
                ? `<button class="request-button accept" type="button" data-action="accept-request" data-uid="${escapeHtml(item.uid || "")}">Kabul Et</button>
                   <button class="request-button reject" type="button" data-action="reject-request" data-uid="${escapeHtml(item.uid || "")}">Reddet</button>`
                : `<button class="request-button reject" type="button" data-action="cancel-request" data-uid="${escapeHtml(item.uid || "")}">İptal Et</button>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderChatPanel() {
  if (!selectedFriend) {
    closeChatPanel();
    chatTitle.textContent = "Bir arkadaş seç";
    chatInput.value = "";
    chatInput.disabled = true;
    chatSendButton.disabled = true;
    chatMessages.innerHTML =
      '<article class="chat-empty">Arkadaş listenden birini seçince yazışma burada açılacak.</article>';
    return;
  }

  chatTitle.textContent = `${selectedFriend.username || "Arkadaş"} ile sohbet`;
  chatInput.disabled = false;
  chatSendButton.disabled = false;

  if (currentMessages.length === 0) {
    chatMessages.innerHTML =
      '<article class="chat-empty">Henüz mesaj yok. İlk mesajı sen gönder.</article>';
    return;
  }

  chatMessages.innerHTML = currentMessages
    .map((message) => {
      const own = message.senderUid === currentUserProfile?.uid;
      return `
        <article class="chat-bubble ${own ? "own" : "friend"}">
          <div>${escapeHtml(message.text || "")}</div>
          <div class="chat-meta">${escapeHtml(own ? "Sen" : getItemDisplayName(selectedFriend))} · ${escapeHtml(formatChatTime(message.createdAt))}</div>
        </article>
      `;
    })
    .join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderFriendsPanel() {
  const hasSearch = friendsSearch.value.trim().length > 0;
  const items = hasSearch ? searchResults : currentFriends;

  friendsCount.textContent = String(currentFriends.length);
  incomingRequestsCount.textContent = String(currentIncomingRequests.length);
  outgoingRequestsCount.textContent = String(currentOutgoingRequests.length);

  renderRequestList(
    incomingRequestsList,
    currentIncomingRequests,
    "Şu an bekleyen istek yok.",
    "incoming"
  );
  renderRequestList(
    outgoingRequestsList,
    currentOutgoingRequests,
    "Henüz kimseye istek göndermedin.",
    "outgoing"
  );

  if (items.length === 0) {
    friendsList.innerHTML = hasSearch
      ? `
        <article class="friend-empty">
          <strong>Sonuç bulunamadı</strong>
          <p>Bu kullanıcı adına ait eşleşen bir hesap görünmüyor.</p>
        </article>
      `
      : `
        <article class="friend-empty">
          <strong>Henüz arkadaş yok</strong>
          <p>Burada eklediğin kullanıcılar görünecek. İleride hızlıca tekrar bağlanmak için bu alanı kullanabilirsin.</p>
        </article>
      `;
    renderChatPanel();
    return;
  }

  friendsList.innerHTML = items
    .map((item) => {
      const initials = escapeHtml(getInitials(item));
      const title = escapeHtml(getItemDisplayName(item));
      const presence = friendPresenceMap.get(item.uid);
      const isOnline = isPresenceOnline(presence);
      const subtitle = escapeHtml(hasSearch ? "Kullanıcı bulundu" : isOnline ? "Çevrimiçi" : "Çevrimdışı");
      const isSelected = !hasSearch && isChatPanelOpen && selectedFriend?.uid === item.uid;

      let actionMarkup = "";
      if (hasSearch) {
        const isFriend = Boolean(findFriendByUid(item.uid));
        const hasOutgoing = Boolean(findOutgoingByUid(item.uid));
        const hasIncoming = Boolean(findIncomingByUid(item.uid));

        if (isFriend) {
          actionMarkup = `<div class="friend-status-chip">Zaten arkadaşsınız</div>`;
        } else if (hasIncoming) {
          actionMarkup = `<button class="friend-action-button primary-button" type="button" data-action="accept-request" data-uid="${escapeHtml(item.uid || "")}">Kabul Et</button>`;
        } else if (hasOutgoing) {
          actionMarkup = `<div class="friend-status-chip">İstek gönderildi</div>`;
        } else {
          actionMarkup = `<button class="friend-action-button ghost-button" type="button" data-action="send-request" data-uid="${escapeHtml(item.uid || "")}">Arkadaş Ekle</button>`;
        }
      } else {
        actionMarkup = `<div class="friend-status-chip">${isSelected ? "Sohbet açık" : "Sohbet aç"}</div>`;
      }

      return `
        <article class="friend-item ${hasSearch ? "" : "selectable"} ${isSelected ? "selected" : ""}" ${hasSearch ? "" : `data-select-friend="${escapeHtml(item.uid || "")}"`}>
          <div class="friend-item-content">
            <strong>${title}</strong>
            <div class="friend-presence-row">
              <span class="friend-presence-dot ${hasSearch ? "neutral" : isOnline ? "online" : "offline"}"></span>
              <span>${subtitle}</span>
            </div>
          </div>
          <div class="friend-item-actions">
            ${actionMarkup}
            ${hasSearch ? `<div class="friend-badge">${initials}</div>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  renderChatPanel();
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDocFromServer(userRef).catch(() => getDoc(userRef));
  const email = user.email || "";
  const adminByEmail = isAdminEmail(email);
  const profilePayload = {
    uid: user.uid,
    email,
    provider: user.providerData?.[0]?.providerId || "password",
    lastLoginAt: serverTimestamp(),
    isAdmin: snapshot.exists() ? Boolean(snapshot.data().isAdmin || adminByEmail) : adminByEmail
  };

  if (!snapshot.exists()) {
    profilePayload.diamonds = 0;
    profilePayload.createdAt = serverTimestamp();
    profilePayload.isBanned = false;
  }

  await setDoc(
    userRef,
    profilePayload,
    { merge: true }
  );

  const freshSnapshot = await getDocFromServer(userRef).catch(() => getDoc(userRef));
  return freshSnapshot.exists() ? freshSnapshot.data() : null;
}

async function maybeResolveMutualRequests() {
  if (!currentUserProfile) {
    return;
  }

  const currentUid = currentUserProfile.uid;
  const outgoingByUid = new Set(currentOutgoingRequests.map((item) => item.uid));

  for (const incomingRequest of currentIncomingRequests) {
    if (!incomingRequest?.uid || !outgoingByUid.has(incomingRequest.uid)) {
      continue;
    }

    const lockKey = [currentUid, incomingRequest.uid].sort().join("__");
    if (mutualRequestResolutions.has(lockKey) || currentUid > incomingRequest.uid) {
      continue;
    }

    mutualRequestResolutions.add(lockKey);
    try {
      await createFriendship(incomingRequest);
    } catch (error) {
      console.error(error);
    } finally {
      mutualRequestResolutions.delete(lockKey);
    }
  }
}

function clearChatSubscription() {
  if (chatUnsubscribe) {
    chatUnsubscribe();
    chatUnsubscribe = null;
  }
}

function clearSocialSubscriptions() {
  if (friendsUnsubscribe) {
    friendsUnsubscribe();
    friendsUnsubscribe = null;
  }

  if (incomingUnsubscribe) {
    incomingUnsubscribe();
    incomingUnsubscribe = null;
  }

  if (outgoingUnsubscribe) {
    outgoingUnsubscribe();
    outgoingUnsubscribe = null;
  }

  clearChatSubscription();
  clearFriendPresenceSubscriptions();
}

function clearCurrentUserProfileSubscription() {
  if (currentUserProfileUnsubscribe) {
    currentUserProfileUnsubscribe();
    currentUserProfileUnsubscribe = null;
  }
}

function clearFriendPresenceSubscriptions() {
  for (const unsubscribe of friendPresenceUnsubscribers.values()) {
    unsubscribe();
  }

  friendPresenceUnsubscribers.clear();
  friendPresenceMap.clear();
}

function syncFriendPresenceSubscriptions() {
  const friendUidSet = new Set(currentFriends.map((item) => item.uid).filter(Boolean));

  for (const [uid, unsubscribe] of friendPresenceUnsubscribers.entries()) {
    if (friendUidSet.has(uid)) {
      continue;
    }

    unsubscribe();
    friendPresenceUnsubscribers.delete(uid);
    friendPresenceMap.delete(uid);
  }

  for (const uid of friendUidSet) {
    if (friendPresenceUnsubscribers.has(uid)) {
      continue;
    }

    const unsubscribe = onSnapshot(doc(db, "users", uid), (snapshot) => {
      friendPresenceMap.set(uid, snapshot.exists() ? snapshot.data() : null);
      renderFriendsPanel();
    });

    friendPresenceUnsubscribers.set(uid, unsubscribe);
  }
}

async function writeOwnPresence(online) {
  if (!currentUserProfile?.uid) {
    return;
  }

  await writePresenceForUid(currentUserProfile.uid, online);
}

async function writePresenceForUid(uid, online) {
  if (!uid) {
    return;
  }

  await setDoc(
    doc(db, "users", uid),
    {
      online,
      lastSeenAt: serverTimestamp()
    },
    { merge: true }
  );
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  void writeOwnPresence(true).catch(() => {});
  presenceHeartbeatTimer = setInterval(() => {
    void writeOwnPresence(true).catch(() => {});
  }, PRESENCE_HEARTBEAT_MS);
}

function stopPresenceHeartbeat() {
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }
}

function subscribeToChat(friend) {
  clearChatSubscription();
  currentMessages = [];
  selectedFriend = friend;
  openChatPanel();
  renderChatPanel();

  if (!currentUserProfile || !friend?.uid) {
    return;
  }

  const conversationId = getConversationId(currentUserProfile.uid, friend.uid);
  const messagesQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "asc")
  );

  chatUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
    const now = Date.now();
    currentMessages = snapshot.docs
      .map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data()
      }))
      .filter((message) => {
        const expiresAt =
          typeof message.expiresAt?.toDate === "function"
            ? message.expiresAt.toDate().getTime()
            : message.expiresAt instanceof Date
              ? message.expiresAt.getTime()
              : now + 1;
        return expiresAt > now;
      });
    renderChatPanel();
  });
}

function subscribeSocialCollections(uid) {
  clearSocialSubscriptions();

  friendsUnsubscribe = onSnapshot(collection(db, "users", uid, "friends"), (snapshot) => {
    currentFriends = snapshot.docs.map((docSnapshot) => docSnapshot.data());
    syncFriendPresenceSubscriptions();

    if (selectedFriend) {
      const refreshedFriend = currentFriends.find((item) => item.uid === selectedFriend.uid);
      if (refreshedFriend) {
        selectedFriend = refreshedFriend;
      } else {
        selectedFriend = null;
        currentMessages = [];
        clearChatSubscription();
      }
    }

    renderFriendsPanel();
  });

  incomingUnsubscribe = onSnapshot(collection(db, "users", uid, "incomingRequests"), (snapshot) => {
    currentIncomingRequests = snapshot.docs.map((docSnapshot) => docSnapshot.data());
    void maybeResolveMutualRequests();
    renderFriendsPanel();
  });

  outgoingUnsubscribe = onSnapshot(collection(db, "users", uid, "outgoingRequests"), (snapshot) => {
    currentOutgoingRequests = snapshot.docs.map((docSnapshot) => docSnapshot.data());
    void maybeResolveMutualRequests();
    renderFriendsPanel();
  });
}

async function searchUsersByUsername(rawValue) {
  if (!currentUserProfile) {
    searchResults = [];
    renderFriendsPanel();
    return;
  }

  const username = normalizeUsernameLookup(rawValue);
  if (username.length < 3) {
    searchResults = [];
    renderFriendsPanel();
    return;
  }

  const usersQuery = query(collection(db, "users"), where("usernameLower", "==", username));
  const snapshot = await getDocs(usersQuery);
  searchResults = snapshot.docs
    .map((docSnapshot) => docSnapshot.data())
    .filter((item) => item.uid !== currentUserProfile.uid);
  renderFriendsPanel();
}

function openUsernameSetup(user, suggestedName = "") {
  pendingProfileUser = user;
  authOverlay.classList.add("hidden");
  usernameOverlay.classList.remove("hidden");
  usernameInput.value = suggestedName;
  genderInput.value = "";
  syncGenderSelection();
  setUsernameStatus("Kullanıcı adını belirle");
  setTimeout(() => usernameInput.focus(), 0);
}

async function finalizeSignedInUser(user, existingProfile) {
  const username = existingProfile?.username?.trim();
  if (!username) {
    const fallbackName = user.displayName ? sanitizeUsername(user.displayName) : "";
    openUsernameSetup(user, fallbackName);
    return;
  }

  const usernameLower = normalizeUsernameLookup(username);
  if (existingProfile?.usernameLower !== usernameLower) {
    await setDoc(
      doc(db, "users", user.uid),
      {
        username,
        usernameLower
      },
      { merge: true }
    );
  }

  currentUserProfile = {
    uid: user.uid,
    email: user.email || "",
    username,
    gender: existingProfile?.gender || "",
    diamonds: Number(existingProfile?.diamonds || 0),
    isAdmin: Boolean(existingProfile?.isAdmin || isAdminEmail(user.email || ""))
  };

  if (currentUserProfile.isAdmin && !window.location.pathname.endsWith(ADMIN_PANEL_PATH)) {
    window.location.replace(ADMIN_PANEL_PATH);
    return;
  }

  try {
    await syncSessionPresence(user, username);
  } catch (error) {
    console.error("Session sync başarısız:", error);
  }

  updateDiamondUi(currentUserProfile.diamonds);
  subscribeSocialCollections(user.uid);
  startPresenceHeartbeat();
  clearCurrentUserProfileSubscription();
  currentUserProfileUnsubscribe = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
    if (!snapshot.exists() || !currentUserProfile) {
      return;
    }

    const data = snapshot.data();
    currentUserProfile = {
      ...currentUserProfile,
      username: data.username || currentUserProfile.username,
      gender: data.gender || currentUserProfile.gender,
      diamonds: Number(data.diamonds || 0),
      isAdmin: Boolean(data.isAdmin || currentUserProfile.isAdmin)
    };
    sessionBadge.textContent = `${currentUserProfile.username} @ ${user.email || "aktif"}`;
    updateDiamondUi(currentUserProfile.diamonds);
    notifyUserProfileUpdated();
  });

  usernameOverlay.classList.add("hidden");
  authOverlay.classList.add("hidden");
  sessionBadge.textContent = `${username} @ ${user.email || "aktif"}`;
  logoutButton.disabled = false;
  setAuthStatus("Giriş başarılı");
  window.dispatchEvent(
    new CustomEvent("auth-state", {
      detail: {
        authenticated: true,
        user: currentUserProfile,
        idToken: await user.getIdToken()
      }
    })
  );
  notifyUserProfileUpdated();
}

async function signInWithProvider(provider, providerName) {
  setAuthUiBusy(true);
  setAuthStatus(`${providerName} ile giriş yapılıyor...`);

  try {
    const credential = await signInWithPopup(auth, provider);
    await ensureUserProfile(credential.user);
  } catch (error) {
    setAuthStatus(error.message, true);
  } finally {
    setAuthUiBusy(false);
  }
}

async function createFriendship(targetProfile) {
  const myUid = currentUserProfile.uid;
  const targetUid = targetProfile.uid;
  const batch = writeBatch(db);

  batch.set(doc(db, "users", myUid, "friends", targetUid), {
    uid: targetUid,
    username: targetProfile.username || "",
    addedAt: serverTimestamp()
  });

  batch.set(doc(db, "users", targetUid, "friends", myUid), {
    uid: myUid,
    username: currentUserProfile.username || "",
    addedAt: serverTimestamp()
  });

  batch.delete(doc(db, "users", myUid, "incomingRequests", targetUid));
  batch.delete(doc(db, "users", myUid, "outgoingRequests", targetUid));
  batch.delete(doc(db, "users", targetUid, "incomingRequests", myUid));
  batch.delete(doc(db, "users", targetUid, "outgoingRequests", myUid));

  await batch.commit();
}

async function sendFriendRequest(targetProfile) {
  if (!currentUserProfile || !targetProfile?.uid) {
    return { ok: false, message: "Geçerli bir kullanıcı bulunamadı." };
  }

  if (targetProfile.uid === currentUserProfile.uid) {
    return { ok: false, message: "Kendini arkadaş ekleyemezsin." };
  }

  const myUid = currentUserProfile.uid;
  const targetUid = targetProfile.uid;
  const existingFriend = await getDoc(doc(db, "users", myUid, "friends", targetUid));

  if (existingFriend.exists()) {
    return { ok: true, message: "Bu kullanıcı zaten arkadaş listende." };
  }

  const incomingRef = doc(db, "users", myUid, "incomingRequests", targetUid);
  const incomingSnapshot = await getDoc(incomingRef);

  if (incomingSnapshot.exists()) {
    await createFriendship(targetProfile);
    return { ok: true, message: "Karşılıklı ekleme tamamlandı. Artık arkadaşsınız." };
  }

  const outgoingRef = doc(db, "users", myUid, "outgoingRequests", targetUid);
  const outgoingSnapshot = await getDoc(outgoingRef);
  if (outgoingSnapshot.exists()) {
    return { ok: true, message: "Bu kullanıcıya zaten istek gönderdin." };
  }

  const batch = writeBatch(db);
  batch.set(outgoingRef, {
    uid: targetUid,
    username: targetProfile.username || "",
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, "users", targetUid, "incomingRequests", myUid), {
    uid: myUid,
    username: currentUserProfile.username || "",
    createdAt: serverTimestamp()
  });
  await batch.commit();

  return { ok: true, message: "Arkadaş isteği gönderildi. O da seni eklerse arkadaş olursunuz." };
}

async function acceptFriendRequest(targetUid) {
  if (!currentUserProfile || !targetUid) {
    return;
  }

  const request = currentIncomingRequests.find((item) => item.uid === targetUid);
  if (!request) {
    return;
  }

  await createFriendship(request);
}

async function rejectFriendRequest(targetUid) {
  if (!currentUserProfile || !targetUid) {
    return;
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, "users", currentUserProfile.uid, "incomingRequests", targetUid));
  batch.delete(doc(db, "users", targetUid, "outgoingRequests", currentUserProfile.uid));
  await batch.commit();
}

async function cancelFriendRequest(targetUid) {
  if (!currentUserProfile || !targetUid) {
    return;
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, "users", currentUserProfile.uid, "outgoingRequests", targetUid));
  batch.delete(doc(db, "users", targetUid, "incomingRequests", currentUserProfile.uid));
  await batch.commit();
}

async function sendChatMessage() {
  if (!currentUserProfile || !selectedFriend?.uid) {
    return;
  }

  const text = chatInput.value.trim();
  if (!text) {
    return;
  }

  chatSendButton.disabled = true;

  try {
    const conversationId = getConversationId(currentUserProfile.uid, selectedFriend.uid);
    await setDoc(
      doc(db, "conversations", conversationId),
      {
        members: [currentUserProfile.uid, selectedFriend.uid],
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await addDoc(collection(db, "conversations", conversationId, "messages"), {
      text,
      senderUid: currentUserProfile.uid,
      senderUsername: currentUserProfile.username || "",
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    chatInput.value = "";
  } finally {
    chatSendButton.disabled = false;
  }
}

async function consumePremiumGenderFilter(targetGender) {
  if (!currentUserProfile?.uid) {
    throw new Error("Premium filtre için önce giriş yap.");
  }

  const cost = PREMIUM_FILTER_COSTS[targetGender];
  if (!cost) {
    throw new Error("Geçersiz premium filtre.");
  }

  const userRef = doc(db, "users", currentUserProfile.uid);
  const remainingDiamonds = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) {
      throw new Error("Kullanıcı profili bulunamadı.");
    }

    const currentDiamonds = Number(snapshot.data().diamonds || 0);
    if (currentDiamonds < cost) {
      throw new Error("Bu filtre için yeterli elmasın yok.");
    }

    const nextDiamonds = currentDiamonds - cost;
    transaction.update(userRef, {
      diamonds: nextDiamonds
    });

    return nextDiamonds;
  });

  currentUserProfile = {
    ...currentUserProfile,
    diamonds: remainingDiamonds
  };
  updateDiamondUi(remainingDiamonds);
  notifyUserProfileUpdated();

  return {
    cost,
    remainingDiamonds
  };
}

window.nexchatSocial = {
  sendFriendRequest
};

window.nexchatPremium = {
  consumeGenderFilter: consumePremiumGenderFilter
};

authModeButton.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthMode();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) {
    setAuthStatus("E-posta ve şifre gerekli.", true);
    return;
  }

  setAuthUiBusy(true);
  setAuthStatus(authMode === "login" ? "Giriş yapılıyor..." : "Hesap oluşturuluyor...");

  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await ensureUserProfile(credential.user);
    }
  } catch (error) {
    setAuthStatus(error.message, true);
  } finally {
    setAuthUiBusy(false);
  }
});

googleLoginButton.addEventListener("click", async () => {
  await signInWithProvider(googleProvider, "Google");
});

friendsSearch.addEventListener("input", () => {
  clearTimeout(searchTimeoutId);
  searchTimeoutId = setTimeout(() => {
    searchUsersByUsername(friendsSearch.value).catch((error) => {
      searchResults = [];
      renderFriendsPanel();
      console.error(error);
    });
  }, 180);
});

for (const button of [genderGirlButton, genderBoyButton]) {
  button.addEventListener("click", () => {
    genderInput.value = button.dataset.gender || "";
    syncGenderSelection();
  });
}

buyDiamondsButton.addEventListener("click", () => {
  setAuthStatus("Elmas satin alma ekrani yakinda aktif olacak.");
});

closeChatButton.addEventListener("click", () => {
  selectedFriend = null;
  currentMessages = [];
  clearChatSubscription();
  closeChatPanel();
  renderFriendsPanel();
});

incomingRequestsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  button.disabled = true;
  try {
    if (button.dataset.action === "accept-request") {
      await acceptFriendRequest(button.dataset.uid);
    } else if (button.dataset.action === "reject-request") {
      await rejectFriendRequest(button.dataset.uid);
    }
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

outgoingRequestsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='cancel-request']");
  if (!button) {
    return;
  }

  button.disabled = true;
  try {
    await cancelFriendRequest(button.dataset.uid);
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

friendsList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("button[data-action]");
  if (actionButton) {
    const targetUid = actionButton.dataset.uid;
    if (!targetUid) {
      return;
    }

    actionButton.disabled = true;
    try {
      if (actionButton.dataset.action === "send-request") {
        const profile = searchResults.find((item) => item.uid === targetUid);
        if (profile) {
          await sendFriendRequest(profile);
        }
      } else if (actionButton.dataset.action === "accept-request") {
        await acceptFriendRequest(targetUid);
      }
    } catch (error) {
      console.error(error);
    } finally {
      actionButton.disabled = false;
    }
    return;
  }

  const friendCard = event.target.closest("[data-select-friend]");
  if (!friendCard || friendsSearch.value.trim().length > 0) {
    return;
  }

  const friend = currentFriends.find((item) => item.uid === friendCard.dataset.selectFriend);
  if (!friend) {
    return;
  }

  subscribeToChat(friend);
  renderFriendsPanel();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendChatMessage();
});

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pendingProfileUser) {
    setUsernameStatus("Aktif kullanıcı bulunamadı.", true);
    return;
  }

  const username = sanitizeUsername(usernameInput.value);
  const usernameLower = normalizeUsernameLookup(usernameInput.value);
  const gender = genderInput.value;
  if (username.length < 3) {
    setUsernameStatus("Kullanıcı adı en az 3 karakter olmalı ve sadece harf, rakam, _ içermeli.", true);
    return;
  }

  if (gender !== "kiz" && gender !== "erkek") {
    setUsernameStatus("Lütfen cinsiyet seç.", true);
    return;
  }

  usernameSubmitButton.disabled = true;
  setUsernameStatus("Kaydediliyor...");

  try {
    await setDoc(
      doc(db, "users", pendingProfileUser.uid),
      {
        username,
        usernameLower,
        gender
      },
      { merge: true }
    );

    usernameOverlay.classList.add("hidden");
    await finalizeSignedInUser(pendingProfileUser, { username, usernameLower, gender });
  } catch (error) {
    setUsernameStatus(error.message, true);
  } finally {
    usernameSubmitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await writeOwnPresence(false);
    await signOut(auth);
  } catch (error) {
    setAuthStatus(error.message, true);
  } finally {
    logoutButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const existingProfile = await ensureUserProfile(user);
      document.body.classList.add("is-authenticated");
      await finalizeSignedInUser(user, existingProfile);
    } catch (error) {
      setAuthStatus(error.message, true);
    }
    return;
  }

  const previousUid = currentUserProfile?.uid || "";
  if (previousUid) {
    void writePresenceForUid(previousUid, false).catch(() => {});
  }
  authOverlay.classList.remove("hidden");
  usernameOverlay.classList.add("hidden");
  document.body.classList.remove("is-authenticated");
  sessionBadge.textContent = "Giriş yapılmadı";
  logoutButton.disabled = true;
  authPassword.value = "";
  usernameInput.value = "";
  genderInput.value = "";
  syncGenderSelection();
  chatInput.value = "";
  pendingProfileUser = null;
  currentUserProfile = null;
  stopPresenceHeartbeat();
  friendPresenceMap.clear();
  clearCurrentUserProfileSubscription();
  currentFriends = [];
  currentIncomingRequests = [];
  currentOutgoingRequests = [];
  currentMessages = [];
  selectedFriend = null;
  searchResults = [];
  friendsSearch.value = "";
  clearSocialSubscriptions();
  closeChatPanel();
  renderFriendsPanel();
  updateDiamondUi(0);
  window.dispatchEvent(
    new CustomEvent("auth-state", {
      detail: {
        authenticated: false,
        user: null
      }
    })
  );
});

window.addEventListener("mobile-tab-change", ({ detail }) => {
  if (!detail?.mobile || detail.activeTab === "friends") {
    return;
  }

  if (!isChatPanelOpen) {
    return;
  }

  selectedFriend = null;
  currentMessages = [];
  clearChatSubscription();
  closeChatPanel();
  renderFriendsPanel();
});

updateAuthMode();
syncGenderSelection();
renderFriendsPanel();
updateDiamondUi(0);
