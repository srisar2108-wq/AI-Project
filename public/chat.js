const chatList = document.getElementById('chatList');
const projectList = document.getElementById('projectList');
const newProjectBtn = document.getElementById('newProject');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const chatForm = document.getElementById('chatForm');
const newChatBtn = document.getElementById('newChat');
const searchInput = document.getElementById('search');

let currentId = null;
let chats = [];
let projects = [];
let collapsed = new Set(); // project IDs that are folded up
let sending = false;       // blocks a second send while a reply is pending

// ---------- Helpers ----------
function addBubble(text, who) {
  const div = document.createElement('div');
  div.className = 'bubble ' + who;
  div.textContent = text; // textContent keeps replies safe from HTML injection
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function groupLabel(dateString) {
  const d = new Date(dateString);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function matches(chat, query) {
  return chat.title.toLowerCase().includes(query);
}

// Redraw both the project tree and the chat list
function renderAll() {
  const query = searchInput.value.trim().toLowerCase();
  renderProjectTree(query);
  renderChatList(query);
}

// ---------- Loading ----------
async function loadProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) return;
  projects = await res.json();
  renderAll();
}

async function loadChatList() {
  const res = await fetch('/api/chats');
  if (!res.ok) return;
  chats = await res.json();
  renderAll();
}

// ---------- Project tree ----------
function renderProjectTree(query) {
  projectList.innerHTML = '';

  if (projects.length === 0) {
    projectList.innerHTML = '<div class="empty-note">No projects yet. Click + to create one.</div>';
    return;
  }

  projects.forEach(project => {
    const kids = chats.filter(c => c.projectId === project.id && matches(c, query));
    const nameMatches = project.name.toLowerCase().includes(query);
    if (query && kids.length === 0 && !nameMatches) return;

    projectList.appendChild(makeProjectRow(project));
    if (collapsed.has(project.id)) return;

    if (kids.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note nested';
      note.textContent = 'No chats yet. Click + to start one.';
      projectList.appendChild(note);
    }
    kids.forEach(chat => projectList.appendChild(makeChatItem(chat, true)));
  });
}

function makeProjectRow(project) {
  const row = document.createElement('div');
  row.className = 'project-item';

  const arrow = document.createElement('span');
  arrow.className = 'project-arrow';
  arrow.textContent = collapsed.has(project.id) ? '▸' : '▾';
  arrow.addEventListener('click', () => toggleProject(project.id));

  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = project.name;
  name.addEventListener('click', () => toggleProject(project.id));

  const add = document.createElement('button');
  add.className = 'project-add';
  add.type = 'button';
  add.title = 'New chat in this project';
  add.textContent = '+';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    startChatInProject(project.id);
  });

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.type = 'button';
  del.title = 'Delete project (chats are kept)';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteProject(project.id);
  });

  row.appendChild(arrow);
  row.appendChild(name);
  row.appendChild(add);
  row.appendChild(del);
  return row;
}

function toggleProject(id) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  renderAll();
}

async function createProject() {
  const name = prompt('Project name:');
  if (!name || !name.trim()) return;

  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  if (!res.ok) {
    alert('Could not create the project.');
    return;
  }
  projects.push(await res.json());
  renderAll();
}

async function deleteProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;
  if (!confirm(`Delete project "${project.name}"? Its chats will move to the chat list.`)) return;

  await fetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' });

  projects = projects.filter(p => p.id !== id);
  chats.forEach(c => { if (c.projectId === id) c.projectId = null; });
  collapsed.delete(id);
  renderAll();
}

async function startChatInProject(projectId) {
  collapsed.delete(projectId);
  const chat = await createChat(projectId);
  if (!chat) return;
  await openChat(chat.id);
  input.focus();
}

// ---------- Chat list (chats not in a project) ----------
function renderChatList(query) {
  chatList.innerHTML = '';

  const loose = chats.filter(c => !c.projectId && matches(c, query));

  if (loose.length === 0) {
    if (query) {
      chatList.innerHTML = '<div class="empty-note">No chats match your search.</div>';
    } else if (chats.length === 0) {
      chatList.innerHTML = '<div class="empty-note">No chats yet. Click New chat to start.</div>';
    }
    return;
  }

  const pinned = loose.filter(c => c.pinned);
  const others = loose.filter(c => !c.pinned);

  if (pinned.length) addGroup('Pinned', pinned);

  const groups = {};
  const order = [];
  others.forEach(chat => {
    const label = groupLabel(chat.updatedAt);
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(chat);
  });
  order.forEach(label => addGroup(label, groups[label]));
}

function addGroup(label, list) {
  const title = document.createElement('div');
  title.className = 'group-title';
  title.textContent = label;
  chatList.appendChild(title);
  list.forEach(chat => chatList.appendChild(makeChatItem(chat, false)));
}

function makeChatItem(chat, nested) {
  const item = document.createElement('div');
  item.className = 'chat-item' + (nested ? ' nested' : '') + (chat.id === currentId ? ' active' : '');

  const name = document.createElement('span');
  name.className = 'chat-title';
  name.textContent = chat.title;
  name.addEventListener('click', () => openChat(chat.id));

  const pin = document.createElement('button');
  pin.className = 'pin-btn' + (chat.pinned ? ' active' : '');
  pin.type = 'button';
  pin.title = chat.pinned ? 'Unpin chat' : 'Pin chat';
  pin.textContent = '📌';
  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(chat.id);
  });

  const move = document.createElement('button');
  move.className = 'move-btn';
  move.type = 'button';
  move.title = 'Move to project';
  move.textContent = '📁';
  move.addEventListener('click', (e) => {
    e.stopPropagation();
    moveChat(chat.id);
  });

  const rename = document.createElement('button');
  rename.className = 'rename-btn';
  rename.type = 'button';
  rename.title = 'Rename chat';
  rename.textContent = '✎';
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    renameChat(chat.id);
  });

  const del = document.createElement('button');
  del.className = 'delete-btn';
  del.type = 'button';
  del.title = 'Delete chat';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteChat(chat.id);
  });

  item.appendChild(name);
  item.appendChild(pin);
  item.appendChild(move);
  item.appendChild(rename);
  item.appendChild(del);
  return item;
}

// ---------- Open a conversation ----------
async function openChat(id) {
  const res = await fetch('/api/chats/' + encodeURIComponent(id));
  if (!res.ok) return;
  const chat = await res.json();

  currentId = id;
  chatTitle.textContent = chat.title;
  messages.innerHTML = '';
  chat.messages.forEach(turn => {
    addBubble(turn.parts[0].text, turn.role === 'user' ? 'user' : 'bot');
  });
  renderAll();
}

// ---------- New chat ----------
async function createChat(projectId) {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: projectId || null })
  });
  if (!res.ok) return null;
  const chat = await res.json();
  chats.unshift(chat);
  return chat;
}

async function startNewChat() {
  const chat = await createChat(null);
  if (!chat) return;
  await openChat(chat.id);
  input.focus();
}

// ---------- Pin ----------
async function togglePin(id) {
  const chat = chats.find(c => c.id === id);
  if (!chat) return;

  const res = await fetch('/api/chats/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: !chat.pinned })
  });
  if (!res.ok) return;

  const data = await res.json();
  chat.pinned = data.pinned;
  renderAll();
}

// ---------- Move to project ----------
async function moveChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  if (projects.length === 0) {
    alert('Create a project first with the + next to Projects.');
    return;
  }

  const names = projects.map(p => p.name).join(', ');
  const answer = prompt(
    `Move to which project? Options: ${names}\nLeave blank to remove it from its project.`,
    ''
  );
  if (answer === null) return;

  const wanted = answer.trim().toLowerCase();
  let projectId = null;
  if (wanted) {
    const match = projects.find(p => p.name.toLowerCase() === wanted);
    if (!match) {
      alert('No project with that name.');
      return;
    }
    projectId = match.id;
  }

  const res = await fetch('/api/chats/' + encodeURIComponent(chatId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  });
  if (!res.ok) {
    alert('Could not move this chat.');
    return;
  }
  chat.projectId = projectId;
  renderAll();
}

// ---------- Rename ----------
async function renameChat(id) {
  const chat = chats.find(c => c.id === id);
  if (!chat) return;

  const newTitle = prompt('Rename chat:', chat.title);
  if (newTitle === null) return;
  const title = newTitle.trim();
  if (!title) return;

  const res = await fetch('/api/chats/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  if (!res.ok) {
    alert('Could not rename this chat.');
    return;
  }

  const data = await res.json();
  chat.title = data.title;
  if (currentId === id) chatTitle.textContent = data.title;
  renderAll();
}

// ---------- Delete ----------
async function deleteChat(id) {
  if (!confirm('Delete this chat?')) return;
  await fetch('/api/chats/' + encodeURIComponent(id), { method: 'DELETE' });
  chats = chats.filter(c => c.id !== id);
  if (currentId === id) {
    currentId = null;
    messages.innerHTML = '';
    chatTitle.textContent = 'Chat with Gemini';
  }
  renderAll();
}

// ---------- Send a message ----------
async function sendMessage() {
  if (sending) return;

  const text = input.value.trim();
  if (!text) return;

  sending = true;
  sendBtn.disabled = true;

  try {
    if (!currentId) {
      const chat = await createChat(null);
      if (!chat) return;
      currentId = chat.id;
    }

    addBubble(text, 'user');
    input.value = '';

    const res = await fetch('/api/chats/' + encodeURIComponent(currentId) + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();

    if (!res.ok) {
      addBubble(data.error || 'Something went wrong.', 'bot');
    } else {
      addBubble(data.reply, 'bot');
      chatTitle.textContent = data.title;
      const existing = chats.find(c => c.id === currentId);
      if (existing) {
        existing.title = data.title;
        existing.updatedAt = data.updatedAt;
      }
      chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      renderAll();
    }
  } catch (err) {
    addBubble('Network error: ' + err.message, 'bot');
  } finally {
    sending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---------- Events ----------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

newChatBtn.addEventListener('click', startNewChat);
newProjectBtn.addEventListener('click', createProject);
searchInput.addEventListener('input', renderAll);

// ---------- Start ----------
loadProjects();
loadChatList();