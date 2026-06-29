const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};
const SENTENCES = [
  "the silence grows heavy", "the clock ticks slowly", "your heart beats loud",
  "one mistake ends it", "the reaper is waiting", "you cannot outrun fate",
  "the chamber is loaded", "each word is a step", "the darkness is near",
  "you are not alone", "the walls are closing", "your time is running",
  "the door is locked", "the floor is cold", "the mirror is cracked",
  "the shadow moves", "you hear a whisper", "the last light fades",
  "the end is coming", "you feel the trigger"
];

function getRandomSentence() {
  return SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
}

io.on('connection', (socket) => {
  console.log(`⚡ Player connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: [],
        currentSentence: '',
        roundActive: false,
        roundNumber: 0,
        winner: null,
        chamber: 0,
        maxChamber: 6,
      };
    }
    const room = rooms[roomId];
    const player = {
      id: socket.id,
      name: playerName || `Player ${room.players.length + 1}`,
      alive: true,
      progress: 0,
      mistakes: 0,
      isTurn: false,
    };
    room.players.push(player);
    socket.join(roomId);
    socket.emit('roomJoined', { roomId, playerId: socket.id });
    io.to(roomId).emit('updatePlayers', room.players);
    console.log(`👤 ${player.name} joined room ${roomId}`);
  });

  socket.on('startRound', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.roundActive) return;
    const alive = room.players.filter(p => p.alive);
    if (alive.length < 2) {
      socket.emit('error', 'Need at least 2 alive players to start!');
      return;
    }
    room.players.forEach(p => {
      if (p.alive) { p.progress = 0; p.mistakes = 0; p.isTurn = false; }
    });
    room.currentSentence = getRandomSentence();
    room.roundActive = true;
    room.roundNumber++;
    room.chamber = 0;
    room.winner = null;
    const alivePlayers = room.players.filter(p => p.alive);
    alivePlayers[0].isTurn = true;
    io.to(roomId).emit('roundStarted', {
      sentence: room.currentSentence,
      roundNumber: room.roundNumber,
    });
    io.to(roomId).emit('updatePlayers', room.players);
    console.log(`🔫 Round ${room.roundNumber} started in room ${roomId}`);
  });

  socket.on('typeChar', ({ roomId, char }) => {
    const room = rooms[roomId];
    if (!room || !room.roundActive) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.alive || !player.isTurn) return;
    const sentence = room.currentSentence;
    const progress = player.progress;
    if (progress >= sentence.length) {
      player.isTurn = false;
      const next = room.players.find(p => p.alive && p.progress < sentence.length);
      if (next) next.isTurn = true;
      io.to(roomId).emit('updatePlayers', room.players);
      return;
    }
    const expectedChar = sentence[progress];
    if (char === expectedChar) {
      player.progress++;
      if (player.progress >= sentence.length) {
        player.isTurn = false;
        socket.emit('message', `✅ You completed the sentence!`);
        const alive = room.players.filter(p => p.alive);
        const allDone = alive.every(p => p.progress >= sentence.length);
        if (allDone || alive.length === 1) {
          endRound(roomId);
        } else {
          const next = room.players.find(p => p.alive && p.progress < sentence.length);
          if (next) next.isTurn = true;
        }
      }
    } else {
      player.mistakes++;
      room.chamber = Math.min(room.chamber + 1, room.maxChamber);
      socket.emit('message', `❌ Mistake! Chamber: ${room.chamber}/${room.maxChamber}`);
      if (room.chamber >= room.maxChamber) {
        player.alive = false;
        player.isTurn = false;
        io.to(roomId).emit('message', `💀 ${player.name} has been eliminated!`);
        const alive = room.players.filter(p => p.alive);
        if (alive.length <= 1) {
          endRound(roomId);
        } else {
          const next = room.players.find(p => p.alive && p.progress < sentence.length);
          if (next) next.isTurn = true;
        }
      }
    }
    io.to(roomId).emit('updatePlayers', room.players);
    io.to(roomId).emit('updateChamber', room.chamber);
  });

  function endRound(roomId) {
    const room = rooms[roomId];
    if (!room || !room.roundActive) return;
    room.roundActive = false;
    const alive = room.players.filter(p => p.alive);
    let winner = room.winner;
    if (!winner && alive.length > 0) {
      winner = alive.reduce((a, b) => a.progress > b.progress ? a : b);
    }
    if (winner) {
      room.winner = winner;
      io.to(roomId).emit('roundEnded', { winner: winner.name });
      io.to(roomId).emit('message', `🏆 ${winner.name} wins the round!`);
    } else {
      io.to(roomId).emit('roundEnded', { winner: null });
      io.to(roomId).emit('message', 'No winner this round.');
    }
    io.to(roomId).emit('updatePlayers', room.players);
    const aliveCount = room.players.filter(p => p.alive).length;
    if (aliveCount <= 1) {
      const champ = room.players.find(p => p.alive);
      io.to(roomId).emit('gameOver', { winner: champ ? champ.name : null });
    }
  }

  socket.on('disconnect', () => {
    console.log(`❌ Player disconnected: ${socket.id}`);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.alive = false;
        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('message', `🚪 ${player.name} has left the room.`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 OnyxRoyale Server running on http://localhost:${PORT}`);
});