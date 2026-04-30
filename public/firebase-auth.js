import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
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

let authMode = "login";
const googleProvider = new GoogleAuthProvider();
let pendingProfileUser = null;

function setAuthStatus(text, isError = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("error", isError);
}

function updateAuthMode() {
  const isLogin = authMode === "login";
  authSubmitButton.textContent = isLogin ? "Giris Yap" : "Kayit Ol";
  authModeButton.textContent = isLogin ? "Hesap Olustur" : "Giris Ekranina Don";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  setAuthStatus(isLogin ? "Hazir" : "Yeni hesap olusturabilirsin");
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

function setAuthUiBusy(busy) {
  authSubmitButton.disabled = busy;
  authModeButton.disabled = busy;
  googleLoginButton.disabled = busy;
}

function setUsernameStatus(text, isError = false) {
  usernameStatus.textContent = text;
  usernameStatus.classList.toggle("error", isError);
}

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function openUsernameSetup(user, suggestedName = "") {
  pendingProfileUser = user;
  authOverlay.classList.add("hidden");
  usernameOverlay.classList.remove("hidden");
  usernameInput.value = suggestedName;
  setUsernameStatus("Kullanici adini belirle");
  setTimeout(() => usernameInput.focus(), 0);
}

async function finalizeSignedInUser(user, existingProfile) {
  const username = existingProfile?.username?.trim();
  if (!username) {
    const fallbackName = user.displayName
      ? user.displayName.replace(/\s+/g, "").toLowerCase()
      : "";
    openUsernameSetup(user, fallbackName);
    return;
  }

  usernameOverlay.classList.add("hidden");
  authOverlay.classList.add("hidden");
  sessionBadge.textContent = `${username} @ ${user.email || "aktif"}`;
  logoutButton.disabled = false;
  setAuthStatus("Giris basarili");
  window.dispatchEvent(
    new CustomEvent("auth-state", {
      detail: {
        authenticated: true,
        user: {
          uid: user.uid,
          email: user.email || "",
          username
        }
      }
    })
  );
}

async function signInWithProvider(provider, providerName) {
  setAuthUiBusy(true);
  setAuthStatus(`${providerName} ile giris yapiliyor...`);

  try {
    const credential = await signInWithPopup(auth, provider);
    await ensureUserProfile(credential.user);
  } catch (error) {
    setAuthStatus(error.message, true);
  } finally {
    setAuthUiBusy(false);
  }
}

authModeButton.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthMode();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) {
    setAuthStatus("E-posta ve sifre gerekli.", true);
    return;
  }

  setAuthUiBusy(true);
  setAuthStatus(authMode === "login" ? "Giris yapiliyor..." : "Hesap olusturuluyor...");

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

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pendingProfileUser) {
    setUsernameStatus("Aktif kullanici bulunamadi.", true);
    return;
  }

  const username = normalizeUsername(usernameInput.value);
  if (username.length < 3) {
    setUsernameStatus("Kullanici adi en az 3 karakter olmali ve sadece harf, rakam, _ icermeli.", true);
    return;
  }

  usernameSubmitButton.disabled = true;
  setUsernameStatus("Kaydediliyor...");

  try {
    await setDoc(
      doc(db, "users", pendingProfileUser.uid),
      {
        username,
        usernameLower: username
      },
      { merge: true }
    );

    usernameOverlay.classList.add("hidden");
    await finalizeSignedInUser(pendingProfileUser, { username });
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
  sessionBadge.textContent = "Giris yapilmadi";
  logoutButton.disabled = true;
  authPassword.value = "";
  usernameInput.value = "";
  pendingProfileUser = null;
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
