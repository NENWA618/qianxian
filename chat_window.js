// 聊天室小窗逻辑（简化版，仅支持公聊，自动连接，断线自动重连）

const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';
let socket = null;

// 消息追加到聊天区
function appendMsg(msg) {
  const body = document.getElementById('chat-float-body');
  const div = document.createElement('div');
  div.style.marginBottom = '0.5em';
  div.innerHTML = `<b style="color:#c2a469;">${escapeHtml(msg.username || '游客')}</b>：${escapeHtml(msg.content)}`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// 连接Socket.IO
function connectChat() {
  socket = io(API_BASE_URL, { withCredentials: true, transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    appendMsg({ username: '系统', content: '已连接聊天室' });
  });

  socket.on('disconnect', () => {
    appendMsg({ username: '系统', content: '已断开连接，正在尝试重连...' });
  });

  socket.on('chat message', appendMsg);

  socket.io.on('reconnect', () => {
    appendMsg({ username: '系统', content: '已重新连接' });
  });
}

// 发送消息
document.getElementById('chat-float-form').onsubmit = function(e) {
  e.preventDefault();
  const input = document.getElementById('chat-float-input');
  const content = input.value.trim();
  if (content && socket && socket.connected) {
    socket.emit('chat message', { content });
    input.value = '';
  }
};

// 关闭小窗
document.getElementById('chat-float-close').onclick = function() {
  window.close(); // 如果在iframe中可用，否则隐藏小窗
  // 或 document.getElementById('chat-float-window').style.display = 'none';
};

// 防止XSS
function escapeHtml(str) {
  return (str || '').replace(/[<>&"']/g, function (c) {
    return ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;'
    })[c];
  });
}

window.onload = connectChat;