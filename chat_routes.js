const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-3.5-flash-lite',
  systemInstruction: 'You are a friendly, natural conversation partner. Keep replies short, usually one to three sentences, and talk like a person in a chat. Ask a brief follow-up question when it helps.'
});

const chatsRoot = path.join(__dirname, 'chats');
const RESERVED_FILES = ['projects.json'];

// Each visitor gets a folder: the username if logged in, otherwise a guest folder
function userDir(req) {
  const name = req.session.user ? req.session.user.username : 'guest-' + req.sessionID;
  const safe = String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(chatsRoot, safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isSafeId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function chatFile(req, id) {
  return path.join(userDir(req), id + '.json');
}

function readChat(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeChat(file, chat) {
  fs.writeFileSync(file, JSON.stringify(chat, null, 2));
}

function chatFiles(req) {
  const dir = userDir(req);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !RESERVED_FILES.includes(f))
    .map(f => path.join(dir, f));
}

function projectsFile(req) {
  return path.join(userDir(req), 'projects.json');
}

function readProjects(req) {
  const file = projectsFile(req);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function writeProjects(req, list) {
  fs.writeFileSync(projectsFile(req), JSON.stringify(list, null, 2));
}

// ---------- Chats ----------

// List conversations for the sidebar
router.get('/chats', (req, res) => {
  const list = chatFiles(req)
    .map(file => {
      const chat = readChat(file);
      return {
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        pinned: !!chat.pinned,
        projectId: chat.projectId || null
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

// Start a new conversation, optionally inside a project
router.post('/chats', (req, res) => {
  const id = newId();
  const now = new Date().toISOString();
  const projectId = req.body.projectId || null;
  const chat = { id, title: 'New chat', createdAt: now, updatedAt: now, pinned: false, projectId, messages: [] };
  writeChat(chatFile(req, id), chat);
  res.json({ id, title: chat.title, updatedAt: now, pinned: false, projectId });
});

// Load one conversation with its messages
router.get('/chats/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Bad chat id.' });
  const file = chatFile(req, req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Chat not found.' });
  res.json(readChat(file));
});

// Send a message and save the reply
router.post('/chats/:id/message', async (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Bad chat id.' });
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Please type a message.' });

  const file = chatFile(req, req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Chat not found.' });
  const chat = readChat(file);
    // Ignore an identical message sent again within 5 seconds (double submit)
  const lastUser = chat.messages[chat.messages.length - 2];
  const recent = Date.now() - new Date(chat.updatedAt).getTime() < 5000;
  if (recent && lastUser && lastUser.parts[0].text === message) {
    const lastReply = chat.messages[chat.messages.length - 1];
    return res.json({ reply: lastReply.parts[0].text, title: chat.title, updatedAt: chat.updatedAt });
  }

  try {
    const chatSession = model.startChat({ history: [...chat.messages] }); // copy, so the SDK doesn't add to chat.messages
    const result = await chatSession.sendMessage(message);
    const reply = result.response.text();

    chat.messages.push(
      { role: 'user', parts: [{ text: message }] },
      { role: 'model', parts: [{ text: reply }] }
    );
    chat.messages = chat.messages.slice(-40);

    if (chat.title === 'New chat') {
      chat.title = message.length > 40 ? message.slice(0, 40) + '...' : message;
    }
    chat.updatedAt = new Date().toISOString();
    writeChat(file, chat);

    res.json({ reply, title: chat.title, updatedAt: chat.updatedAt });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Sorry, something went wrong. Please try again.' });
  }
});

// Rename, pin/unpin, or move a chat to a project (or out of one)
router.patch('/chats/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Bad chat id.' });
  const file = chatFile(req, req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Chat not found.' });

  const chat = readChat(file);

  if (typeof req.body.title === 'string') {
    const title = req.body.title.trim().slice(0, 60);
    if (!title) return res.status(400).json({ error: 'Title cannot be empty.' });
    chat.title = title;
  }
  if (typeof req.body.pinned === 'boolean') {
    chat.pinned = req.body.pinned;
  }
  if (req.body.projectId !== undefined) {
    chat.projectId = req.body.projectId || null;
  }

  writeChat(file, chat);
  res.json({ id: chat.id, title: chat.title, pinned: !!chat.pinned, projectId: chat.projectId || null });
});

// Delete a chat
router.delete('/chats/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Bad chat id.' });
  const file = chatFile(req, req.params.id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// ---------- Projects ----------

// List projects
router.get('/projects', (req, res) => {
  res.json(readProjects(req));
});

// Create a project
router.post('/projects', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Project name cannot be empty.' });

  const project = { id: newId(), name };
  const list = readProjects(req);
  list.push(project);
  writeProjects(req, list);
  res.json(project);
});

// Delete a project; its chats stay, but move to All chats
router.delete('/projects/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Bad project id.' });

  writeProjects(req, readProjects(req).filter(p => p.id !== req.params.id));

  chatFiles(req).forEach(file => {
    const chat = readChat(file);
    if (chat.projectId === req.params.id) {
      chat.projectId = null;
      writeChat(file, chat);
    }
  });

  res.json({ ok: true });
});

module.exports = router;