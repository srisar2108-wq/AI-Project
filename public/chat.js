const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const chatForm = document.getElementById('chatForm');
const resetBtn = document.getElementById('reset');

function addBubble(text, who) {
  const div = document.createElement('div');
  div.className = 'bubble ' + who;
  div.textContent = text; // textContent keeps replies safe from HTML injection
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  addBubble(text, 'user');
  input.value = '';
  sendBtn.disabled = true;

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    addBubble(data.reply, 'bot');
  } catch (err) {
    addBubble('Network error: ' + err.message, 'bot');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

async function resetChat() {
  await fetch('/chat/reset', { method: 'POST' });
  messages.innerHTML = '';
}

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

resetBtn.addEventListener('click', resetChat);