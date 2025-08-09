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

// MongoDB connection (replace <username> and <password> with your credentials)
mongoose.connect('mongodb+srv://hansadewminasenevirathna:g9HUgCTUgrmlYsCZ@cluster0.2bzy5xl.mongodb.net/whatsapp_clone?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Multer for file uploads
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Different folders for profile pics and chat files
    if (req.url.startsWith('/profile/picture')) {
      cb(null, 'uploads/profilePics/');
    } else {
      cb(null, 'uploads/files/');
    }
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage: fileStorage });

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// --- Routes ---

// Register
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Missing fields');
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).send('Username taken');
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, passwordHash: hash });
    await user.save();
    res.status(201).send('User registered');
  } catch (e) {
    res.status(500).send('Server error');
  }
});

// Login
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
    res.send('Logged in');
  } catch {
    res.status(500).send('Server error');
  }
});

// Logout
app.post('/logout', async (req, res) => {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user) {
      user.online = false;
      user.lastSeen = new Date();
      await user.save();
    }
  }
  req.session.destroy(() => {
    res.send('Logged out');
  });
});

// Get current user info
app.get('/current-user', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ userId: req.session.userId, username: req.session.username });
});

// Get all users except current user
app.get('/users', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const users = await User.find({ _id: { $ne: req.session.userId } })
    .select('username online lastSeen profilePicUrl bio')
    .lean();
  res.json(users);
});

// Get chats for current user
app.get('/chats', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const chats = await Chat.find({ users: req.session.userId })
    .populate('users', 'username profilePicUrl online lastSeen')
    .populate('messages.sender', 'username profilePicUrl')
    .lean();
  res.json(chats);
});

// Create group chat
app.post('/group', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  let { name, userIds } = req.body;
  if (!name || !Array.isArray(userIds)) return res.status(400).send('Invalid data');
  if (!userIds.includes(req.session.userId.toString())) userIds.push(req.session.userId.toString());
  const chat = new Chat({ isGroup: true, name, users: userIds, messages: [] });
  await chat.save();
  res.json(chat);
});

// Upload chat file
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  res.json({ fileUrl: `/uploads/files/${req.file.filename}` });
});

// Profile routes
app.get('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  try {
    const user = await User.findById(req.session.userId).select('username bio profilePicUrl');
    if (!user) return res.status(404).send('User not found');
    res.json(user);
  } catch {
    res.status(500).send('Server error');
  }
});

app.post('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).send('Unauthorized');
  const { username, bio, profilePicUrl } = req.body;
  if (!username) return res.status(400).send('Username required');
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');
    user.username = username;
    user.bio = bio || '';
    if (profilePicUrl) user.profilePicUrl = profilePicUrl;
    await user.save();
    res.send('Profile updated');
  } catch {
    res.status(500).send('Server error');
  }
});

// Upload profile picture
app.post('/profile/picture', upload.single('file'), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const user = await User.findById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.profilePicUrl = `/uploads/profilePics/${req.file.filename}`;
  await user.save();

  res.json({ profilePicUrl: user.profilePicUrl });
});

// Helper: get or create private chat
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


// Socket.io events
io.on('connection', async (socket) => {
  const session = socket.request.session;
  if (!session.userId) return socket.disconnect();

  const userId = session.userId.toString();

  const user = await User.findById(userId);
  if (!user) return socket.disconnect();

  user.online = true;
  user.socketId = socket.id;
  await user.save();

  // Join user's chats rooms
  const chats = await Chat.find({ users: userId });
  chats.forEach(chat => socket.join(chat._id.toString()));

  // Notify others
  socket.broadcast.emit('user online', { userId, username: user.username, online: true });

  // Join private chat
  socket.on('join private chat', async (otherUserId) => {
    if (!otherUserId) return;
    const chat = await getPrivateChat(userId, otherUserId);
    socket.join(chat._id.toString());
    socket.emit('chat messages', chat.messages.map(m => ({
      _id: m._id,
      sender: m.sender.toString(),
      text: m.text,
      fileUrl: m.fileUrl,
      timestamp: m.timestamp,
      readBy: m.readBy.map(id => id.toString()),
      chatId: chat._id.toString()
    })));
  });

  // Send message
  socket.on('send message', async ({ chatId, text, fileUrl }) => {
    if (!chatId || (!text && !fileUrl)) return;

    const chat = await Chat.findById(chatId);
    if (!chat) return;

    if (!chat.users.map(id => id.toString()).includes(userId)) return;

    const message = {
      sender: user._id,
      text: text || '',
      fileUrl: fileUrl || '',
      timestamp: new Date(),
      readBy: [user._id]
    };
    chat.messages.push(message);
    await chat.save();

    io.to(chat._id.toString()).emit('new message', {
      _id: message._id,
      sender: userId,
      text: message.text,
      fileUrl: message.fileUrl,
      timestamp: message.timestamp,
      readBy: [userId],
      chatId: chat._id.toString()
    });
  });

  // Read receipts
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

    io.to(chat._id.toString()).emit('messages read update', { chatId, messageIds, userId });
  });

  // Disconnect
  socket.on('disconnect', async () => {
    user.online = false;
    user.lastSeen = new Date();
    user.socketId = null;
    await user.save();
    socket.broadcast.emit('user online', { userId, username: user.username, online: false });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port', PORT));
