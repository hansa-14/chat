const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  online: { type: Boolean, default: false },
  lastSeen: { type: Date },
  bio: { type: String, default: '' },
  profilePicUrl: { type: String, default: '' },
  socketId: { type: String, default: null }
});

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: { type: String },
  fileUrl: { type: String },
  timestamp: { type: Date, default: Date.now },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const ChatSchema = new mongoose.Schema({
  isGroup: { type: Boolean, default: false },
  name: { type: String, default: '' },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages: [MessageSchema]
});

const User = mongoose.model('User', UserSchema);
const Chat = mongoose.model('Chat', ChatSchema);

module.exports = { User, Chat };
