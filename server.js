const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const { User, Chat } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Static files & uploads
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/whatsapp_clone', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(console.error);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Routes

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(__dirname + '/public/register.html');
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Missing fields');
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).send('Username taken');
    const hash = await bcrypt.hash(password, 10);
    const newUser = new User({ username, passwordHash: hash, online: false });
    await newUser.save();
    res.redirect('/login');
  } catch (e) {
    res.status(500).send('Server error');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).send('Invalid credentials');
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).send('Invalid credentials');
    req.session.userId = user._id;
    req.session.username = user.username;
    user.online = true;
    await user.save();
    res.redirect('/');
  } catch {
    res.status(500).send('Server error');
  }
});

app.get('/logout', async (req, res) => {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user) {
      user.online = false;
      await user.save();
    }
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/current-user', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ username: req.session.username, userId: req.session.userId });
});

// Get all users except current
app.get('/users', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const users = await User.find({ _id: { $ne: req.session.userId } }).select('username online');
  res.json(users);
});

// Get chats for current user
app.get('/chats', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const chats = await Chat.find({ users: req.session.userId })
    .populate('users', 'username')
    .populate('messages.sender', 'username')
    .exec();
  res.json(chats);
});

// Create group chat
app.post('/group', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const { name, userIds } = req.body; // userIds: array of userId strings
  if (!name || !Array.isArray(userIds)) return res.status(400).send('Invalid data');
  if (!userIds.includes(req.session.userId)) userIds.push(req.session.userId); // add self if not included
  const chat = new Chat({ isGroup: true, name, users: userIds, messages: [] });
  await chat.save();
  res.json(chat);
});

// File upload route
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// Helpers

async function getPrivateChat(userId1, userId2) {
  let chat = await Chat.findOne({
    isGroup: false,
    users: { $all: [userId1, userId2], $size: 2 }
  });
  if (!chat) {
    chat = new Chat({ isGroup: false, users: [userId1, userId2], messages: [] });
    await chat.save();
  }
  return chat;
}

// Socket.IO

io.on('connection', async (socket) => {
  const session = socket.request.session;
  if (!session.userId) return socket.disconnect();

  const userId = session.userId.toString();

  const user = await User.findById(userId);
  if (!user) return socket.disconnect();

  user.online = true;
  user.socketId = socket.id;
  await user.save();

  // Join all user's chat rooms
  const chats = await Chat.find({ users: userId });
  chats.forEach(chat => socket.join(chat._id.toString()));

  // Notify others user online status
  socket.broadcast.emit('user online', { userId, username: user.username, online: true });

  // Handle join private chat with another user
  socket.on('join private chat', async (otherUserId) => {
    if (!otherUserId) return;
    const chat = await getPrivateChat(userId, otherUserId);
    socket.join(chat._id.toString());
    // Send chat messages to client
    socket.emit('chat messages', chat.messages.map(m => ({
      _id: m._id,
      sender: m.sender.toString(),
      text: m.text,
      fileUrl: m.fileUrl,
      timestamp: m.timestamp,
      readBy: m.readBy.map(id => id.toString())
    })));
  });

  // Handle sending message
  socket.on('send message', async ({ chatId, text, fileUrl }) => {
    if (!chatId || (!text && !fileUrl)) return;

    const chat = await Chat.findById(chatId);
    if (!chat) return;

    if (!chat.users.map(id => id.toString()).includes(userId)) return; // Not in chat

    const message = {
      sender: user._id,
      text: text || '',
      fileUrl: fileUrl || '',
      timestamp: new Date(),
      readBy: [user._id]
    };
    chat.messages.push(message);
    await chat.save();

    // Broadcast message to all in room
    io.to(chat._id.toString()).emit('new message', {
      _id: message._id,
      sender: userId,
      text: message.text,
      fileUrl: message.fileUrl,
      timestamp: message.timestamp,
      readBy: [userId]
    });
  });

  // Handle read receipt update
  socket.on('read messages', async ({ chatId, messageIds }) => {
    if (!chatId || !Array.isArray(messageIds)) return;
    const chat = await Chat.findById(chatId);
    if (!chat) return;
    if (!chat.users.map(id => id.toString()).includes(userId)) return;

    chat.messages.forEach(msg => {
      if (messageIds.includes(msg._id.toString()) && !msg.readBy.includes(user._id)) {
        msg.readBy.push(user._id);
      }
    });

    await chat.save();

    // Notify all users in chat about read receipts update
    io.to(chat._id.toString()).emit('messages read update', {
      chatId,
      messageIds,
      userId
    });
  });

  socket.on('disconnect', async () => {
    user.online = false;
    user.socketId = null;
    await user.save();
    socket.broadcast.emit('user online', { userId, username: user.username, online: false });
  });
});

// Start server

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
