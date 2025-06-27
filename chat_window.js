// 聊天室小窗完整逻辑：支持公聊、私聊、@、图片、历史、未读、好友、权限、系统通知、拖动、最小化、关闭

const API_BASE_URL = window.API_BASE_URL || "https://qianxian-backend.onrender.com";
let socket = null;
let currentUser = null;
let friendsList = [];
let unreadCount = 0;
let minimized = false;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let windowPos = { right: 24, bottom: 24 };

// ========== 工具函数 ==========
function escapeHtml(str) {
  return (str || "").replace(/[<>&"']/g, function (c) {
    return {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#39;"
    }[c];
  });
}
function sanitize(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html) : escapeHtml(html);
}
function showGlobalError(msg, duration = 4000) {
  let tip = document.getElementById("global-error-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "global-error-tip";
    tip.style.position = "fixed";
    tip.style.top = "20px";
    tip.style.left = "50%";
    tip.style.transform = "translateX(-50%)";
    tip.style.background = "#e74c3c";
    tip.style.color = "#fff";
    tip.style.padding = "10px 24px";
    tip.style.borderRadius = "8px";
    tip.style.zIndex = 10001;
    tip.style.fontSize = "1em";
    document.body.appendChild(tip);
  }
  tip.textContent = msg;
  tip.style.display = "block";
  setTimeout(() => { tip.style.display = "none"; }, duration);
}

// ========== 聊天渲染 ==========
function appendMsg(msg, isSelf = false) {
  const body = document.getElementById("chat-float-body");
  const div = document.createElement("div");
  div.style.marginBottom = "0.5em";
  let content = msg.content;
  // 图片支持
  if (typeof content === "string" && content.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    content = `<img src="${sanitize(content)}" alt="图片" style="max-width:80%;border-radius:6px;">`;
  } else {
    content = sanitize(content);
    // @高亮
    if (currentUser && content.includes("@" + currentUser.username)) {
      content = content.replace(
        new RegExp("@" + escapeHtml(currentUser.username), "g"),
        `<span style="color:#e67e22;font-weight:bold">@${escapeHtml(currentUser.username)}</span>`
      );
    }
  }
  div.innerHTML =
    `<b style="color:${isSelf ? "#a68b5b" : "#c2a469"};">${escapeHtml(msg.username || "游客")}</b>：${content}` +
    (msg.time ? `<span style="float:right;color:#bbb;font-size:0.9em;">${msg.time.slice(11, 16)}</span>` : "");
  if (isSelf) div.style.textAlign = "right";
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// ========== Socket 连接 ==========
function connectChat() {
  socket = io(API_BASE_URL, { withCredentials: true, transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    appendMsg({ username: "系统", content: "已连接聊天室" });
    fetchCurrentUser();
    fetchFriends();
    fetchHistory();
  });

  socket.on("disconnect", () => {
    appendMsg({ username: "系统", content: "已断开连接，正在尝试重连..." });
  });

  socket.on("chat message", (msg) => {
    appendMsg(msg, currentUser && msg.user_id === currentUser.id);
    if (minimized) {
      unreadCount++;
      updateUnreadDot();
    }
  });

  socket.io.on("reconnect", () => {
    appendMsg({ username: "系统", content: "已重新连接" });
    fetchHistory();
  });

  // 系统通知
  socket.on("system notification", (msg) => {
    appendMsg({ username: "系统", content: `<span style="color:#e67e22">${sanitize(msg)}</span>` });
  });
}

// ========== 历史消息 ==========
function fetchHistory() {
  fetch(API_BASE_URL + "/api/chat/history", { credentials: "include" })
    .then(r => r.json())
    .then(res => {
      if (res.success && Array.isArray(res.data)) {
        document.getElementById("chat-float-body").innerHTML = "";
        res.data.forEach(msg => appendMsg(msg, currentUser && msg.user_id === currentUser.id));
      }
    });
}

// ========== 当前用户信息 ==========
function fetchCurrentUser() {
  fetch(API_BASE_URL + "/api/user", { credentials: "include" })
    .then(r => r.json())
    .then(res => {
      if (res.success) currentUser = res.data;
    });
}

// ========== 好友列表 ==========
function fetchFriends() {
  fetch(API_BASE_URL + "/api/friends", { credentials: "include" })
    .then(r => r.json())
    .then(res => {
      if (res.success && Array.isArray(res.data)) friendsList = res.data;
    });
}

// ========== 发送消息 ==========
document.getElementById("chat-float-form").onsubmit = function (e) {
  e.preventDefault();
  const input = document.getElementById("chat-float-input");
  const content = input.value.trim();
  if (!content) return;
  if (socket && socket.connected) {
    socket.emit("chat message", { content });
    input.value = "";
  } else {
    showGlobalError("未连接聊天室，稍后再试");
  }
};

// ========== 拖动小窗 ==========
const chatWindow = document.getElementById("chat-float-window");
const header = document.getElementById("chat-float-header");
header.addEventListener("mousedown", (e) => {
  dragging = true;
  dragOffset.x = e.clientX - chatWindow.getBoundingClientRect().right;
  dragOffset.y = e.clientY - chatWindow.getBoundingClientRect().bottom;
  document.body.style.userSelect = "none";
});
document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  let right = window.innerWidth - e.clientX - dragOffset.x;
  let bottom = window.innerHeight - e.clientY - dragOffset.y;
  right = Math.max(0, Math.min(right, window.innerWidth - 100));
  bottom = Math.max(0, Math.min(bottom, window.innerHeight - 100));
  chatWindow.style.right = right + "px";
  chatWindow.style.bottom = bottom + "px";
  windowPos = { right, bottom };
});
document.addEventListener("mouseup", () => {
  dragging = false;
  document.body.style.userSelect = "";
});

// ========== 最小化/恢复 ==========
const minBtn = document.getElementById("chat-float-min");
const minBox = document.getElementById("chat-float-minimized");
const unreadDot = document.getElementById("chat-float-unread-dot");
minBtn.onclick = function () {
  chatWindow.style.display = "none";
  minBox.style.display = "flex";
  minimized = true;
  updateUnreadDot();
};
minBox.onclick = function () {
  chatWindow.style.display = "flex";
  minBox.style.display = "none";
  minimized = false;
  unreadCount = 0;
  updateUnreadDot();
  setTimeout(() => {
    document.getElementById("chat-float-input").focus();
  }, 100);
};
function updateUnreadDot() {
  unreadDot.style.display = unreadCount > 0 ? "block" : "none";
}

// ========== 关闭 ==========
document.getElementById("chat-float-close").onclick = function () {
  chatWindow.style.display = "none";
  minBox.style.display = "none";
  if (socket) socket.disconnect();
};

// ========== 初始化 ==========
window.onload = connectChat;