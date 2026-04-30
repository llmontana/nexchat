const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CONTENT_SAFETY_ENDPOINT = process.env.CONTENT_SAFETY_ENDPOINT;
const CONTENT_SAFETY_KEY = process.env.CONTENT_SAFETY_KEY;
const CONTENT_SAFETY_API_VERSION = process.env.CONTENT_SAFETY_API_VERSION || "2024-09-15-preview";
const SEXUAL_SEVERITY_THRESHOLD = Number(process.env.SEXUAL_SEVERITY_THRESHOLD || 4);
const BAN_DURATION_MS = Number(process.env.BAN_DURATION_MS || 24 * 60 * 60 * 1000);
const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY || "AIzaSyBRX7sufaar-yZYDXVc15eqXCdvJNDoDjs";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "sametyesr72@gmail.com")
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

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

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
    return null;
  }

  return record;
}

function isIpBanned(ip) {
  return Boolean(getBanRecord(ip));
}

function banIp(ip, reason) {
  if (!ip) {
    return;
  }

  bannedIps.set(ip, {
    reason,
    expiresAt: Date.now() + BAN_DURATION_MS
  });
}

function unbanIp(ip) {
  if (!ip) {
    return false;
  }

  return bannedIps.delete(ip);
}

function isAdminEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  return ADMIN_EMAILS.includes(email.trim().toLocaleLowerCase("tr-TR"));
}

async function analyzeImageForNudity(base64Image) {
  if (!CONTENT_SAFETY_ENDPOINT || !CONTENT_SAFETY_KEY) {
    throw new Error("Content Safety servisi ayarlanmamis.");
  }

  const endpoint = CONTENT_SAFETY_ENDPOINT.replace(/\/$/, "");
  const response = await fetch(
    `${endpoint}/contentsafety/image:analyze?api-version=${CONTENT_SAFETY_API_VERSION}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": CONTENT_SAFETY_KEY
      },
      body: JSON.stringify({
        image: {
          content: base64Image
        },
        categories: ["Sexual"]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Content Safety hatasi: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const sexualCategory = Array.isArray(data.categoriesAnalysis)
    ? data.categoriesAnalysis.find((item) => item.category === "Sexual")
    : null;
  const severity = typeof sexualCategory?.severity === "number" ? sexualCategory.severity : 0;

  return {
    flagged: severity >= SEXUAL_SEVERITY_THRESHOLD,
    severity
  };
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
  matchPreferences.delete(firstId);
  matchPreferences.delete(secondId);

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

app.get("/api/admin/bans", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    response.json({
      bans: getBanList()
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

    banIp(ip, reason);
    response.json({
      ok: true,
      bans: getBanList()
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

    unbanIp(ip);
    response.json({
      ok: true,
      bans: getBanList()
    });
  } catch (error) {
    response.status(403).json({
      message: error.message
    });
  }
});

app.get("/api/admin/recent-sessions", async (request, response) => {
  try {
    await verifyAdminRequest(request);
    response.json({
      sessions: getRecentSessionList()
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

    recentUserSessions.set(authUser.uid, {
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

    recentUserSessions.set(uid, {
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
      const normalizedImage = imageData.replace(/^data:image\/\w+;base64,/, "");
      const result = await analyzeImageForNudity(normalizedImage);

      if (!result.flagged) {
        socket.emit("report-result", {
          ok: true,
          actionTaken: false,
          message: `İnceleme tamamlandı. Sexual severity: ${result.severity}.`
        });
        return;
      }

      const targetIp = getSocketIp(targetSocket);
      banIp(targetIp, `Sexual severity ${result.severity}`);

      targetSocket.emit("moderation-ban", {
        message: "Uygunsuz içerik nedeniyle erişimin geçici olarak engellendi."
      });
      leaveConversation(targetSocket, false);
      targetSocket.disconnect(true);

      socket.emit("report-result", {
        ok: true,
        actionTaken: true,
        message: `Rapor doğrulandı. Kullanıcı engellendi. Sexual severity: ${result.severity}.`
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
