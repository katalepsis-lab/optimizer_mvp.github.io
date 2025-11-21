/* ============================================
   CONFIG + STATE
============================================ */

const STORAGE_KEY = "local_chat_state_v1";

let conversations = [];
let currentConversationId = null;
let keepContext = true;
/* TTS audio state */
let ttsAudio = null;
let ttsPlaying = false;
let isCancelled = false;
let isTyping = false;



const messagesEl = document.getElementById("messages");
const conversationListEl = document.getElementById("conversationList");
const chatTitleEl = document.getElementById("chatTitle");
const userInputEl = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const newOptChatBtn = document.getElementById("newOptChatBtn");
const modelSelectEl = document.getElementById("modelSelect");
const keepContextToggle = document.getElementById("keepContextToggle");
const micBtn = document.getElementById("micBtn");

/* VOICE RECORDING */
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

/* ============================================
   LOCAL STORAGE (PERSISTENCE)
============================================ */

function saveState() {
  const state = {
    conversations,
    currentConversationId,
    keepContext,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const state = JSON.parse(raw);
    conversations = (state.conversations || []).map((conv) => ({
      ...conv,
      messages: conv.messages || [],
      files: conv.files || [],
    }));
    currentConversationId = state.currentConversationId || null;
    keepContext = state.keepContext ?? true;
  } catch {}
}

/* ============================================
   CONVERSATION MANAGEMENT
============================================ */

function createConversation() {
  const id = Date.now().toString();
  const conv = {
    id,
    title: "New chat",
    messages: [],
    files: [],
  };
  conversations.unshift(conv);
  currentConversationId = id;
  saveState();
  renderSidebar();
  renderConversation();
}

function switchConversation(id) {
  currentConversationId = id;
  saveState();
  renderSidebar();
  renderConversation();
}

function deleteConversation(id) {
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return;

  conversations.splice(idx, 1);

  if (currentConversationId === id) {
    currentConversationId = conversations[0]?.id || null;

    if (!currentConversationId) {
      createConversation();
      return;
    }
  }

  saveState();
  renderSidebar();
  renderConversation();
}

/* ============================================
   SIDEBAR RENDERING
============================================ */

function renderSidebar() {
  conversationListEl.innerHTML = "";

  conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.className =
      "conversation-item" + (conv.id === currentConversationId ? " active" : "");

    const titleSpan = document.createElement("span");
    titleSpan.className = "conv-title";
    titleSpan.textContent = conv.title;

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "✕";

    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    };

    item.onclick = () => switchConversation(conv.id);

    item.appendChild(titleSpan);
    item.appendChild(delBtn);
    conversationListEl.appendChild(item);
  });
}

/* ============================================
   CHAT RENDERING
============================================ */

function renderConversation() {
  const conv = conversations.find((c) => c.id === currentConversationId);
  messagesEl.innerHTML = "";

  if (!conv) {
    chatTitleEl.textContent = "New chat";
    return;
  }

  chatTitleEl.textContent = conv.title;

  conv.messages.forEach((msg) => {
    appendMessageToDOM(msg.role, msg.content, false);
  });

  scrollToBottom();
}

/* ============================================
   MESSAGE RENDERING + MARKDOWN + CODE
============================================ */

function appendMessageToDOM(role, text, animate) {
  const row = document.createElement("div");
  row.className = "message-row " + (role === "user" ? "user" : "assistant");

    const avatar = document.createElement("div");
    avatar.className = "avatar";

    if (role === "assistant") {
        const img = document.createElement("img");
        img.src = "logo.png";
        img.className = "avatar-ai";
        avatar.appendChild(img);
    } else {
        avatar.textContent = "You";
    }


  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "assistant") {
    if (animate) {
    typeText(bubble, text, 12, () => {
        // Add TTS only after typing is done
        addTTSButton(bubble, text);
    });
    } else {
    bubble.innerHTML = renderMarkdown(text);
    addTTSButton(bubble, text);
    Prism.highlightAllUnder(bubble);
    }

  } else {
    bubble.textContent = text;
  }

  if (role === "assistant") {
    row.appendChild(avatar);
    row.appendChild(bubble);
  } else {
    row.appendChild(bubble);
    row.appendChild(avatar);
  }

  messagesEl.appendChild(row);
  scrollToBottom();
}

function renderMarkdown(text) {
  return marked.parse(text, {
    breaks: true,
    gfm: true,
  });
}

/* TYPEWRITER EFFECT */
async function typeText(el, text, speed = 12, done) {
  el.innerHTML = "";
  let buffer = "";

  isCancelled = false;
  isTyping = true;

  // Turn Send → Stop
  sendBtn.textContent = "Stop";
  sendBtn.classList.add("stop");

  for (let i = 0; i < text.length; i++) {
    if (isCancelled) {
      isTyping = false;
      el.innerHTML = renderMarkdown(buffer);
      Prism.highlightAllUnder(el);

      // Reset button
      sendBtn.textContent = "Send";
      sendBtn.classList.remove("stop");

      if (done) done();
      return;
    }

    buffer += text[i];

    if (i % 5 === 0 || i === text.length - 1) {
      el.innerHTML = renderMarkdown(buffer);
      Prism.highlightAllUnder(el);
    }

    await new Promise((r) => setTimeout(r, speed));
    scrollToBottom();
  }

  // AI finished typing
  isTyping = false;

  sendBtn.textContent = "Send";
  sendBtn.classList.remove("stop");

  if (done) done();
}



/* TTS BUTTON */
function addTTSButton(bubble, text) {
  const playBtn = document.createElement("button");
  playBtn.className = "tts-btn";
  playBtn.textContent = "🔊";
  playBtn.title = "Play audio";

  const stopBtn = document.createElement("button");
  stopBtn.className = "tts-stop-btn hidden";
  stopBtn.textContent = "⏹️";
  stopBtn.title = "Stop audio";

  playBtn.onclick = (e) => {
    e.stopPropagation();
    playTTS(text, playBtn, stopBtn);
  };

  stopBtn.onclick = (e) => {
    e.stopPropagation();
    stopTTS(playBtn, stopBtn);
  };

    const wrapper = document.createElement("span");
    wrapper.className = "tts-wrapper";

    wrapper.appendChild(playBtn);
    wrapper.appendChild(stopBtn);

    bubble.appendChild(wrapper);

}


/* ============================================
   SCROLL
============================================ */

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ============================================
   SENDING MESSAGES
============================================ */

async function sendMessage() {
  const text = userInputEl.value.trim();
  if (!text) return;

  if (!currentConversationId) createConversation();

  const conv = conversations.find((c) => c.id === currentConversationId);

  if (conv.messages.length === 0) {
    conv.title = text.slice(0, 30) + (text.length > 30 ? "..." : "");
    renderSidebar();
  }

  conv.messages.push({ role: "user", content: text });
  appendMessageToDOM("user", text, false);
  userInputEl.value = "";

  saveState();

  const typingRow = document.createElement("div");
  typingRow.className = "message-row assistant";
  typingRow.innerHTML = `
    <div class="avatar">AI</div>
    <div class="bubble"><span class="typing">AI is typing…</span></div>
  `;
  messagesEl.appendChild(typingRow);

  scrollToBottom();

  const messagesToSend = keepContext
    ? conv.messages.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: "user", content: text }];

  const model = modelSelectEl.value;
  const payload = { messages: messagesToSend, model };

  if (conv.files && conv.files.length > 0) {
    payload.fileIds = conv.files.map((file) => file.id);
  }

  try {
    const res = await fetch("http://127.0.0.1:8000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    messagesEl.removeChild(typingRow);

    if (!res.ok) {
      const errText = data.error?.message || "Error from API";
      conv.messages.push({ role: "assistant", content: errText });
      appendMessageToDOM("assistant", errText, false);
      saveState();
      return;
    }

    const reply = data.reply;
    conv.messages.push({ role: "assistant", content: reply });
    appendMessageToDOM("assistant", reply, true);
    saveState();
  } catch (err) {
    messagesEl.removeChild(typingRow);
    appendMessageToDOM("assistant", "Network error", false);
  }
}

/* ============================================
   VOICE INPUT (RECORD → TRANSCRIBE)
============================================ */

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(reader.result.split(",")[1]); // remove header
    reader.readAsDataURL(blob);
  });
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const base64 = await blobToBase64(blob);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64 }),
      });

      const data = await res.json();
      if (data.text) {
        userInputEl.value = data.text;
      }
    };

    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "■";
  } catch (err) {
    console.error("Mic error:", err);
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    isRecording = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
  }
}

/* ============================================
   TEXT-TO-SPEECH
============================================ */

async function playTTS(text, playBtn, stopBtn) {
  try {
    // Stop previous audio if exists
    if (ttsAudio) {
      ttsAudio.pause();
      ttsAudio.currentTime = 0;
    }

    // Update UI
    playBtn.classList.add("tts-playing");
    stopBtn.classList.remove("hidden");
    playBtn.classList.add("hidden");

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const arr = await res.arrayBuffer();
    const blob = new Blob([arr], { type: "audio/mpeg" });

    ttsAudio = new Audio(URL.createObjectURL(blob));

    ttsAudio.onended = () => {
      playBtn.classList.remove("hidden");
      playBtn.classList.remove("tts-playing");
      stopBtn.classList.add("hidden");
    };

    ttsAudio.play();
    ttsPlaying = true;
  } catch (err) {
    console.error("TTS error:", err);
    playBtn.classList.remove("tts-playing");
    stopBtn.classList.add("hidden");
    playBtn.classList.remove("hidden");
  }
}

function stopTTS(playBtn, stopBtn) {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
  }

  playBtn.classList.remove("hidden");
  playBtn.classList.remove("tts-playing");
  stopBtn.classList.add("hidden");
}


/* ============================================
   EVENT LISTENERS
============================================ */

sendBtn.onclick = () => {
  if (isTyping) {
    // user clicked STOP
    isCancelled = true;
    sendBtn.textContent = "Send";
    sendBtn.classList.remove("stop");
    return;
  }

  sendMessage();
};


userInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

newChatBtn.onclick = () => createConversation();
newOptChatBtn.onclick = () => createOptimizationConversation();


keepContextToggle.onchange = () => {
  keepContext = keepContextToggle.checked;
  saveState();
};

micBtn.onclick = () => {
  if (isRecording) stopRecording();
  else startRecording();
};

const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");

// When clicking the paperclip, open the real file dialog
fileBtn.onclick = () => fileInput.click();

// FILE UPLOAD HANDLING
fileInput.onchange = async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  // Show in chat
  appendMessageToDOM("user", `📁 Uploaded: ${file.name}`, false);

  // Send to backend
  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();

  if (data.error) {
    appendMessageToDOM("assistant", "Upload failed: " + data.error, false);
  } else {
    const conv = conversations.find((c) => c.id === currentConversationId);
    if (conv) {
      conv.files = conv.files || [];
      if (data.openAIFileId) {
        conv.files.push({
          id: data.openAIFileId,
          name: file.name,
        });
        saveState();
      }
    }
    appendMessageToDOM("assistant", "File uploaded successfully!", false);
  }
};



/* ============================================
   INITIALIZE
============================================ */

loadState();

if (conversations.length === 0) {
  createConversation();
} else {
  keepContextToggle.checked = keepContext;
  if (!currentConversationId && conversations[0])
    currentConversationId = conversations[0].id;

  renderSidebar();
  renderConversation();
}

function createOptimizationConversation() {
  const id = Date.now().toString();
  const conv = {
    id,
    title: "Optimizer Setup",
    messages: [
      { role: "assistant", content: "Do you want factor based or sub-asset based optimizer ?" }
    ],
    files: [],
  };

  conversations.unshift(conv);
  currentConversationId = id;

  saveState();
  renderSidebar();
  renderConversation();
}


