import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
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
const appleLoginButton = document.getElementById("appleLoginButton");

let authMode = "login";
const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");

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
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      provider: user.providerData?.[0]?.providerId || "password",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      isBanned: false
    },
    { merge: true }
  );
}

function setAuthUiBusy(busy) {
  authSubmitButton.disabled = busy;
  authModeButton.disabled = busy;
  googleLoginButton.disabled = busy;
  appleLoginButton.disabled = busy;
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

appleLoginButton.addEventListener("click", async () => {
  await signInWithProvider(appleProvider, "Apple");
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
      await ensureUserProfile(user);
      authOverlay.classList.add("hidden");
      sessionBadge.textContent = user.email || "Giris yapildi";
      logoutButton.disabled = false;
      setAuthStatus("Giris basarili");
      window.dispatchEvent(
        new CustomEvent("auth-state", {
          detail: {
            authenticated: true,
            user: {
              uid: user.uid,
              email: user.email || ""
            }
          }
        })
      );
    } catch (error) {
      setAuthStatus(error.message, true);
    }

    return;
  }

  authOverlay.classList.remove("hidden");
  sessionBadge.textContent = "Giris yapilmadi";
  logoutButton.disabled = true;
  authPassword.value = "";
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
