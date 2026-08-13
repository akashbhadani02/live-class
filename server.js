const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function roomInfo(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    className: room.className,
    teacherId: room.teacherId,
    teacherName: room.teacherName,
    participants: [...room.participants.values()].map(p => ({
      socketId: p.socketId, userName: p.userName, role: p.role, joinedAt: p.joinedAt, handRaised: !!p.handRaised, speakingAllowed: !!p.speakingAllowed, mutedByTeacher: !!p.mutedByTeacher
    }))
  };
}

io.on('connection', socket => {
  socket.on('create-class', ({ className, teacherName }) => {
    className = String(className || 'Live Class').trim().slice(0, 80);
    teacherName = String(teacherName || 'Teacher').trim().slice(0, 40);
    let roomId;
    do { roomId = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms.has(roomId));
    rooms.set(roomId, {
      className,
      teacherId: socket.id,
      teacherName,
      participants: new Map()
    });
    socket.emit('class-created', { roomId, className });
  });

  socket.on('join-class', ({ roomId, userName, role }) => {
    roomId = String(roomId || '').trim();
    userName = String(userName || '').trim().slice(0, 40);
    role = role === 'teacher' ? 'teacher' : 'student';
    const room = rooms.get(roomId);
    if (!room || !userName) return socket.emit('join-error', 'Class not found or name is missing.');
    if (role === 'teacher' && room.teacherId !== socket.id) return socket.emit('join-error', 'Only the class teacher can use teacher mode.');

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    socket.role = role;

    const existingUsers = [...room.participants.values()].filter(p => p.socketId !== socket.id);
    room.participants.set(socket.id, { socketId: socket.id, userName, role, joinedAt: Date.now(), handRaised: false, speakingAllowed: true, mutedByTeacher: false });

    socket.emit('class-state', { ...roomInfo(roomId), existingUsers });
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userName, role });
    io.to(roomId).emit('participants', roomInfo(roomId).participants);
  });

  socket.on('offer', ({ target, offer }) => {
    if (target) io.to(target).emit('offer', { sender: socket.id, offer, userName: socket.userName, role: socket.role });
  });
  socket.on('answer', ({ target, answer }) => {
    if (target) io.to(target).emit('answer', { sender: socket.id, answer });
  });
  socket.on('ice-candidate', ({ target, candidate }) => {
    if (target && candidate) io.to(target).emit('ice-candidate', { sender: socket.id, candidate });
  });

  socket.on('chat-message', ({ message }) => {
    if (!socket.roomId || !message) return;
    io.to(socket.roomId).emit('chat-message', { userName: socket.userName, role: socket.role, message: String(message).slice(0, 1000), time: Date.now() });
  });

  socket.on('raise-hand', ({ raised }) => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    const participant = room?.participants.get(socket.id);
    if (!participant || participant.role === 'teacher') return;
    participant.handRaised = !!raised;
    io.to(socket.roomId).emit('participants', roomInfo(socket.roomId).participants);
    io.to(socket.roomId).emit('hand-update', { socketId: socket.id, userName: socket.userName, raised: participant.handRaised });
  });

  socket.on('teacher-command', ({ command, target }) => {
    if (!socket.roomId || socket.role !== 'teacher') return;
    const room = rooms.get(socket.roomId);
    if (!room || room.teacherId !== socket.id) return;
    if (command === 'end-class') {
      io.to(socket.roomId).emit('class-ended');
      for (const p of room.participants.values()) io.sockets.sockets.get(p.socketId)?.leave(socket.roomId);
      rooms.delete(socket.roomId);
      return;
    }
    if (['mute-student','unmute-student'].includes(command) && target && room.participants.has(target)) {
      const p = room.participants.get(target);
      if (p.role === 'student') {
        p.mutedByTeacher = command === 'mute-student';
        io.to(target).emit('teacher-mic-state', { muted: p.mutedByTeacher });
        io.to(socket.roomId).emit('participants', roomInfo(socket.roomId).participants);
      }
      return;
    }
    if (['allow-speak','deny-speak','lower-hand'].includes(command) && target && room.participants.has(target)) {
      const p = room.participants.get(target);
      if (p.role === 'student') {
        if (command === 'allow-speak') { p.speakingAllowed = true; p.handRaised = false; }
        if (command === 'deny-speak') { p.speakingAllowed = false; p.handRaised = false; }
        if (command === 'lower-hand') { p.handRaised = false; }
        io.to(target).emit('speaking-permission', { allowed: !!p.speakingAllowed });
        io.to(socket.roomId).emit('participants', roomInfo(socket.roomId).participants);
      }
      return;
    }
    if (command === 'remove-student' && target && room.participants.has(target) && target !== socket.id) {
      io.to(target).emit('removed-by-teacher');
      io.sockets.sockets.get(target)?.leave(socket.roomId);
      room.participants.delete(target);
      io.to(socket.roomId).emit('participants', roomInfo(socket.roomId).participants);
    }
  });

  socket.on('leave-class', () => removeUser(socket));
  socket.on('disconnect', () => removeUser(socket));
});

function removeUser(socket) {
  const roomId = socket.roomId;
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  const wasTeacher = room.teacherId === socket.id;
  room.participants.delete(socket.id);
  socket.to(roomId).emit('user-left', socket.id);
  if (wasTeacher) {
    io.to(roomId).emit('class-ended');
    rooms.delete(roomId);
  } else {
    io.to(roomId).emit('participants', roomInfo(roomId).participants);
    if (room.participants.size === 0) rooms.delete(roomId);
  }
  socket.roomId = null;
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Live Class' }));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`Live Class running on port ${PORT}`));
