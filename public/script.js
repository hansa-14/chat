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
const createGroupBtn = document.getElementById('createGroupBtn');

const groupModal = document.getElementById('groupModal');
const closeModal = document.getElementById('closeModal');
const groupNameInput = document.getElementById('groupName');
const groupUsersList = document.getElementById('groupUsersList');
const createGroupConfirmBtn = document.getElementById('createGroupConfirmBtn');

let users = []; // All users from server

// Fetch current user info
fetch('/current-user')
  .then(res => res.json())
  .then(data => {
    currentUserId = data.userId;
    currentUsername = data.username;
    loadUsers();
    loadChats();
  })
  .catch(() => {
    alert('Not logged in');
    window.location = '/login';
  });

function loadUsers() {
  fetch('/users')
    .then(res => res.json())
    .then(data => {
      users = data;
      renderUsers();
    });
}

function renderUsers() {
  usersListEl.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user.username;
    li.classList.toggle('online', user.online);
    li.addEventListener('click', () => startPrivateChat(user));
    usersListEl.appendChild(li);
  });
}

function startPrivateChat(user) {
  if (currentChatId) {
    socket.emit('leave', currentChatId);
  }
  // Ask server for private chat with this user
  socket.emit('join private chat', user._id);
  currentChatId = null;
  chatHeader.innerHTML = `<h2>Chat with ${user.username}</h2>`;
  inputEl.disabled = false;
  fileBtn.disabled = false;
  formEl.querySelector('button[type=submit]').disabled = false;
  messagesEl.innerHTML = '';
  currentChatId = null; // will be set on first message or event

  // Save chatId on first message
  socket.once('chat messages', (msgs) => {
    // Show messages
    messagesEl.innerHTML = '';
    msgs.forEach(msg => addMessage(msg));
    if (msgs.length > 0) {
      currentChatId = msgs[0].chatId || null;
    }
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

socket.on('messages read update', ({ chatId, messageIds, userId }) => {
  if (chatId === currentChatId) {
    // TODO: update read receipts UI
  }
});

// Group chat modal handling

createGroupBtn.addEventListener('click', () => {
  groupModal.style.display = 'flex';
  groupNameInput.value = '';
  groupUsersList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = user._id;
    li.appendChild(checkbox);
    const label = document.createElement('label');
    label.textContent = user.username;
    li.appendChild(label);
    groupUsersList.appendChild(li);
  });
});

closeModal.addEventListener('click', () => {
  groupModal.style.display = 'none';
});

createGroupConfirmBtn.addEventListener('click', () => {
  const groupName = groupNameInput.value.trim();
  if (!groupName) return alert('Group name required');

  const selectedUserIds = Array.from(groupUsersList.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
  if (selectedUserIds.length === 0) return alert('Select at least one user');

  fetch('/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: groupName, userIds: selectedUserIds.concat(currentUserId) })
  })
    .then(res => res.json())
    .then(chat => {
      groupModal.style.display = 'none';
      alert('Group created!');
      loadChats();
    });
});

// Load all chats (groups and private) and show in sidebar or similar
function loadChats() {
  // TODO: Implement chat list UI and selection
}
