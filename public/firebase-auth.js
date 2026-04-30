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
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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
const usernameSubmitButton = document.getElementById("usernameSubmitButton");
const usernameStatus = document.getElementById("usernameStatus");
const friendsSearch = document.getElementById("friendsSearch");
const friendsList = document.getElementById("friendsList");
const friendsCount = document.querySelector(".friends-count");
const incomingRequestsList = document.getElementById("incomingRequestsList");
const outgoingRequestsList = document.getElementById("outgoingRequestsList");
const incomingRequestsCount = document.getElementById("incomingRequestsCount");
const outgoingRequestsCount = document.getElementById("outgoingRequestsCount");

let authMode = "login";
const googleProvider = new GoogleAuthProvider();
let pendingProfileUser = null;
let currentUserProfile = null;
let currentFriends = [];
let currentIncomingRequests = [];
let currentOutgoingRequests = [];
let searchResults = [];
let friendsUnsubscribe = null;
let incomingUnsubscribe = null;
let outgoingUnsubscribe = null;
let searchTimeoutId = null;

function setAuthStatus(text, isError = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", isError);
}

function setUsernameStatus(text, isError = false) {
  usernameStatus.textContent = text;
  usernameStatus.classList.toggle("error", isError);
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

function setAuthUiBusy(busy) {
  authSubmitButton.disabled = busy;
  authModeButton.disabled = busy;
  googleLoginButton.disabled = busy;
}

function updateAuthMode() {
  const isLogin = authMode === "login";
  authSubmitButton.textContent = isLogin ? "Giriş Yap" : "Kayıt Ol";
  authModeButton.textContent = isLogin ? "Hesap Oluştur" : "Giriş Ekranına Dön";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  setAuthStatus(isLogin ? "Hazır" : "Yeni hesap oluşturabilirsin");
}

function getItemDisplayName(item) {
  return item.username || item.email || "isimsiz";
}

function getInitials(item) {
  return getItemDisplayName(item).slice(0, 2).toUpperCase();
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
    return;
  }

  friendsList.innerHTML = items
    .map((item) => {
      const initials = escapeHtml(getInitials(item));
      const title = escapeHtml(getItemDisplayName(item));
      const subtitle = escapeHtml(hasSearch ? "Kullanıcı bulundu" : "Arkadaş");

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
      }

      return `
        <article class="friend-item">
          <div class="friend-item-content">
            <strong>${title}</strong>
            <span>${subtitle}</span>
          </div>
          <div class="friend-item-actions">
            ${actionMarkup}
            <div class="friend-badge">${initials}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email || "",
      provider: user.providerData?.[0]?.providerId || "password",
      createdAt: snapshot.exists() ? snapshot.data().createdAt || serverTimestamp() : serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      isBanned: false
    },
    { merge: true }
  );

  return snapshot.exists() ? snapshot.data() : null;
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
}

function subscribeSocialCollections(uid) {
  clearSocialSubscriptions();

  friendsUnsubscribe = onSnapshot(collection(db, "users", uid, "friends"), (snapshot) => {
    currentFriends = snapshot.docs.map((docSnapshot) => docSnapshot.data());
    renderFriendsPanel();
  });

  incomingUnsubscribe = onSnapshot(collection(db, "users", uid, "incomingRequests"), (snapshot) => {
    currentIncomingRequests = snapshot.docs.map((docSnapshot) => docSnapshot.data());
    renderFriendsPanel();
  });

  outgoingUnsubscribe = onSnapshot(collection(db, "users", uid, "outgoingRequests"), (snapshot) => {
    currentOutgoingRequests = snapshot.docs.map((docSnapshot) => docSnapshot.data());
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
    username
  };
  subscribeSocialCollections(user.uid);

  usernameOverlay.classList.add("hidden");
  authOverlay.classList.add("hidden");
  sessionBadge.textContent = `${username} @ ${user.email || "aktif"}`;
  logoutButton.disabled = false;
  setAuthStatus("Giriş başarılı");
  window.dispatchEvent(
    new CustomEvent("auth-state", {
      detail: {
        authenticated: true,
        user: currentUserProfile
      }
    })
  );
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

window.nexchatSocial = {
  sendFriendRequest
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
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const targetUid = button.dataset.uid;
  if (!targetUid) {
    return;
  }

  button.disabled = true;

  try {
    if (button.dataset.action === "send-request") {
      const profile = searchResults.find((item) => item.uid === targetUid);
      if (profile) {
        await sendFriendRequest(profile);
      }
    } else if (button.dataset.action === "accept-request") {
      await acceptFriendRequest(targetUid);
    }
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pendingProfileUser) {
    setUsernameStatus("Aktif kullanıcı bulunamadı.", true);
    return;
  }

  const username = sanitizeUsername(usernameInput.value);
  const usernameLower = normalizeUsernameLookup(usernameInput.value);
  if (username.length < 3) {
    setUsernameStatus("Kullanıcı adı en az 3 karakter olmalı ve sadece harf, rakam, _ içermeli.", true);
    return;
  }

  usernameSubmitButton.disabled = true;
  setUsernameStatus("Kaydediliyor...");

  try {
    await setDoc(
      doc(db, "users", pendingProfileUser.uid),
      {
        username,
        usernameLower
      },
      { merge: true }
    );

    usernameOverlay.classList.add("hidden");
    await finalizeSignedInUser(pendingProfileUser, { username, usernameLower });
  } catch (error) {
    setUsernameStatus(error.message, true);
  } finally {
    usernameSubmitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
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

  authOverlay.classList.remove("hidden");
  usernameOverlay.classList.add("hidden");
  document.body.classList.remove("is-authenticated");
  sessionBadge.textContent = "Giriş yapılmadı";
  logoutButton.disabled = true;
  authPassword.value = "";
  usernameInput.value = "";
  pendingProfileUser = null;
  currentUserProfile = null;
  currentFriends = [];
  currentIncomingRequests = [];
  currentOutgoingRequests = [];
  searchResults = [];
  friendsSearch.value = "";
  clearSocialSubscriptions();
  renderFriendsPanel();
  window.dispatchEvent(
    new CustomEvent("auth-state", {
      detail: {
        authenticated: false,
        user: null
      }
    })
  );
});

updateAuthMode();
renderFriendsPanel();
