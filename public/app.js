const socket = io();

const startButton = document.getElementById("startButton");
const findButton = document.getElementById("findButton");
const nextButton = document.getElementById("nextButton");
const reportButton = document.getElementById("reportButton");
const toggleMicButton = document.getElementById("toggleMicButton");
const toggleCameraButton = document.getElementById("toggleCameraButton");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusBadge = document.getElementById("statusBadge");
const eventLog = document.getElementById("eventLog");
const deviceBadge = document.getElementById("deviceBadge");
const mobileDrawerToggle = document.getElementById("mobileDrawerToggle");

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

let localStream = null;
let peerConnection = null;
let makingOffer = false;
let ignoreOffer = false;
let politePeer = false;
let hasRemoteDescription = false;
let pendingIceCandidates = [];
let mediaReady = false;
let isMatching = false;
let isConnected = false;
let mobileControlsCollapsed = false;
let reportInFlight = false;

function detectMobileLayout() {
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(
    navigator.userAgent
  );
  const narrowScreen = window.matchMedia("(max-width: 900px)").matches;
  const touchDevice = navigator.maxTouchPoints > 0;

  return mobileUserAgent || (narrowScreen && touchDevice);
}

function applyDeviceMode() {
  const isMobile = detectMobileLayout();
  document.body.classList.toggle("is-mobile", isMobile);
  document.body.classList.toggle("is-desktop", !isMobile);
  document.body.classList.toggle("mobile-controls-collapsed", isMobile && mobileControlsCollapsed);
  deviceBadge.textContent = isMobile ? "Mobile Mode" : "Desktop Mode";

  if (!isMobile) {
    mobileControlsCollapsed = false;
    mobileDrawerToggle.setAttribute("aria-expanded", "true");
    mobileDrawerToggle.setAttribute("aria-label", "Kontrolleri gizle");
  }
}

function setStatus(text) {
  statusBadge.textContent = text;
}

function syncMediaToggleLabels() {
  if (!localStream) {
    toggleMicButton.textContent = "Sesi Kapat";
    toggleCameraButton.textContent = "Kamerayi Kapat";
    return;
  }

  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  toggleMicButton.textContent =
    audioTrack && !audioTrack.enabled ? "Sesi Ac" : "Sesi Kapat";
  toggleCameraButton.textContent =
    videoTrack && !videoTrack.enabled ? "Kamerayi Ac" : "Kamerayi Kapat";
}

function resumeRemotePlayback() {
  if (!remoteVideo.srcObject) {
    return;
  }

  remoteVideo.play().catch(() => {});
}

function syncMobileDrawerState() {
  const isMobile = document.body.classList.contains("is-mobile");
  const collapsed = isMobile && mobileControlsCollapsed;

  document.body.classList.toggle("mobile-controls-collapsed", collapsed);
  mobileDrawerToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  mobileDrawerToggle.setAttribute(
    "aria-label",
    collapsed ? "Kontrolleri goster" : "Kontrolleri gizle"
  );
}

function syncActionButtons() {
  startButton.disabled = mediaReady;
  findButton.disabled = !mediaReady || isMatching || isConnected;
  nextButton.disabled = !mediaReady || (!isMatching && !isConnected);
  reportButton.disabled = !isConnected || reportInFlight;
}

function logEvent(text) {
  const item = document.createElement("article");
  item.className = "event-item";
  item.textContent = text;
  eventLog.appendChild(item);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function setDeviceControlsEnabled(enabled) {
  reportButton.disabled = !enabled || !isConnected || reportInFlight;
  toggleMicButton.disabled = !enabled;
  toggleCameraButton.disabled = !enabled;
  syncMediaToggleLabels();
}

function captureRemoteFrame() {
  if (!remoteVideo.srcObject || remoteVideo.readyState < 2) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const sourceWidth = remoteVideo.videoWidth || 640;
  const sourceHeight = remoteVideo.videoHeight || 360;
  const maxWidth = 640;
  const scale = Math.min(1, maxWidth / sourceWidth);

  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function setConnectedState(connected) {
  isConnected = connected;
  if (!connected) {
    remoteVideo.pause();
  }

  syncActionButtons();
  remotePlaceholder.classList.toggle("hidden", connected);
}

async function ensureLocalMedia() {
  if (localStream) {
    return localStream;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user"
    }
  });

  localStream = stream;
  localVideo.srcObject = stream;
  localVideo.play().catch(() => {});
  mediaReady = true;
  setDeviceControlsEnabled(true);
  syncMediaToggleLabels();
  findButton.disabled = false;
  setStatus("Kamera hazir");
  syncActionButtons();
  return stream;
}

function resetRemoteVideo() {
  remoteVideo.srcObject = null;
  remoteVideo.load();
  isMatching = false;
  setConnectedState(false);
}

function cleanupPeerConnection() {
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onnegotiationneeded = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  makingOffer = false;
  ignoreOffer = false;
  hasRemoteDescription = false;
  pendingIceCandidates = [];
  resetRemoteVideo();
}

function createPeerConnection() {
  cleanupPeerConnection();

  const connection = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach((track) => {
    connection.addTrack(track, localStream);
  });

  connection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("webrtc-ice-candidate", candidate);
    }
  };

  connection.ontrack = (event) => {
    const [stream] = event.streams;
    remoteVideo.srcObject = stream;
    remoteVideo.muted = false;
    remoteVideo.volume = 1;
    remoteVideo.play().catch(() => {
      logEvent("Karsi tarafin sesi icin ekrana dokunman gerekebilir.");
    });
    setConnectedState(true);
    setStatus("Goruntulu baglanti kuruldu");
    isMatching = false;
    syncActionButtons();
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;

    if (state === "failed" || state === "closed" || state === "disconnected") {
      isMatching = false;
      resetRemoteVideo();
      syncActionButtons();
    }
  };

  peerConnection = connection;
  return connection;
}

async function requestPartner() {
  await ensureLocalMedia();
  cleanupPeerConnection();
  politePeer = false;
  isMatching = true;
  setStatus("Partner araniyor...");
  logEvent("Yeni bir goruntulu partner araniyor.");
  syncActionButtons();
  socket.emit("find-partner");
}

async function flushPendingIceCandidates() {
  if (!peerConnection || !hasRemoteDescription || pendingIceCandidates.length === 0) {
    return;
  }

  const queuedCandidates = [...pendingIceCandidates];
  pendingIceCandidates = [];

  for (const candidate of queuedCandidates) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (error) {
      logEvent(`Bekleyen ICE adayi eklenemedi: ${error.message}`);
    }
  }
}

startButton.addEventListener("click", async () => {
  try {
    await ensureLocalMedia();
    logEvent("Kamera ve mikrofon hazir. Simdi sohbeti baslatabilirsin.");
  } catch (error) {
    mediaReady = false;
    syncActionButtons();
    setStatus("Kamera izni gerekiyor");
    logEvent(`Kamera veya mikrofon acilamadi: ${error.message}`);
  }
});

findButton.addEventListener("click", async () => {
  if (!mediaReady) {
    return;
  }

  try {
    await requestPartner();
  } catch (error) {
    isMatching = false;
    syncActionButtons();
    logEvent(`Eslesme baslatilamadi: ${error.message}`);
  }
});

nextButton.addEventListener("click", async () => {
  if (!localStream || (!isMatching && !isConnected)) {
    return;
  }

  cleanupPeerConnection();
  isMatching = true;
  setStatus("Yeni partner araniyor...");
  logEvent("Eslesme sonlandirildi. Yeni biri araniyor.");
  syncActionButtons();
  socket.emit("next-partner");
});

toggleMicButton.addEventListener("click", () => {
  if (!localStream) {
    return;
  }

  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) {
    return;
  }

  audioTrack.enabled = !audioTrack.enabled;
  syncMediaToggleLabels();
  logEvent(audioTrack.enabled ? "Mikrofon acildi." : "Mikrofon kapatildi.");
});

toggleCameraButton.addEventListener("click", () => {
  if (!localStream) {
    return;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    return;
  }

  videoTrack.enabled = !videoTrack.enabled;
  syncMediaToggleLabels();
  logEvent(videoTrack.enabled ? "Kamera acildi." : "Kamera kapatildi.");
});

mobileDrawerToggle.addEventListener("click", () => {
  if (!document.body.classList.contains("is-mobile")) {
    return;
  }

  mobileControlsCollapsed = !mobileControlsCollapsed;
  syncMobileDrawerState();
});

reportButton.addEventListener("click", () => {
  if (!isConnected || reportInFlight) {
    return;
  }

  const imageData = captureRemoteFrame();
  if (!imageData) {
    logEvent("Rapor icin goruntu alinamadi.");
    return;
  }

  reportInFlight = true;
  syncActionButtons();
  setStatus("Rapor inceleniyor...");
  logEvent("Rapor AI moderasyonuna gonderildi.");
  socket.emit("report-user", { imageData });
});

socket.on("status", (text) => {
  setStatus(text);
  logEvent(text);
});

socket.on("connect_error", (error) => {
  setStatus("Baglanti engellendi");
  logEvent(error.message || "Sunucu baglantisi kurulamadı.");
});

socket.on("waiting", () => {
  isMatching = true;
  setStatus("Bekleme sirasindasin");
  logEvent("Eslesme kuyrugundasin.");
  syncActionButtons();
});

socket.on("partner-found", async ({ initiator }) => {
  try {
    await ensureLocalMedia();
    politePeer = !initiator;
    const connection = createPeerConnection();
    setStatus("Partner bulundu, baglanti kuruluyor...");
    logEvent("Partner bulundu. WebRTC baglantisi kuruluyor.");

    if (initiator) {
      makingOffer = true;
      await connection.setLocalDescription();
      socket.emit("webrtc-offer", connection.localDescription);
      makingOffer = false;
    }
  } catch (error) {
    makingOffer = false;
    logEvent(`Partner baglantisi baslatilamadi: ${error.message}`);
  }
});

socket.on("partner-left", () => {
  cleanupPeerConnection();
  isMatching = false;
  setStatus("Partner ayrildi");
  logEvent("Partner ayrildi. Tekrar baslatip yeni eslesme arayabilirsin.");
  syncActionButtons();
});

socket.on("report-result", ({ ok, actionTaken, message }) => {
  reportInFlight = false;
  syncActionButtons();
  setStatus(ok ? "Rapor tamamlandi" : "Rapor hatasi");
  logEvent(message || (actionTaken ? "Kullanici engellendi." : "Rapor tamamlandi."));
});

socket.on("moderation-ban", ({ message }) => {
  cleanupPeerConnection();
  setStatus("Erisim engellendi");
  logEvent(message || "Uygunsuz icerik nedeniyle erisim engellendi.");
});

socket.on("webrtc-offer", async (offer) => {
  try {
    await ensureLocalMedia();

    if (!peerConnection) {
      createPeerConnection();
    }

    const offerCollision =
      makingOffer || peerConnection.signalingState !== "stable";

    ignoreOffer = !politePeer && offerCollision;
    if (ignoreOffer) {
      return;
    }

    await peerConnection.setRemoteDescription(offer);
    hasRemoteDescription = true;
    await flushPendingIceCandidates();
    await peerConnection.setLocalDescription();
    socket.emit("webrtc-answer", peerConnection.localDescription);
  } catch (error) {
    logEvent(`Teklif islenemedi: ${error.message}`);
  }
});

socket.on("webrtc-answer", async (answer) => {
  if (!peerConnection) {
    return;
  }

  try {
    await peerConnection.setRemoteDescription(answer);
    hasRemoteDescription = true;
    await flushPendingIceCandidates();
  } catch (error) {
    logEvent(`Yanıt islenemedi: ${error.message}`);
  }
});

socket.on("webrtc-ice-candidate", async (candidate) => {
  if (!peerConnection) {
    return;
  }

  if (!hasRemoteDescription) {
    pendingIceCandidates.push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    if (!ignoreOffer) {
      logEvent(`ICE adayi eklenemedi: ${error.message}`);
    }
  }
});

applyDeviceMode();
syncMobileDrawerState();
syncActionButtons();
window.addEventListener("resize", applyDeviceMode);
window.addEventListener("pointerdown", resumeRemotePlayback);
