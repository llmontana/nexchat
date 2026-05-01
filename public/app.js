const socket = io();

const startButton = document.getElementById("startButton");
const findButton = document.getElementById("findButton");
const nextButton = document.getElementById("nextButton");
const reportButton = document.getElementById("reportButton");
const addFriendButton = document.getElementById("addFriendButton");
const toggleMicButton = document.getElementById("toggleMicButton");
const toggleCameraButton = document.getElementById("toggleCameraButton");
const flipCameraButton = document.getElementById("flipCameraButton");
const localVideoLabel = document.getElementById("localVideoLabel");
const localVideo = document.getElementById("localVideo");
const remoteVideoLabel = document.getElementById("remoteVideoLabel");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusBadge = document.getElementById("statusBadge");
const eventLog = document.getElementById("eventLog");
const mobileDrawerToggle = document.getElementById("mobileDrawerToggle");
const logoutButton = document.getElementById("logoutButton");
const mobileHomeTab = document.getElementById("mobileHomeTab");
const mobileFriendsTab = document.getElementById("mobileFriendsTab");
const mobilePremiumTab = document.getElementById("mobilePremiumTab");
const premiumGirlButton = document.getElementById("premiumGirlButton");
const premiumBoyButton = document.getElementById("premiumBoyButton");
const clearPremiumFilterButton = document.getElementById("clearPremiumFilterButton");

let rtcConfig = {
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
let isAuthenticated = false;
let currentUserProfile = null;
let currentPartnerProfile = null;
let mobileActiveTab = "home";
let activeMatchFilter = "any";
let availableVideoInputs = [];
let currentVideoInputId = "";
const DEFAULT_GIRL_FILTER_LABEL = "9 ◈";
const DEFAULT_BOY_FILTER_LABEL = "5 ◈";
let premiumChargeSettledForCurrentMatch = false;

async function loadRtcConfig() {
  try {
    const response = await fetch("/api/rtc-config", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`RTC config alinamadi (${response.status})`);
    }

    const data = await response.json();
    if (data?.rtcConfig?.iceServers?.length) {
      rtcConfig = data.rtcConfig;
      logEvent(
        data.turnEnabled
          ? `TURN destekli baglanti ayarlari yuklendi (${data.provider || "bilinmeyen"}).`
          : `STUN baglanti ayarlari yuklendi (${data.provider || "stun-only"}). TURN henuz aktif degil.`
      );
    }
  } catch (error) {
    logEvent(`RTC ayarlari alinamadi, varsayilan STUN kullaniliyor: ${error.message}`);
  }
}

function setLocalLabel(username) {
  localVideoLabel.textContent = username ? `${username} (Sen)` : "Sen";
}

function setRemoteLabel(username) {
  remoteVideoLabel.textContent = username || "Yabancı";
}

function syncMobileTabs() {
  const isMobile = document.body.classList.contains("is-mobile");
  document.body.classList.toggle(
    "mobile-show-friends",
    isMobile && mobileActiveTab === "friends"
  );
  document.body.classList.toggle(
    "mobile-show-premium",
    isMobile && mobileActiveTab === "premium"
  );
  mobileHomeTab.classList.toggle("active", mobileActiveTab === "home");
  mobileFriendsTab.classList.toggle("active", mobileActiveTab === "friends");
  mobilePremiumTab.classList.toggle("active", mobileActiveTab === "premium");
  window.dispatchEvent(
    new CustomEvent("mobile-tab-change", {
      detail: {
        activeTab: mobileActiveTab,
        mobile: isMobile
      }
    })
  );
}

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
  if (!isMobile) {
    mobileControlsCollapsed = false;
    mobileDrawerToggle.setAttribute("aria-expanded", "true");
    mobileDrawerToggle.setAttribute("aria-label", "Kontrolleri gizle");
    mobileActiveTab = "home";
  }

  syncMobileTabs();
}

function setStatus(text) {
  statusBadge.textContent = text;
}

function syncMediaToggleLabels() {
  if (!localStream) {
    toggleMicButton.textContent = "Sesi Kapat";
    toggleCameraButton.textContent = "Kamerayı Kapat";
    return;
  }

  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  toggleMicButton.textContent =
    audioTrack && !audioTrack.enabled ? "Sesi Aç" : "Sesi Kapat";
  toggleCameraButton.textContent =
    videoTrack && !videoTrack.enabled ? "Kamerayı Aç" : "Kamerayı Kapat";
}

function syncFindButtonState() {
  findButton.textContent = isMatching || isConnected ? "Sohbeti Durdur" : "Sohbete Başla";
}

function syncPremiumFilterState() {
  const girlSelected = activeMatchFilter === "kiz";
  const boySelected = activeMatchFilter === "erkek";
  const hasSelectedFilter = girlSelected || boySelected;

  premiumGirlButton.textContent = girlSelected ? "Seçili" : DEFAULT_GIRL_FILTER_LABEL;
  premiumBoyButton.textContent = boySelected ? "Seçili" : DEFAULT_BOY_FILTER_LABEL;
  premiumGirlButton.classList.toggle("selected", girlSelected);
  premiumBoyButton.classList.toggle("selected", boySelected);
  clearPremiumFilterButton.classList.toggle("hidden", !hasSelectedFilter);
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
    collapsed ? "Kontrolleri göster" : "Kontrolleri gizle"
  );
}

function syncActionButtons() {
  startButton.disabled = !isAuthenticated || mediaReady;
  findButton.disabled = !isAuthenticated || !mediaReady;
  nextButton.disabled = !isAuthenticated || !mediaReady || (!isMatching && !isConnected);
  reportButton.disabled = !isAuthenticated || !isConnected || reportInFlight;
  logoutButton.disabled = !isAuthenticated;
  addFriendButton.disabled = !isAuthenticated || !currentPartnerProfile?.uid;
  flipCameraButton.disabled = !mediaReady || availableVideoInputs.length < 2;
  premiumGirlButton.disabled =
    !isAuthenticated ||
    isMatching ||
    isConnected ||
    Number(currentUserProfile?.diamonds || 0) < 9;
  premiumBoyButton.disabled =
    !isAuthenticated ||
    isMatching ||
    isConnected ||
    Number(currentUserProfile?.diamonds || 0) < 5;
  syncFindButtonState();
  syncPremiumFilterState();
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
  flipCameraButton.disabled = !enabled || availableVideoInputs.length < 2;
  syncMediaToggleLabels();
}

async function refreshVideoInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableVideoInputs = devices.filter((device) => device.kind === "videoinput");
  } catch (error) {
    availableVideoInputs = [];
  }

  const videoTrack = localStream?.getVideoTracks?.()[0];
  currentVideoInputId = videoTrack?.getSettings?.().deviceId || currentVideoInputId || "";
  syncActionButtons();
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
  currentVideoInputId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || "";
  await refreshVideoInputs();
  setDeviceControlsEnabled(true);
  syncMediaToggleLabels();
  setStatus("Kamera hazır");
  syncActionButtons();
  return stream;
}

function resetRemoteVideo() {
  remoteVideo.srcObject = null;
  remoteVideo.load();
  isMatching = false;
  isConnected = false;
  premiumChargeSettledForCurrentMatch = false;
  currentPartnerProfile = null;
  setRemoteLabel("");
  setConnectedState(false);
  syncFindButtonState();
  syncPremiumFilterState();
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

function resetLocalMedia() {
  if (!localStream) {
    return;
  }

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  mediaReady = false;
  availableVideoInputs = [];
  currentVideoInputId = "";
  setDeviceControlsEnabled(false);
  syncMediaToggleLabels();
  syncActionButtons();
}

function leaveActiveSession() {
  if (!isMatching && !isConnected) {
    return;
  }

  socket.emit("next-partner");
  cleanupPeerConnection();
  isMatching = false;
  isConnected = false;
}

function stopConversationFlow() {
  socket.emit("stop-matching");
  cleanupPeerConnection();
  isMatching = false;
  isConnected = false;
  premiumChargeSettledForCurrentMatch = false;
  mobileActiveTab = "home";
  syncMobileTabs();
  setStatus("Sohbet durduruldu");
  logEvent("Eşleşme ve aktif görüşme durduruldu.");
  syncActionButtons();
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
      logEvent("Karşı tarafın sesi için ekrana dokunman gerekebilir.");
    });
    setConnectedState(true);
    setStatus("Görüntülü bağlantı kuruldu");
    isMatching = false;
    syncActionButtons();
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;
    logEvent(`Baglanti durumu: ${state}`);

    if (state === "failed" || state === "closed" || state === "disconnected") {
      isMatching = false;
      resetRemoteVideo();
      syncActionButtons();
    }
  };

  peerConnection = connection;
  return connection;
}

async function requestPartner(filter = "any") {
  await ensureLocalMedia();
  await loadRtcConfig();
  cleanupPeerConnection();
  politePeer = false;
  isMatching = true;
  activeMatchFilter = filter;
  setStatus(filter === "any" ? "Partner aranıyor..." : "Premium eşleşme aranıyor...");
  logEvent(
    filter === "any"
      ? "Yeni bir görüntülü partner aranıyor."
      : `${filter === "kiz" ? "Sadece kız" : "Sadece erkek"} filtresiyle eşleşme aranıyor.`
  );
  syncActionButtons();
  socket.emit("find-partner", {
    genderFilter: filter
  });
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
      logEvent(`Bekleyen ICE adayı eklenemedi: ${error.message}`);
    }
  }
}

startButton.addEventListener("click", async () => {
  if (!isAuthenticated) {
    setStatus("Giriş yapman gerekiyor");
    return;
  }

  try {
    await ensureLocalMedia();
    logEvent("Kamera ve mikrofon hazır. Şimdi sohbeti başlatabilirsin.");
  } catch (error) {
    mediaReady = false;
    syncActionButtons();
    setStatus("Kamera izni gerekiyor");
    logEvent(`Kamera veya mikrofon açılamadı: ${error.message}`);
  }
});

findButton.addEventListener("click", async () => {
  if (!isAuthenticated || !mediaReady) {
    return;
  }

  if (isMatching || isConnected) {
    stopConversationFlow();
    return;
  }

  try {
    await requestPartner(activeMatchFilter);
  } catch (error) {
    isMatching = false;
    syncActionButtons();
    logEvent(`Eşleşme başlatılamadı: ${error.message}`);
  }
});

async function startPremiumMatch(targetGender) {
  if (!isAuthenticated) {
    setStatus("Önce giriş yapman gerekiyor");
    return;
  }

  try {
    await ensureLocalMedia();
    activeMatchFilter = targetGender;
    premiumChargeSettledForCurrentMatch = false;
    socket.emit("set-match-filter", {
      genderFilter: targetGender
    });
    await requestPartner(targetGender);
    logEvent(
      `${targetGender === "kiz" ? "Kız" : "Erkek"} filtresi seçildi. Sadece bu cinsiyetle kayıt olan kullanıcılar aranacak.`
    );
  } catch (error) {
    setStatus("Premium filtre kullanılamadı");
    logEvent(error.message || "Premium filtre başlatılamadı.");
    syncActionButtons();
  }
}

nextButton.addEventListener("click", async () => {
  if (!isAuthenticated || !localStream || (!isMatching && !isConnected)) {
    return;
  }

  cleanupPeerConnection();
  isMatching = true;
  premiumChargeSettledForCurrentMatch = false;
  setStatus("Yeni partner aranıyor...");
  logEvent("Eşleşme sonlandırıldı. Yeni biri aranıyor.");
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
  logEvent(audioTrack.enabled ? "Mikrofon açıldı." : "Mikrofon kapatıldı.");
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
  logEvent(videoTrack.enabled ? "Kamera açıldı." : "Kamera kapatıldı.");
});

flipCameraButton.addEventListener("click", async () => {
  if (!localStream || availableVideoInputs.length < 2) {
    return;
  }

  const currentIndex = availableVideoInputs.findIndex(
    (device) => device.deviceId === currentVideoInputId
  );
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % availableVideoInputs.length : 0;
  const nextDevice = availableVideoInputs[nextIndex];
  if (!nextDevice) {
    return;
  }

  flipCameraButton.disabled = true;

  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: nextDevice.deviceId }
      }
    });

    const nextVideoTrack = nextStream.getVideoTracks()[0];
    const oldVideoTrack = localStream.getVideoTracks()[0];

    if (peerConnection) {
      const videoSender = peerConnection
        .getSenders()
        .find((sender) => sender.track && sender.track.kind === "video");
      if (videoSender) {
        await videoSender.replaceTrack(nextVideoTrack);
      }
    }

    if (oldVideoTrack) {
      localStream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }

    localStream.addTrack(nextVideoTrack);
    currentVideoInputId = nextDevice.deviceId;
    localVideo.srcObject = localStream;
    localVideo.play().catch(() => {});
    await refreshVideoInputs();
    syncMediaToggleLabels();
    logEvent("Kamera yönü değiştirildi.");
  } catch (error) {
    logEvent(`Kamera değiştirilemedi: ${error.message}`);
  } finally {
    syncActionButtons();
  }
});

mobileDrawerToggle.addEventListener("click", () => {
  if (!document.body.classList.contains("is-mobile")) {
    return;
  }

  mobileControlsCollapsed = !mobileControlsCollapsed;
  syncMobileDrawerState();
});

mobileHomeTab.addEventListener("click", () => {
  mobileActiveTab = "home";
  syncMobileTabs();
});

mobileFriendsTab.addEventListener("click", () => {
  mobileActiveTab = "friends";
  syncMobileTabs();
});

mobilePremiumTab.addEventListener("click", () => {
  mobileActiveTab = "premium";
  syncMobileTabs();
});

premiumGirlButton.addEventListener("click", async () => {
  await startPremiumMatch("kiz");
});

premiumBoyButton.addEventListener("click", async () => {
  await startPremiumMatch("erkek");
});

clearPremiumFilterButton.addEventListener("click", () => {
  if (activeMatchFilter === "any") {
    return;
  }

  activeMatchFilter = "any";
  premiumChargeSettledForCurrentMatch = false;
  socket.emit("set-match-filter", {
    genderFilter: "any"
  });
  syncActionButtons();
  setStatus("Filtre sıfırlandı");
  logEvent("Aktif premium filtre sıfırlandı.");
});

reportButton.addEventListener("click", () => {
  if (!isConnected || reportInFlight) {
    return;
  }

  const imageData = captureRemoteFrame();
  if (!imageData) {
    logEvent("Rapor için görüntü alınamadı.");
    return;
  }

  reportInFlight = true;
  syncActionButtons();
  setStatus("Rapor gönderiliyor...");
  logEvent("Rapor admin incelemesi için gönderildi.");
  socket.emit("report-user", { imageData });
});

addFriendButton.addEventListener("click", async () => {
  if (!currentPartnerProfile?.uid || !window.nexchatSocial?.sendFriendRequest) {
    return;
  }

  addFriendButton.disabled = true;

  try {
    const result = await window.nexchatSocial.sendFriendRequest(currentPartnerProfile);
    setStatus(result.ok ? "Arkadaş işlemi tamamlandı" : "Arkadaş işlemi başarısız");
    logEvent(result.message);
  } catch (error) {
    setStatus("Arkadaş işlemi başarısız");
    logEvent(error.message || "Arkadaş ekleme sırasında hata oluştu.");
  } finally {
    syncActionButtons();
  }
});

socket.on("status", (text) => {
  setStatus(text);
  logEvent(text);
});

socket.on("connect_error", (error) => {
  setStatus("Bağlantı engellendi");
  logEvent(error.message || "Sunucu bağlantısı kurulamadı.");
});

socket.on("waiting", () => {
  isMatching = true;
  setStatus(
    activeMatchFilter === "any"
      ? "Bekleme sırasındasın"
      : `${activeMatchFilter === "kiz" ? "Kız" : "Erkek"} filtresinde bekliyorsun`
  );
  logEvent(
    activeMatchFilter === "any"
      ? "Eşleşme kuyruğundasın."
      : `${activeMatchFilter === "kiz" ? "Kız" : "Erkek"} filtresiyle eşleşme kuyruğundasın.`
  );
  syncActionButtons();
});

socket.on("partner-found", async ({ initiator, partnerProfile }) => {
  try {
    await ensureLocalMedia();
    if (activeMatchFilter !== "any" && !premiumChargeSettledForCurrentMatch) {
      const result = await window.nexchatPremium.consumeGenderFilter(activeMatchFilter);
      premiumChargeSettledForCurrentMatch = true;
      logEvent(
        `${activeMatchFilter === "kiz" ? "Sadece kız" : "Sadece erkek"} filtresi için ${result.cost} elmas kullanıldı.`
      );
    }
    politePeer = !initiator;
    const connection = createPeerConnection();
    currentPartnerProfile = partnerProfile || null;
    setRemoteLabel(partnerProfile?.username || "");
    setStatus("Partner bulundu, bağlantı kuruluyor...");
    logEvent("Partner bulundu. WebRTC bağlantısı kuruluyor.");
    if (activeMatchFilter !== "any") {
      logEvent(
        `${activeMatchFilter === "kiz" ? "Kız" : "Erkek"} filtresine uygun bir kullanıcı bulundu.`
      );
    }
    syncActionButtons();

    if (initiator) {
      makingOffer = true;
      await connection.setLocalDescription();
      socket.emit("webrtc-offer", connection.localDescription);
      makingOffer = false;
    }
  } catch (error) {
    makingOffer = false;
    if (activeMatchFilter !== "any" && !premiumChargeSettledForCurrentMatch) {
      stopConversationFlow();
      setStatus("Premium filtre için elmas yetersiz");
    }
    logEvent(`Partner bağlantısı başlatılamadı: ${error.message}`);
  }
});

socket.on("partner-left", () => {
  cleanupPeerConnection();
  isMatching = false;
  setStatus("Partner ayrıldı");
  logEvent("Partner ayrıldı. Tekrar başlatıp yeni eşleşme arayabilirsin.");
  syncActionButtons();
});

socket.on("report-result", ({ ok, actionTaken, message }) => {
  reportInFlight = false;
  syncActionButtons();
  setStatus(ok ? "Rapor tamamlandı" : "Rapor hatası");
  logEvent(message || (actionTaken ? "Kullanıcı engellendi." : "Rapor tamamlandı."));
});

socket.on("partner-profile", (profile) => {
  currentPartnerProfile = profile || null;
  setRemoteLabel(profile?.username || "");
  syncActionButtons();
});

window.addEventListener("auth-state", ({ detail }) => {
  isAuthenticated = Boolean(detail?.authenticated);

  if (!isAuthenticated) {
    socket.emit("sign-out");
    leaveActiveSession();
    resetLocalMedia();
    activeMatchFilter = "any";
    premiumChargeSettledForCurrentMatch = false;
    currentUserProfile = null;
    currentPartnerProfile = null;
    setLocalLabel("");
    setRemoteLabel("");
    setStatus("Giriş yapman gerekiyor");
    logEvent("Sohbete devam etmek için giriş yap.");
  } else {
    currentUserProfile = detail.user;
    socket.emit("authenticate-user", {
      idToken: detail.idToken || ""
    });
    setLocalLabel(detail.user.username || "");
    setStatus("Giriş yapıldı");
    logEvent(`${detail.user.username || detail.user.email} ile oturum acildi.`);
  }

  syncActionButtons();
});

window.addEventListener("user-profile-updated", ({ detail }) => {
  if (!detail?.user) {
    return;
  }

  currentUserProfile = detail.user;
  setLocalLabel(detail.user.username || "");
  syncActionButtons();
});

socket.on("authentication-result", ({ ok, message }) => {
  if (ok && currentUserProfile) {
    socket.emit("user-profile", {
      uid: currentUserProfile.uid || "",
      username: currentUserProfile.username || "",
      gender: currentUserProfile.gender || ""
    });
    return;
  }

  setStatus("Giriş doğrulanamadı");
  logEvent(message || "Sunucu oturumu doğrulanamadı.");
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
      logEvent(`Teklif işlenemedi: ${error.message}`);
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
    logEvent(`Yanıt işlenemedi: ${error.message}`);
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
      logEvent(`ICE adayı eklenemedi: ${error.message}`);
    }
  }
});

applyDeviceMode();
syncMobileDrawerState();
syncActionButtons();
syncMobileTabs();
loadRtcConfig();
setLocalLabel("");
setRemoteLabel("");
window.addEventListener("resize", applyDeviceMode);
window.addEventListener("pointerdown", resumeRemotePlayback);
