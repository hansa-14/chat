const socket = io();

let currentChatId = null;
let currentUserId = null;
let currentUsername = null;

const usersListEl = document.getElementById('users');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('form');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const chatHeader = document.getElementById('chat-header');
const profileBtn = document.getElementById('profileBtn');
const logoutBtn = document.getElementById('logoutBtn');

let users = []; // All users from server
let chats = [];

fetch('/current-user')
  .then(res => {
    if (res.status === 401) {
      window.location = '/login.html';
      throw new Error('Unauthorized');
    }
    return res.json();
  })
  .then(data => {
    currentUserId = data.userId;
    currentUsername = data.username;
    loadUsers();
    loadChats();
  })
  .catch(console.error);

function loadUsers() {
  fetch('/users')
    .then(res => res.json())
    .then(data => {
      users = data;
      renderUsers();
    });
}

function loadChats() {
  fetch('/chats')
    .then(res => res.json())
    .then(data => {
      chats = data;
    });
}

function renderUsers() {
  usersListEl.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');

    const img = document.createElement('img');
    img.src = user.profilePicUrl || 'https://via.placeholder.com/30?text=U';
    li.appendChild(img);

    const span = document.createElement('span');
    span.textContent = user.username;
    li.appendChild(span);

    if (user.online) {
      li.classList.add('online');
      li.title = 'Online';
    } else if (user.lastSeen) {
      li.title = 'Last seen: ' + new Date(user.lastSeen).toLocaleString();
    } else {
      li.title = 'Offline';
    }

    li.addEventListener('click', () => startPrivateChat(user));
    usersListEl.appendChild(li);
  });
}

function startPrivateChat(user) {
  if (currentChatId) {
    socket.emit('leave', currentChatId);
  }

  socket.emit('join private chat', user._id);

  chatHeader.innerHTML = `<h2>Chat with ${user.username}</h2>`;
  inputEl.disabled = false;
  fileBtn.disabled = false;
  formEl.querySelector('button[type=submit]').disabled = false;
  messagesEl.innerHTML = '';
  currentChatId = null;

  socket.once('chat messages', (msgs) => {
    messagesEl.innerHTML = '';
    msgs.forEach(msg => addMessage(msg));
    if (msgs.length > 0) currentChatId = msgs[0].chatId || null;
  });
}

function addMessage(msg) {
  const li = document.createElement('li');
  li.classList.add(msg.sender === currentUserId ? 'sent' : 'received');

  if (msg.text) {
    li.textContent = msg.text;
  }
  if (msg.fileUrl) {
    const a = document.createElement('a');
    a.href = msg.fileUrl;
    a.textContent = '[File]';
    a.target = '_blank';
    li.appendChild(a);
  }

  const time = new Date(msg.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = timeStr + (msg.readBy && msg.readBy.includes(currentUserId) ? ' ✓' : '');
  li.appendChild(meta);

  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener('submit', e => {
  e.preventDefault();
  if (!currentChatId) return alert('Select a chat first');
  const text = inputEl.value;
  if (text.trim() === '') return;
  socket.emit('send message', { chatId: currentChatId, text });
  inputEl.value = '';
});

fileBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length === 0) return;
  if (!currentChatId) return alert('Select a chat first');

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  fetch('/upload', { method: 'POST', body: formData })
    .then(res => res.json())
    .then(data => {
      socket.emit('send message', { chatId: currentChatId, fileUrl: data.fileUrl });
      fileInput.value = '';
    });
});

// Socket events

socket.on('new message', msg => {
  if (msg.chatId === currentChatId || !currentChatId) {
    addMessage(msg);
  }
});

socket.on('user online', ({ userId, username, online }) => {
  const user = users.find(u => u._id === userId);
  if (user) {
    user.online = online;
    user.lastSeen = online ? null : new Date();
    renderUsers();
  }
});

profileBtn.addEventListener('click', () => {
  window.location = '/profile.html';
});

logoutBtn.addEventListener('click', () => {
  fetch('/logout', { method: 'POST' })
    .then(() => window.location = '/login.html');
});
