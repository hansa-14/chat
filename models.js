const mongoose = require('mongoose');
const { Schema } = mongoose;

// User schema
const userSchema = new Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  online: Boolean,
});

// Message schema
const messageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: 'User' },
  text: String,
  fileUrl: String, // file message optional
  timestamp: { type: Date, default: Date.now },
  readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

// Chat schema (private or group)
const chatSchema = new Schema({
  isGroup: { type: Boolean, default: false },
  name: String,
  users: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  messages: [messageSchema],
});

const User = mongoose.model('User', userSchema);
const Chat = mongoose.model('Chat', chatSchema);

module.exports = { User, Chat };
