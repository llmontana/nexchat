const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { initializeApp, applicationDefault, cert, getApps } = require("firebase-admin/app");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const BAN_DURATION_MS = Number(process.env.BAN_DURATION_MS || 24 * 60 * 60 * 1000);
const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY || "AIzaSyBRX7sufaar-yZYDXVc15eqXCdvJNDoDjs";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "nexchat-69594";
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "";
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || "";
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
const TURN_URLS = (process.env.TURN_URLS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const TURN_USERNAME = process.env.TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || "";
const STUN_URLS = (process.env.STUN_URLS || "stun:stun.l.google.com:19302")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "sametyesr7@gmail.com")
  .split(",")
  .map((item) => item.trim().toLocaleLowerCase("tr-TR"))
  .filter(Boolean);
const waitingQueue = [];

const peers = new Map();
const socketProfiles = new Map();
const authenticatedSockets = new Map();
const recentUserSessions = new Map();
const matchPreferences = new Map();
const lastPartnerBySocket = new Map();
const rtcSignalEvents = new Set(["webrtc-offer", "webrtc-answer", "webrtc-ice-candidate"]);
const bannedIps = new Map();
const FIRESTORE_COLLECTIONS = {
  sessions: "server_recent_sessions",
  bans: "server_ip_bans",
  reports: "server_reports"
};
let adminFirestore = null;
let adminAuth = null;
let firestoreReady = false;
let firestoreInitError = null;

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

function normalizePrivateKey(privateKey) {
  return privateKey ? privateKey.replace(/\\n/g, "\n") : "";
}

function buildRtcConfig() {
  const iceServers = [];

  if (STUN_URLS.length > 0) {
    iceServers.push({
      urls: STUN_URLS.length === 1 ? STUN_URLS[0] : STUN_URLS
    });
  }

  if (TURN_URLS.length > 0 && TURN_USERNAME && TURN_CREDENTIAL) {
    iceServers.push({
      urls: TURN_URLS.length === 1 ? TURN_URLS[0] : TURN_URLS,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL
    });
  }

  return {
    iceServers,
    iceTransportPolicy: "all"
  };
}

function initializeFirestore() {
  try {
    if (!getApps().length) {
      if (FIREBASE_SERVICE_ACCOUNT_JSON) {
        const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
        initializeApp({
          credential: cert({
            projectId: serviceAccount.project_id,
            clientEmail: serviceAccount.client_email,
            privateKey: normalizePrivateKey(serviceAccount.private_key)
          })
        });
      } else if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
        initializeApp({
          credential: cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: normalizePrivateKey(FIREBASE_PRIVATE_KEY)
          })
        });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({
          credential: applicationDefault(),
          projectId: FIREBASE_PROJECT_ID
        });
      } else {
        throw new Error(
          "Firestore icin servis hesabi gerekli. FIREBASE_SERVICE_ACCOUNT_JSON veya FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY ayarla."
        );
      }
    }

    adminFirestore = getFirestore();
    adminAuth = getAdminAuth();
    firestoreReady = true;
  } catch (error) {
    firestoreReady = false;
    firestoreInitError = error;
    console.error("Firestore baslatilamadi, kalici sunucu verileri devre disi kaldi.", error);
  }
}

function isFirestoreReady() {
  return Boolean(firestoreReady && adminFirestore);
}

function encodeFirestoreKey(value) {
  return encodeURIComponent(String(value || "").trim());
}

function getSessionsCollection() {
  return adminFirestore.collection(FIRESTORE_COLLECTIONS.sessions);
}

function getBansCollection() {
  return adminFirestore.collection(FIRESTORE_COLLECTIONS.bans);
}

function getReportsCollection() {
  return adminFirestore.collection(FIRESTORE_COLLECTIONS.reports);
}

function getConversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

function createSessionPayload(session) {
  return {
    uid: session.uid,
    username: session.username || "",
    email: session.email || "",
    ip: session.ip || "",
    lastSeen: session.lastSeen || Date.now(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function persistRecentSession(session) {
  if (!session?.uid) {
    return;
  }

  recentUserSessions.set(session.uid, {
    uid: session.uid,
    username: session.username || "",
    email: session.email || "",
    ip: session.ip || "",
    lastSeen: session.lastSeen || Date.now()
  });

  if (!isFirestoreReady()) {
    return;
  }

  try {
    await getSessionsCollection().doc(session.uid).set(createSessionPayload(session), {
      merge: true
    });
  } catch (error) {
    console.error("Recent session Firestore'a yazilamadi.", error);
  }
}

async function persistBan(ip, record) {
  if (!ip) {
    return;
  }

  bannedIps.set(ip, {
    reason: record.reason,
    expiresAt: record.expiresAt
  });

  if (!isFirestoreReady()) {
    return;
  }

  try {
    await getBansCollection()
      .doc(encodeFirestoreKey(ip))
      .set(
        {
          ip,
          reason: record.reason,
          expiresAt: record.expiresAt,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  } catch (error) {
    console.error("IP ban Firestore'a yazilamadi.", error);
  }
}

async function deleteBanFromPersistence(ip) {
  if (!ip) {
    return;
  }

  bannedIps.delete(ip);
  if (!isFirestoreReady()) {
    return;
  }

  try {
    await getBansCollection().doc(encodeFirestoreKey(ip)).delete();
  } catch (error) {
    console.error("IP ban Firestore'dan silinemedi.", error);
  }
}

async function restorePersistentState() {
  if (!isFirestoreReady()) {
    return;
  }

  try {
    const [sessionsSnapshot, bansSnapshot] = await Promise.all([
      getSessionsCollection().get(),
      getBansCollection().get()
    ]);

    sessionsSnapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      if (!data.uid) {
        return;
      }

      recentUserSessions.set(data.uid, {
        uid: data.uid,
        username: typeof data.username === "string" ? data.username : "",
        email: typeof data.email === "string" ? data.email : "",
        ip: typeof data.ip === "string" ? data.ip : "",
        lastSeen: typeof data.lastSeen === "number" ? data.lastSeen : Date.now()
      });
    });

    const now = Date.now();
    const expiredBanDeletes = [];
    bansSnapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      if (!data.ip) {
        return;
      }

      const expiresAt =
        typeof data.expiresAt === "number"
          ? data.expiresAt
          : data.expiresAt instanceof Timestamp
            ? data.expiresAt.toMillis()
            : 0;

      if (!expiresAt || expiresAt <= now) {
        expiredBanDeletes.push(docSnapshot.ref.delete().catch(() => null));
        return;
      }

      bannedIps.set(data.ip, {
        reason: typeof data.reason === "string" ? data.reason : "Belirtilmedi",
        expiresAt
      });
    });

    if (expiredBanDeletes.length > 0) {
      await Promise.all(expiredBanDeletes);
    }
  } catch (error) {
    console.error("Firestore kalici verileri yuklenemedi.", error);
  }
}

async function getBanListFromStore() {
  if (!isFirestoreReady()) {
    return getBanList();
  }

  try {
    const now = Date.now();
    const snapshot = await getBansCollection().get();
    const results = [];
    const expiredDeletes = [];

    bannedIps.clear();

    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      const expiresAt =
        typeof data.expiresAt === "number"
          ? data.expiresAt
          : data.expiresAt instanceof Timestamp
            ? data.expiresAt.toMillis()
            : 0;

      if (!data.ip || !expiresAt || expiresAt <= now) {
        expiredDeletes.push(docSnapshot.ref.delete().catch(() => null));
        return;
      }

      const record = {
        ip: data.ip,
        reason: typeof data.reason === "string" ? data.reason : "Belirtilmedi",
        expiresAt
      };
      bannedIps.set(record.ip, {
        reason: record.reason,
        expiresAt: record.expiresAt
      });
      results.push(record);
    });

    if (expiredDeletes.length > 0) {
      await Promise.all(expiredDeletes);
    }

    return results.sort((a, b) => b.expiresAt - a.expiresAt);
  } catch (error) {
    console.error("Ban listesi Firestore'dan okunamadi.", error);
    return getBanList();
  }
}

async function getRecentSessionListFromStore() {
  if (!isFirestoreReady()) {
    return getRecentSessionList();
  }

  try {
    const snapshot = await getSessionsCollection().orderBy("lastSeen", "desc").limit(300).get();
    const results = [];

    recentUserSessions.clear();

    snapshot.forEach((docSnapshot) => {
      const data = docSnapshot.data() || {};
      if (!data.uid) {
        return;
      }

      const session = {
        uid: data.uid,
        username: typeof data.username === "string" ? data.username : "",
        email: typeof data.email === "string" ? data.email : "",
        ip: typeof data.ip === "string" ? data.ip : "",
        lastSeen: typeof data.lastSeen === "number" ? data.lastSeen : Date.now()
      };

      recentUserSessions.set(session.uid, session);
      results.push(session);
    });

    return results;
  } catch (error) {
    console.error("Recent session listesi Firestore'dan okunamadi.", error);
    return getRecentSessionList();
  }
}

async function createReportRecord(payload) {
  if (!isFirestoreReady()) {
    return null;
  }

  const createdAt = Date.now();
  const docRef = await getReportsCollection().add({
    ...payload,
    createdAt,
    updatedAt: FieldValue.serverTimestamp()
  });

  return {
    id: docRef.id,
    createdAt
  };
}

async function updateReportRecord(reportId, payload) {
  if (!isFirestoreReady() || !reportId) {
    return;
  }

  await getReportsCollection().doc(reportId).set(
    {
      ...payload,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function getReportsListFromStore() {
  if (!isFirestoreReady()) {
    return [];
  }

  try {
    const snapshot = await getReportsCollection().orderBy("createdAt", "desc").limit(100).get();
    return snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
  } catch (error) {
    console.error("Rapor listesi Firestore'dan okunamadi.", error);
    return [];
  }
}

async function commitDeleteOperations(operations) {
  if (!operations.length) {
    return;
  }

  const chunkSize = 400;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = adminFirestore.batch();
    operations.slice(index, index + chunkSize).forEach((ref) => {
      batch.delete(ref);
    });
    await batch.commit();
  }
}

async function recursiveDeleteDocument(ref) {
  if (!ref) {
    return;
  }

  try {
    await adminFirestore.recursiveDelete(ref);
  } catch (error) {
    try {
      await ref.delete();
    } catch {
      console.error("Belge silinemedi.", error);
    }
  }
}

async function deleteUserAccount(uid, actingAdminUid) {
  if (!isFirestoreReady()) {
    throw new Error("Firestore hazir degil.");
  }

  if (!adminAuth) {
    throw new Error("Admin auth hazir degil.");
  }

  if (!uid) {
    throw new Error("Gecerli bir kullanici gerekli.");
  }

  if (uid === actingAdminUid) {
    throw new Error("Kendi admin hesabini bu panelden silemezsin.");
  }

  const userRef = adminFirestore.collection("users").doc(uid);
  const [userSnapshot, friendsSnapshot, incomingSnapshot, outgoingSnapshot] = await Promise.all([
    userRef.get(),
    userRef.collection("friends").get(),
    userRef.collection("incomingRequests").get(),
    userRef.collection("outgoingRequests").get()
  ]);

  if (!userSnapshot.exists) {
    throw new Error("Silinecek kullanici bulunamadi.");
  }

  const relatedUids = new Set();
  const deleteRefs = [];

  friendsSnapshot.forEach((docSnapshot) => {
    const relatedUid = docSnapshot.id;
    relatedUids.add(relatedUid);
    deleteRefs.push(docSnapshot.ref);
    deleteRefs.push(
      adminFirestore.collection("users").doc(relatedUid).collection("friends").doc(uid)
    );
  });

  incomingSnapshot.forEach((docSnapshot) => {
    const relatedUid = docSnapshot.id;
    relatedUids.add(relatedUid);
    deleteRefs.push(docSnapshot.ref);
    deleteRefs.push(
      adminFirestore.collection("users").doc(relatedUid).collection("outgoingRequests").doc(uid)
    );
  });

  outgoingSnapshot.forEach((docSnapshot) => {
    const relatedUid = docSnapshot.id;
    relatedUids.add(relatedUid);
    deleteRefs.push(docSnapshot.ref);
    deleteRefs.push(
      adminFirestore.collection("users").doc(relatedUid).collection("incomingRequests").doc(uid)
    );
  });

  await commitDeleteOperations(deleteRefs);

  const conversationDeletes = [];
  for (const relatedUid of relatedUids) {
    const conversationId = getConversationId(uid, relatedUid);
    conversationDeletes.push(
      recursiveDeleteDocument(adminFirestore.collection("conversations").doc(conversationId))
    );
  }

  await Promise.all(conversationDeletes);
  await recursiveDeleteDocument(userRef);

  recentUserSessions.delete(uid);
  try {
    await getSessionsCollection().doc(uid).delete();
  } catch {}

  for (const [socketId, authUser] of authenticatedSockets.entries()) {
    if (authUser?.uid !== uid) {
      continue;
    }

    const userSocket = io.sockets.sockets.get(socketId);
    if (userSocket) {
      leaveConversation(userSocket, false);
      userSocket.emit("moderation-ban", {
        message: "Hesabin yonetici tarafindan kapatildi."
      });
      userSocket.disconnect(true);
    }

    authenticatedSockets.delete(socketId);
    socketProfiles.delete(socketId);
    matchPreferences.delete(socketId);
    lastPartnerBySocket.delete(socketId);
  }

  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }
}

function getRequestIp(request) {
  return request.ip || request.socket.remoteAddress || "";
}

function getSocketIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return socket.handshake.address || "";
}

function getBanRecord(ip) {
  if (!ip) {
    return null;
  }

  const record = bannedIps.get(ip);
  if (!record) {
    return null;
  }

  if (record.expiresAt <= Date.now()) {
    bannedIps.delete(ip);
    void deleteBanFromPersistence(ip);
    return null;
  }

  return record;
}

function isIpBanned(ip) {
  return Boolean(getBanRecord(ip));
}

async function banIp(ip, reason) {
  if (!ip) {
    return;
  }

  await persistBan(ip, {
    reason,
    expiresAt: Date.now() + BAN_DURATION_MS
  });
}

async function unbanIp(ip) {
  if (!ip) {
    return false;
  }

  const deleted = bannedIps.delete(ip);
  if (deleted) {
    await deleteBanFromPersistence(ip);
  }
  return deleted;
}

function isAdminEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  return ADMIN_EMAILS.includes(email.trim().toLocaleLowerCase("tr-TR"));
}

async function verifyFirebaseIdToken(idToken) {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error("Firebase API anahtari ayarlanmamis.");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        idToken
      })
    }
  );

  const data = await response.json();
  if (!response.ok || !Array.isArray(data.users) || data.users.length === 0) {
    const message =
      data?.error?.message || `Kimlik dogrulamasi basarisiz oldu (${response.status}).`;
    throw new Error(message);
  }

  const [user] = data.users;
  return {
    uid: user.localId || "",
    email: user.email || ""
  };
}

async function verifyAdminRequest(request) {
  const authHeader = request.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error("Yetkili kimlik bilgisi bulunamadi.");
  }

  const authUser = await verifyFirebaseIdToken(match[1]);
  if (!isAdminEmail(authUser.email)) {
    throw new Error("Bu islem icin admin yetkisi gerekiyor.");
  }

  return authUser;
}

initializeFirestore();

app.use((request, response, next) => {
  const ip = getRequestIp(request);
  const banRecord = getBanRecord(ip);

  if (!banRecord) {
    next();
    return;
  }

  response.status(403).send("Bu erişim engellendi.");
});

function pairSockets(firstId, secondId) {
  peers.set(firstId, secondId);
  peers.set(secondId, firstId);

  io.to(firstId).emit("partner-found", {
    initiator: true,
    partnerProfile: getPublicProfile(secondId)
  });
  io.to(secondId).emit("partner-found", {
    initiator: false,
    partnerProfile: getPublicProfile(firstId)
  });
}

function getPartnerId(socketId) {
  return peers.get(socketId) || null;
}

function clearPair(socketId) {
  const partnerId = peers.get(socketId);

  if (!partnerId) {
    return null;
  }

  peers.delete(socketId);
  peers.delete(partnerId);
  lastPartnerBySocket.set(socketId, partnerId);
  lastPartnerBySocket.set(partnerId, socketId);
  return partnerId;
}

function enqueueSocket(socket) {
  if (waitingQueue.includes(socket.id)) {
    return;
  }

  for (let index = 0; index < waitingQueue.length; index += 1) {
    const queuedSocketId = waitingQueue[index];
    if (queuedSocketId === socket.id) {
      continue;
    }

    const otherSocket = io.sockets.sockets.get(queuedSocketId);
    if (!otherSocket) {
      waitingQueue.splice(index, 1);
      index -= 1;
      continue;
    }

    if (canPairSockets(queuedSocketId, socket.id)) {
      waitingQueue.splice(index, 1);
      pairSockets(queuedSocketId, socket.id);
      return;
    }
  }

  waitingQueue.push(socket.id);
  socket.emit("waiting");
}

function removeFromQueue(socketId) {
  const queueIndex = waitingQueue.indexOf(socketId);
  if (queueIndex >= 0) {
    waitingQueue.splice(queueIndex, 1);
  }
}

function leaveConversation(socket, shouldRequeue) {
  removeFromQueue(socket.id);

  const partnerId = clearPair(socket.id);
  if (partnerId) {
    io.to(partnerId).emit("partner-left");

    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) {
      enqueueSocket(partnerSocket);
    }
  }

  if (shouldRequeue) {
    enqueueSocket(socket);
  }
}

function getPublicProfile(socketId) {
  const profile = socketProfiles.get(socketId);
  if (!profile) {
    return null;
  }

  return {
    uid: profile.uid,
    username: profile.username
  };
}

function isSocketAuthenticated(socketId) {
  return authenticatedSockets.has(socketId);
}

function getBanList() {
  const now = Date.now();
  return [...bannedIps.entries()]
    .map(([ip, record]) => ({
      ip,
      reason: record.reason || "Belirtilmedi",
      expiresAt: record.expiresAt
    }))
    .filter((item) => item.expiresAt > now)
    .sort((a, b) => b.expiresAt - a.expiresAt);
}

function getRecentSessionList() {
  return [...recentUserSessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function normalizeGenderFilter(value) {
  return value === "kiz" || value === "erkek" ? value : "any";
}

function canPairSockets(firstSocketId, secondSocketId) {
  if (
    lastPartnerBySocket.get(firstSocketId) === secondSocketId ||
    lastPartnerBySocket.get(secondSocketId) === firstSocketId
  ) {
    return false;
  }

  const firstProfile = socketProfiles.get(firstSocketId);
  const secondProfile = socketProfiles.get(secondSocketId);
  if (!firstProfile || !secondProfile) {
    return false;
  }

  const firstPreference = matchPreferences.get(firstSocketId) || "any";
  const secondPreference = matchPreferences.get(secondSocketId) || "any";
  const firstGender = firstProfile.gender || "";
  const secondGender = secondProfile.gender || "";

  if (firstPreference !== "any" && secondGender !== firstPreference) {
    return false;
  }

  if (secondPreference !== "any" && firstGender !== secondPreference) {
    return false;
  }

  return true;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/rtc-config", (request, response) => {
  response.json({
    rtcConfig: buildRtcConfig(),
    turnEnabled: TURN_URLS.length > 0 && Boolean(TURN_USERNAME && TURN_CREDENTIAL)
  });
});

app.get("/api/admin/bans", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    response.json({
      bans: await getBanListFromStore()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.post("/api/admin/bans", async (request, response) => {
  try {
    const adminUser = await verifyAdminRequest(request);
    const ip = typeof request.body?.ip === "string" ? request.body.ip.trim() : "";
    const reason =
      typeof request.body?.reason === "string" && request.body.reason.trim()
        ? request.body.reason.trim().slice(0, 180)
        : `Admin ban: ${adminUser.email}`;

    if (!ip) {
      response.status(400).json({
        message: "Gecerli bir IP gerekli."
      });
      return;
    }

    await banIp(ip, reason);
    response.json({
      ok: true,
      bans: await getBanListFromStore()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.delete("/api/admin/bans/:ip", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    const ip = typeof request.params.ip === "string" ? request.params.ip.trim() : "";
    if (!ip) {
      response.status(400).json({
        message: "Gecerli bir IP gerekli."
      });
      return;
    }

    await unbanIp(ip);
    response.json({
      ok: true,
      bans: await getBanListFromStore()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.delete("/api/admin/users/:uid", async (request, response) => {
  try {
    const adminUser = await verifyAdminRequest(request);
    const uid = typeof request.params.uid === "string" ? request.params.uid.trim() : "";

    if (!uid) {
      response.status(400).json({
        message: "Gecerli bir kullanici gerekli."
      });
      return;
    }

    await deleteUserAccount(uid, adminUser.uid);
    response.json({
      ok: true
    });
  } catch (error) {
    response.status(400).json({
      message: error.message
    });
  }
});

app.get("/api/admin/recent-sessions", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    response.json({
      sessions: await getRecentSessionListFromStore()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.get("/api/admin/reports", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    response.json({
      reports: await getReportsListFromStore()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.post("/api/session-sync", async (request, response) => {
  try {
    const authHeader = request.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      response.status(401).json({
        message: "Kimlik dogrulamasi gerekli."
      });
      return;
    }

    const authUser = await verifyFirebaseIdToken(match[1]);
    const username =
      typeof request.body?.username === "string" ? request.body.username.trim().slice(0, 20) : "";

    await persistRecentSession({
      uid: authUser.uid,
      username,
      email: authUser.email || "",
      ip: getRequestIp(request),
      lastSeen: Date.now()
    });

    response.json({
      ok: true
    });
  } catch (error) {
    response.status(401).json({
      message: error.message
    });
  }
});

io.use((socket, next) => {
  const ip = getSocketIp(socket);
  const banRecord = getBanRecord(ip);

  if (banRecord) {
    next(new Error("Bu cihaz geçici olarak engellendi."));
    return;
  }

  next();
});

io.on("connection", (socket) => {
  socket.emit("status", "Sunucuya bağlandın.");

  socket.on("authenticate-user", async ({ idToken }) => {
    if (typeof idToken !== "string" || idToken.trim().length === 0) {
      socket.emit("authentication-result", {
        ok: false,
        message: "Gecerli bir kimlik belirteci gerekli."
      });
      return;
    }

    try {
      const authUser = await verifyFirebaseIdToken(idToken.trim());
      authenticatedSockets.set(socket.id, authUser);
      await persistRecentSession({
        uid: authUser.uid,
        username: recentUserSessions.get(authUser.uid)?.username || "",
        email: authUser.email || "",
        ip: getSocketIp(socket),
        lastSeen: Date.now()
      });
      socket.emit("authentication-result", {
        ok: true
      });
    } catch (error) {
      authenticatedSockets.delete(socket.id);
      socketProfiles.delete(socket.id);
      removeFromQueue(socket.id);
      socket.emit("authentication-result", {
        ok: false,
        message: error.message
      });
    }
  });

  socket.on("sign-out", () => {
    authenticatedSockets.delete(socket.id);
    socketProfiles.delete(socket.id);
    matchPreferences.delete(socket.id);
    leaveConversation(socket, false);
  });

  socket.on("user-profile", (profile) => {
    const authUser = authenticatedSockets.get(socket.id);
    if (!authUser || !profile || typeof profile !== "object") {
      return;
    }

    const username =
      typeof profile.username === "string" ? profile.username.trim().slice(0, 20) : "";
    const uid = typeof profile.uid === "string" ? profile.uid.trim().slice(0, 128) : "";
    const gender =
      profile.gender === "kiz" || profile.gender === "erkek" ? profile.gender : "";
    if (!uid || uid !== authUser.uid) {
      socket.emit("status", "Profil dogrulamasi basarisiz.");
      return;
    }

    socketProfiles.set(socket.id, {
      username,
      uid,
      gender
    });

    void persistRecentSession({
      uid,
      username,
      email: authUser.email || "",
      ip: getSocketIp(socket),
      lastSeen: Date.now()
    });

    const partnerId = getPartnerId(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partner-profile", getPublicProfile(socket.id));
    }
  });

  socket.on("find-partner", ({ genderFilter } = {}) => {
    if (!isSocketAuthenticated(socket.id)) {
      socket.emit("status", "Eslesmek icin once giris yapman gerekiyor.");
      return;
    }

    if (!socketProfiles.has(socket.id)) {
      socket.emit("status", "Profilin hazir degil, lutfen tekrar giris yap.");
      return;
    }

    if (getPartnerId(socket.id)) {
      socket.emit("status", "Zaten bir eşleşmen var.");
      return;
    }

    matchPreferences.set(socket.id, normalizeGenderFilter(genderFilter));
    enqueueSocket(socket);
  });

  for (const eventName of rtcSignalEvents) {
    socket.on(eventName, (payload) => {
      const partnerId = getPartnerId(socket.id);
      if (!partnerId) {
        return;
      }

      io.to(partnerId).emit(eventName, payload);
    });
  }

  socket.on("next-partner", () => {
    leaveConversation(socket, true);
  });

  socket.on("stop-matching", () => {
    leaveConversation(socket, false);
  });

  socket.on("set-match-filter", ({ genderFilter } = {}) => {
    if (!isSocketAuthenticated(socket.id)) {
      return;
    }

    matchPreferences.set(socket.id, normalizeGenderFilter(genderFilter));
  });

  socket.on("report-user", async ({ imageData }) => {
    const partnerId = getPartnerId(socket.id);
    if (!partnerId || typeof imageData !== "string" || imageData.length === 0) {
      socket.emit("report-result", {
        ok: false,
        message: "Rapor için geçerli bir görüntü bulunamadı."
      });
      return;
    }

    const targetSocket = io.sockets.sockets.get(partnerId);
    if (!targetSocket) {
      socket.emit("report-result", {
        ok: false,
        message: "Raporlanan kullanıcı bulunamadı."
      });
      return;
    }

    try {
      const reporterAuth = authenticatedSockets.get(socket.id);
      const reportedAuth = authenticatedSockets.get(partnerId);
      const reporterProfile = socketProfiles.get(socket.id);
      const reportedProfile = socketProfiles.get(partnerId);
      await createReportRecord({
        reporter: {
          uid: reporterProfile?.uid || reporterAuth?.uid || "",
          username: reporterProfile?.username || "",
          email: reporterAuth?.email || ""
        },
        reported: {
          uid: reportedProfile?.uid || reportedAuth?.uid || "",
          username: reportedProfile?.username || "",
          email: reportedAuth?.email || ""
        },
        imageData,
        status: "pending",
        reviewSource: "manual",
        severity: null
      });

      socket.emit("report-result", {
        ok: true,
        actionTaken: false,
        message: "Rapor admin paneline gonderildi. Inceleme manuel yapilacak."
      });
    } catch (error) {
      socket.emit("report-result", {
        ok: false,
        message: error.message
      });
    }
  });

  socket.on("disconnect", () => {
    leaveConversation(socket, false);
    socketProfiles.delete(socket.id);
    authenticatedSockets.delete(socket.id);
    matchPreferences.delete(socket.id);
    lastPartnerBySocket.delete(socket.id);
  });
});

async function bootstrap() {
  await restorePersistentState();

  server.listen(PORT, () => {
    if (isFirestoreReady()) {
      console.log(`Server running on http://localhost:${PORT} (Firestore persistence active)`);
      return;
    }

    const reason = firestoreInitError ? `: ${firestoreInitError.message}` : ".";
    console.warn(
      `Server running on http://localhost:${PORT} (Firestore persistence disabled${reason})`
    );
  });
}

bootstrap().catch((error) => {
  console.error("Sunucu baslatilamadi.", error);
  process.exit(1);
});
