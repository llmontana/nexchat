const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
let waitingSocketId = null;

const peers = new Map();
const rtcSignalEvents = new Set(["webrtc-offer", "webrtc-answer", "webrtc-ice-candidate"]);

function pairSockets(firstId, secondId) {
  peers.set(firstId, secondId);
  peers.set(secondId, firstId);

  io.to(firstId).emit("partner-found", { initiator: true });
  io.to(secondId).emit("partner-found", { initiator: false });
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
  return partnerId;
}

function enqueueSocket(socket) {
  if (waitingSocketId === socket.id) {
    return;
  }

  if (waitingSocketId && waitingSocketId !== socket.id) {
    const otherSocket = io.sockets.sockets.get(waitingSocketId);

    if (otherSocket) {
      const firstId = waitingSocketId;
      waitingSocketId = null;
      pairSockets(firstId, socket.id);
      return;
    }

    waitingSocketId = null;
  }

  waitingSocketId = socket.id;
  socket.emit("waiting");
}

function removeFromQueue(socketId) {
  if (waitingSocketId === socketId) {
    waitingSocketId = null;
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

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.emit("status", "Sunucuya baglandin.");

  socket.on("find-partner", () => {
    if (getPartnerId(socket.id)) {
      socket.emit("status", "Zaten bir eslesmen var.");
      return;
    }

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

  socket.on("disconnect", () => {
    leaveConversation(socket, false);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
