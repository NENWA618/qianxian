// 引入 utils.js（确保在 HTML 中 <script src="utils.js"></script> 在 main.js 之前引入）

// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';

// 聊天相关全局变量
let socket = null;
let currentChatType = 'public'; // 'public' or 'private'
let currentTargetId = 0; // 0: 公聊, 其他: 私聊对象ID
let chatHistoryLoaded = false;
let earliestMsgId = null;
let friendsList = [];
let currentUser = null;

// 聊天消息去重集合
let displayedMsgIds = new Set();

// =================== 好友申请相关全局变量 ===================
let friendRequests = []; // 收到的好友申请

// =================== 后台管理弹窗相关全局变量 ===================
let adminPendingUsers = []; // 待审核用户

// =================== 通知中心相关全局变量 ===================
let notifications = []; // 所有通知
let unreadNotificationCount = 0;

// =================== 系统通知相关全局变量 ===================
let systemNotification = ''; // 系统通知内容

// =================== 聊天未读消息相关全局变量 ===================
let unreadChat = {}; // { public: 2, private_5: 3, ... }

// 创建登录表单
const loginForm = document.createElement('div');
loginForm.className = 'login-form';
loginForm.innerHTML = `
  <div id="login-container">
    <h2>账号登录</h2>
    <form id="login-form">
      <input type="text" id="username" placeholder="用户名" required>
      <input type="password" id="password" placeholder="密码" required>
      <button type="submit">登录</button>
    </form>
    <div id="user-info" style="display:none;">
      <p>欢迎, <span id="username-display"></span></p>
      <button id="logout-btn">退出登录</button>
      <span style="margin-left:1.5rem;">
        <a href="#" id="show-change-password">修改密码</a>
      </span>
    </div>
    <div id="login-message"></div>
    <p id="register-link-row">
      <a href="#" id="show-register">注册</a>
    </p>
  </div>
`;
document.body.insertBefore(loginForm, document.body.firstChild);

// 创建注册表单
const registerForm = document.createElement('div');
registerForm.className = 'login-form';
registerForm.style.display = 'none';
registerForm.innerHTML = `
  <div id="register-container">
    <h2>账号注册</h2>
    <form id="register-form">
      <input type="text" id="reg-username" placeholder="用户名" required>
      <input type="password" id="reg-password" placeholder="密码" required>
      <button type="submit">注册</button>
    </form>
    <div id="register-message"></div>
    <p>已有账号? <a href="#" id="show-login">登录</a></p>
  </div>
`;
document.body.insertBefore(registerForm, document.body.firstChild);

// 聊天窗口HTML
const chatBox = document.createElement('div');
chatBox.id = 'chat-box';
chatBox.style.display = 'none';
chatBox.innerHTML = `
  <div style="max-width:800px;margin:2rem auto;padding:1.5rem;background:rgba(255,255,255,0.8);border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.05);">
    <h2 style="color:#c2a469;">聊天室</h2>
    <div id="chat-switch" style="margin-bottom:1rem;"></div>
    <button id="load-more-msg" style="display:none;margin-bottom:0.5rem;">加载更多</button>
    <div id="chat-messages" style="height:400px;overflow-y:auto;border:1px solid #eee;padding:1rem;margin-bottom:1rem;background:#faf8f4;"></div>
    <form id="chat-form" style="display:flex;gap:0.5rem;">
      <input id="chat-input" autocomplete="off" placeholder="输入消息..." style="flex:1;padding:0.5rem;border-radius:8px;border:1px solid #ddd;">
      <button type="submit" style="background:#c2a469;color:white;border:none;padding:0.5rem 1rem;border-radius:8px;">发送</button>
    </form>
  </div>
`;
document.body.appendChild(chatBox);

// =================== 通知中心入口与弹窗 ===================

// 在header插入通知中心入口
function renderNotificationCenterEntry() {
  let entry = document.getElementById('notification-center-entry');
  const adminLink = document.getElementById('admin-link');
  if (!currentUser) {
    if (entry) entry.remove();
    return;
  }
  if (!entry) {
    entry = document.createElement('button');
    entry.id = 'notification-center-entry';
    entry.className = 'add-friend-btn';
    entry.style = 'margin-right:1rem;position:relative;';
    entry.innerHTML = `<span style="vertical-align:middle;">消息中心</span><span id="notification-red-dot" class="red-dot" style="display:none;position:absolute;top:4px;right:2px;"></span>`;
    if (adminLink && adminLink.parentNode) {
      adminLink.parentNode.insertBefore(entry, adminLink);
    } else {
      document.body.appendChild(entry);
    }
    entry.onclick = showNotificationCenterPopup;
  }
  updateNotificationRedDot();
}

// 红点显示逻辑
function updateNotificationRedDot() {
  const dot = document.getElementById('notification-red-dot');
  if (dot) {
    dot.style.display = unreadNotificationCount > 0 ? 'inline-block' : 'none';
  }
}

// 显示通知中心弹窗
function showNotificationCenterPopup() {
  let popup = document.getElementById('notification-center-popup');
  if (popup) {
    popup.style.display = 'block';
    renderNotificationCenterList();
    unreadNotificationCount = 0;
    updateNotificationRedDot();
    return;
  }
  popup = document.createElement('div');
  popup.id = 'notification-center-popup';
  popup.className = 'friend-request-popup';
  popup.style = 'position:fixed;top:16%;left:50%;transform:translate(-50%,0);background:#fffbe9;border-radius:12px;box-shadow:0 2px 12px rgba(194,164,105,0.12);padding:2rem 1.5rem;z-index:1000;min-width:340px;max-width:95vw;';
  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">消息中心</h3>
    <div id="notification-tabs" style="display:flex;justify-content:center;gap:1.5rem;margin-bottom:1rem;">
      <button id="tab-friend" class="notification-tab-btn active">好友申请</button>
      <button id="tab-admin" class="notification-tab-btn">后台审核</button>
      <button id="tab-system" class="notification-tab-btn">系统通知</button>
    </div>
    <div id="notification-list-container"></div>
    <button id="close-notification-center-popup" style="margin-top:1rem;background:#aaa;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">关闭</button>
  `;
  document.body.appendChild(popup);
  document.getElementById('close-notification-center-popup').onclick = () => {
    popup.style.display = 'none';
  };
  // tab切换
  document.getElementById('tab-friend').onclick = () => switchNotificationTab('friend');
  document.getElementById('tab-admin').onclick = () => switchNotificationTab('admin');
  document.getElementById('tab-system').onclick = () => switchNotificationTab('system');
  renderNotificationCenterList('friend');
  unreadNotificationCount = 0;
  updateNotificationRedDot();
}

// tab切换
function switchNotificationTab(tab) {
  document.querySelectorAll('.notification-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (tab === 'friend') document.getElementById('tab-friend').classList.add('active');
  if (tab === 'admin') document.getElementById('tab-admin').classList.add('active');
  if (tab === 'system') document.getElementById('tab-system').classList.add('active');
  renderNotificationCenterList(tab);
}

// 渲染通知中心内容
function renderNotificationCenterList(tab = 'friend') {
  const container = document.getElementById('notification-list-container');
  if (!container) return;
  if (tab === 'friend') {
    // 好友申请
    if (!friendRequests.length) {
      container.innerHTML = `<div style="color:#aaa;text-align:center;">暂无好友申请</div>`;
      return;
    }
    container.innerHTML = `<ul style="list-style:none;padding:0;margin:0;">` +
      friendRequests.map(req => `
        <li style="margin-bottom:0.7em;">
          <span>${escapeHtml(req.from_username)} (ID:${req.from_user_id})</span>
          <button class="add-friend-btn" style="margin-left:1em;" onclick="respondFriendRequest(${req.id},'accept',this)">同意</button>
          <button class="add-friend-btn" style="background:#bbb;margin-left:0.5em;" onclick="respondFriendRequest(${req.id},'decline',this)">拒绝</button>
        </li>
      `).join('') +
      `</ul>`;
  } else if (tab === 'admin') {
    // 后台审核（仅管理员及以上可见）
    if (!currentUser || !(currentUser.is_admin || currentUser.is_super_admin || currentUser.id === 1)) {
      container.innerHTML = `<div style="color:#aaa;text-align:center;">无权限</div>`;
      return;
    }
    if (!adminPendingUsers.length) {
      container.innerHTML = `<div style="color:#aaa;text-align:center;">暂无待审核用户</div>`;
      return;
    }
    container.innerHTML = `<ul style="list-style:none;padding:0;margin:0;">` +
      adminPendingUsers.map(u => `
        <li style="margin-bottom:0.7em;">
          <span>
            <strong>${escapeHtml(u.username)}</strong>
            <span style="color:#aaa;font-size:0.9em;">（ID:${u.id}，注册于${new Date(u.created_at).toLocaleString()}）</span>
          </span>
          <button class="approve-btn" data-id="${u.id}">通过</button>
        </li>
      `).join('') +
      `</ul>`;
    // 绑定审核按钮
    container.querySelectorAll('.approve-btn').forEach(btn => {
      btn.onclick = async function() {
        btn.disabled = true;
        btn.textContent = '处理中...';
        try {
          const token = await getCsrfToken();
          const res = await fetch(`${API_BASE_URL}/api/admin/approve-user`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': token,
              'Accept': 'application/json'
            },
            body: JSON.stringify({ userId: btn.dataset.id })
          });
          const data = await res.json();
          if (data.success) {
            btn.parentElement.remove();
            await loadAdminPendingUsers();
            renderNotificationCenterEntry();
            renderNotificationCenterList('admin');
          } else {
            btn.disabled = false;
            btn.textContent = '通过';
            alert(data.message || '审核失败');
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '通过';
          alert('网络错误，审核失败');
        }
      };
    });
  } else if (tab === 'system') {
    // 系统通知
    let html = `<div id="system-notification-content" style="white-space:pre-line;text-align:left;padding:0.5em 0;">${escapeHtml(systemNotification || '暂无系统通知')}</div>`;
    if (currentUser && currentUser.id === 1) {
      html += `<button id="edit-system-notification-btn" class="btn-admin" style="margin-top:1rem;">编辑系统通知</button>`;
    }
    container.innerHTML = html;
    if (currentUser && currentUser.id === 1) {
      document.getElementById('edit-system-notification-btn').onclick = showEditSystemNotificationPopup;
    }
  }
}

// =================== 系统通知编辑功能 ===================

// 加载系统通知内容
async function loadSystemNotification() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/system-notification`, {
      credentials: 'include'
    });
    const data = await res.json();
    systemNotification = data.content || '';
  } catch (e) {
    systemNotification = '';
  }
}

// 显示编辑系统通知弹窗（仅创始人）
function showEditSystemNotificationPopup() {
  let popup = document.getElementById('edit-system-notification-popup');
  if (popup) {
    popup.style.display = 'block';
    document.getElementById('system-notification-input').value = systemNotification;
    document.getElementById('system-notification-msg').textContent = '';
    return;
  }
  popup = document.createElement('div');
  popup.id = 'edit-system-notification-popup';
  popup.className = 'popup-center';
  popup.style = 'z-index:2000;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fffbe9;border-radius:12px;box-shadow:0 2px 16px rgba(194,164,105,0.18);padding:2rem 1.5rem;min-width:300px;';
  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">编辑系统通知</h3>
    <textarea id="system-notification-input" style="width:100%;height:100px;">${escapeHtml(systemNotification)}</textarea>
    <div style="margin-top:1rem;">
      <button id="save-system-notification-btn" class="btn-submit">保存</button>
      <button type="button" id="close-system-notification-btn" style="margin-left:1rem;">关闭</button>
    </div>
    <div id="system-notification-msg" style="margin-top:1rem;min-height:1.2em;"></div>
  `;
  document.body.appendChild(popup);

  document.getElementById('close-system-notification-btn').onclick = () => {
    popup.style.display = 'none';
  };

  document.getElementById('save-system-notification-btn').onclick = async () => {
    const content = document.getElementById('system-notification-input').value;
    const msgDiv = document.getElementById('system-notification-msg');
    msgDiv.textContent = '保存中...';
    msgDiv.style.color = '#333';
    try {
      const res = await makeAuthenticatedRequest(
        `${API_BASE_URL}/api/system-notification`,
        'POST',
        { content }
      );
      if (res.success) {
        msgDiv.textContent = '保存成功';
        msgDiv.style.color = 'green';
        await loadSystemNotification();
        renderNotificationCenterList('system');
        setTimeout(() => {
          popup.style.display = 'none';
        }, 800);
      } else {
        msgDiv.textContent = res.message || '保存失败';
        msgDiv.style.color = 'red';
      }
    } catch (err) {
      msgDiv.textContent = err.message || '保存失败';
      msgDiv.style.color = 'red';
    }
  };
}

// =================== END 通知中心 ===================

// 聊天切换UI渲染
function renderChatSwitch() {
  const chatSwitch = document.getElementById('chat-switch');
  if (!currentUser) {
    chatSwitch.innerHTML = '';
    return;
  }
  let html = `<button class="chat-switch-btn" data-type="public" data-id="0" ${currentChatType === 'public' ? 'disabled' : ''}>
    公聊
    <span class="red-dot" id="chat-red-dot-0" style="display:none;margin-left:2px;"></span>
  </button>`;
  if (Array.isArray(friendsList) && friendsList.length > 0) {
    html += ' <span style="margin:0 0.5em;color:#aaa;">|</span> ';
    html += friendsList.map(f =>
      `<button class="chat-switch-btn" data-type="private" data-id="${f.id}" ${currentChatType === 'private' && Number(currentTargetId) === f.id ? 'disabled' : ''}>
        与 ${escapeHtml(f.username)} 私聊
        <span class="red-dot" id="chat-red-dot-${f.id}" style="display:none;margin-left:2px;"></span>
      </button>`
    ).join(' ');
  }
  chatSwitch.innerHTML = html;
  // 绑定事件
  chatSwitch.querySelectorAll('.chat-switch-btn').forEach(btn => {
    btn.onclick = () => {
      switchChat(btn.dataset.type, btn.dataset.id);
    };
  });
  updateChatRedDots();
}

// 聊天未读红点（结合后端未读消息数）
function updateChatRedDots() {
  // 公聊红点
  const publicDot = document.getElementById('chat-red-dot-0');
  if (publicDot) publicDot.style.display = (unreadChat['public'] > 0) ? 'inline-block' : 'none';
  // 私聊红点
  friendsList.forEach(f => {
    const count = unreadChat[`private_${f.id}`] || 0;
    const dot = document.getElementById(`chat-red-dot-${f.id}`);
    if (dot) dot.style.display = count > 0 ? 'inline-block' : 'none';
  });
}

// 获取所有未读消息数
async function loadUnreadChat() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat/unread`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      unreadChat = data.unread || {};
      updateChatRedDots();
    }
  } catch (e) {
    unreadChat = {};
    updateChatRedDots();
  }
}

// 切换聊天对象
async function switchChat(type, targetId) {
  currentChatType = type;
  currentTargetId = Number(targetId);
  chatHistoryLoaded = false;
  earliestMsgId = null;
  displayedMsgIds.clear(); // 清空已显示消息ID，防止切换后去重失效
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('load-more-msg').style.display = 'none';
  await markChatAsRead(type, targetId);
  loadChatHistory();
  renderChatSwitch();
}

// 标记会话为已读
async function markChatAsRead(targetType, targetId) {
  try {
    await fetch(`${API_BASE_URL}/api/chat/read`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() },
      body: JSON.stringify({ targetType, targetId })
    });
    await loadUnreadChat();
  } catch (e) {
    // 忽略
  }
}

// 加载聊天历史消息
async function loadChatHistory(beforeId = null) {
  if (!currentUser) return;
  let url = `${API_BASE_URL}/api/chat/messages?targetType=${currentChatType}&limit=30`;
  if (currentChatType === 'private') url += `&targetId=${currentTargetId}`;
  if (beforeId) url += `&beforeId=${beforeId}`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (data.success && Array.isArray(data.messages)) {
      if (data.messages.length > 0) {
        earliestMsgId = data.messages[0].id;
        if (beforeId) {
          data.messages.reverse().forEach(msg => appendMessage(msg, true));
        } else {
          data.messages.forEach(msg => appendMessage(msg, false));
        }
        document.getElementById('load-more-msg').style.display = data.messages.length === 30 ? 'block' : 'none';
      } else {
        if (!beforeId) {
          document.getElementById('chat-messages').innerHTML = '<div style="color:#aaa;text-align:center;">暂无消息</div>';
        }
        document.getElementById('load-more-msg').style.display = 'none';
      }
      chatHistoryLoaded = true;
    }
  } catch (err) {
    // ignore
  }
}

// 聊天消息渲染（带去重）
function appendMessage(msg, prepend = false) {
  // 消息唯一ID建议用 msg.id 或 msg.msgId
  const msgId = msg.id || msg.msgId || (msg.sender_id + '_' + (msg.created_at || msg.time));
  if (displayedMsgIds.has(msgId)) return;
  displayedMsgIds.add(msgId);

  const chatMessages = document.getElementById('chat-messages');
  const user = {
    id: msg.sender_id || msg.id,
    is_admin: msg.is_admin,
    is_super_admin: msg.is_super_admin
  };
  const badge = getBadge(user);
  const div = document.createElement('div');
  div.innerHTML = `<strong>${escapeHtml(msg.username)} (ID:${user.id})</strong> ${badge} <span style="color:#aaa;font-size:0.8em;">${new Date(msg.created_at || msg.time).toLocaleTimeString()}</span>: ${escapeHtml(msg.content || msg.message)}`;
  if (prepend) {
    chatMessages.insertBefore(div, chatMessages.firstChild);
  } else {
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// “加载更多”按钮事件
document.getElementById('load-more-msg').onclick = function() {
  if (earliestMsgId) {
    loadChatHistory(earliestMsgId);
  }
};

// =================== 后台管理弹窗相关 ===================

// 已合并到通知中心，无需单独入口

// =================== 好友申请相关 ===================

// 已合并到通知中心，无需单独入口

// 加载收到的好友申请
async function loadFriendRequests() {
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/friends/requests?type=received`, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': token }
    });
    const data = await res.json();
    if (data.success) {
      friendRequests = data.requests || [];
    } else {
      friendRequests = [];
    }
  } catch (err) {
    friendRequests = [];
  }
}

// 加载待审核用户
async function loadAdminPendingUsers() {
  if (!currentUser || !(currentUser.is_admin || currentUser.is_super_admin || currentUser.id === 1)) {
    adminPendingUsers = [];
    return;
  }
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/admin/pending-users`, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': token, 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      adminPendingUsers = data.users || [];
    } else {
      adminPendingUsers = [];
    }
  } catch (err) {
    adminPendingUsers = [];
  }
}

// 响应好友申请
window.respondFriendRequest = async function(requestId, action, btn) {
  btn.disabled = true;
  btn.textContent = action === 'accept' ? '同意中...' : '拒绝中...';
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/friends/respond`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ requestId, action })
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = action === 'accept' ? '已同意' : '已拒绝';
      await loadFriendRequests();
      renderNotificationCenterEntry();
      renderNotificationCenterList('friend');
      await loadFriends();
      renderChatSwitch();
    } else {
      btn.textContent = action === 'accept' ? '同意' : '拒绝';
      btn.disabled = false;
      alert(data.message || '操作失败');
    }
  } catch (err) {
    btn.textContent = action === 'accept' ? '同意' : '拒绝';
    btn.disabled = false;
    alert('网络错误');
  }
};

// =================== 添加好友按钮逻辑 ===================

// 发送好友申请
window.sendFriendRequest = async function(toUserId, btn) {
  btn.disabled = true;
  btn.textContent = '申请中...';
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      credentials: 'include',
      body: JSON.stringify({ toUserId })
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = '等待同意';
      btn.disabled = true;
    } else {
      btn.textContent = '添加好友';
      btn.disabled = false;
      alert(data.message || '申请失败');
    }
  } catch (err) {
    btn.textContent = '添加好友';
    btn.disabled = false;
    alert('网络错误');
  }
};

// 聊天窗口显示/隐藏
function updateChatVisibility(isLoggedIn, user) {
  if (isLoggedIn) {
    chatBox.style.display = 'block';
    if (!socket) connectChat();
  } else {
    chatBox.style.display = 'none';
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    document.getElementById('chat-messages').innerHTML = '';
  }
}

// 连接Socket.IO并处理消息（防止重复连接）
function connectChat() {
  if (socket) return; // 防止重复连接
  if (typeof io !== 'function') {
    return;
  }
  socket = io(API_BASE_URL, { withCredentials: true });

  socket.on('connect', () => {});

  socket.on('chat message', (data) => {
    if (
      data.targetType === currentChatType &&
      (currentChatType === 'public' || Number(data.targetId) === Number(currentTargetId))
    ) {
      appendMessage(data, false);
      // 收到消息后刷新未读数
      loadUnreadChat();
    }
  });

  socket.on('disconnect', () => {});
}

// 发送消息
document.addEventListener('submit', function(e) {
  if (e.target && e.target.id === 'chat-form') {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (input.value.trim() && socket) {
      socket.emit('chat message', {
        message: input.value.trim(),
        targetType: currentChatType,
        targetId: currentTargetId
      });
      input.value = '';
    }
  }
});

// 登录功能
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('login-message');

  // 实时校验
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
    showMessage(messageElement, '用户名格式不正确（3-16位字母、数字或下划线）', 'red');
    return;
  }
  if (password.length < 8) {
    showMessage(messageElement, '密码至少8位', 'red');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = '登录中...';

  try {
    const data = await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/login`,
      'POST',
      { username, password }
    );
    if (data.success) {
      showMessage(messageElement, '登录成功', 'green');
      setTimeout(() => window.location.reload(), 500);
      return;
    } else {
      const errorMsg = data.message || '未知错误';
      showMessage(messageElement, `登录失败: ${errorMsg}`, 'red');
    }
  } catch (err) {
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败，请检查网络' 
      : err.message.includes('无效的CSRF令牌')
        ? '会话已过期，请刷新页面重试'
        : err.message;
    showMessage(messageElement, `登录错误: ${errorMsg}`, 'red');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '登录';
  }
});

// 退出登录
document.getElementById('logout-btn').addEventListener('click', async () => {
  const button = document.getElementById('logout-btn');
  button.disabled = true;
  button.textContent = '退出中...';

  try {
    await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/logout`,
      'POST',
      {}
    );
    window.location.reload();
  } catch (err) {
    showMessage(document.getElementById('login-message'), `退出登录失败: ${err.message}`, 'red');
  } finally {
    button.disabled = false;
    button.textContent = '退出登录';
  }
});

// 注册功能
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('register-message');

  // 实时校验
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
    showMessage(messageElement, '用户名格式不正确（3-16位字母、数字或下划线）', 'red');
    return;
  }
  if (password.length < 8) {
    showMessage(messageElement, '密码至少需要8个字符', 'red');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = '注册中...';

  try {
    const data = await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/register`,
      'POST',
      { username, password }
    );
    if (data.success) {
      showMessage(messageElement, '注册成功，请等待管理员或超管审核通过后再登录', 'green');
      setTimeout(() => {
        window.location.href = 'members.html';
      }, 1200);
    } else {
      const errorMsg = data.message || '未知错误';
      showMessage(messageElement, `注册失败: ${errorMsg}`, 'red');
    }
  } catch (err) {
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败' 
      : err.message;
    showMessage(messageElement, `注册错误: ${errorMsg}`, 'red');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '注册';
  }
});

// 切换登录/注册表单
document.getElementById('show-register').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('login-form').reset();
  document.getElementById('login-message').textContent = '';
  registerForm.style.display = 'block';
});

document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.style.display = 'none';
  document.getElementById('register-form').reset();
  document.getElementById('register-message').textContent = '';
  document.getElementById('login-container').style.display = 'block';
});

// =================== 修改密码功能 ===================

// 显示修改密码弹窗
function showChangePasswordPopup() {
  let popup = document.getElementById('change-password-popup');
  if (popup) {
    popup.style.display = 'block';
    return;
  }
  popup = document.createElement('div');
  popup.id = 'change-password-popup';
  popup.className = 'popup-center';
  popup.style = 'z-index:2000;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fffbe9;border-radius:12px;box-shadow:0 2px 16px rgba(194,164,105,0.18);padding:2rem 1.5rem;min-width:300px;';
  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">修改密码</h3>
    <form id="change-password-form">
      <div class="form-group">
        <label>原密码</label>
        <input type="password" id="old-password" required autocomplete="current-password">
      </div>
      <div class="form-group">
        <label>新密码（至少8位）</label>
        <input type="password" id="new-password" required autocomplete="new-password">
      </div>
      <button type="submit" class="btn-submit">提交</button>
      <button type="button" id="close-change-password" style="margin-left:1rem;">关闭</button>
      <div id="change-password-msg" style="margin-top:1rem;min-height:1.2em;"></div>
    </form>
  `;
  document.body.appendChild(popup);

  document.getElementById('close-change-password').onclick = () => {
    popup.style.display = 'none';
  };

  document.getElementById('change-password-form').onsubmit = async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById('old-password').value.trim();
    const newPassword = document.getElementById('new-password').value.trim();
    const msgDiv = document.getElementById('change-password-msg');
    msgDiv.textContent = '提交中...';
    msgDiv.style.color = '#333';
    if (!oldPassword || !newPassword) {
      msgDiv.textContent = '请填写完整';
      msgDiv.style.color = 'red';
      return;
    }
    if (newPassword.length < 8) {
      msgDiv.textContent = '新密码至少8位';
      msgDiv.style.color = 'red';
      return;
    }
    try {
      const res = await makeAuthenticatedRequest(
        `${API_BASE_URL}/api/change-password`,
        'POST',
        { oldPassword, newPassword }
      );
      if (res.success) {
        msgDiv.textContent = '修改成功，请重新登录';
        msgDiv.style.color = 'green';
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        msgDiv.textContent = res.message || '修改失败';
        msgDiv.style.color = 'red';
      }
    } catch (err) {
      msgDiv.textContent = err.message || '修改失败';
      msgDiv.style.color = 'red';
    }
  };
}

// 绑定“修改密码”链接事件
document.addEventListener('DOMContentLoaded', () => {
  const changePwdLink = document.getElementById('show-change-password');
  if (changePwdLink) {
    changePwdLink.onclick = function(e) {
      e.preventDefault();
      showChangePasswordPopup();
    };
  }
});

// =================== END 修改密码功能 ===================

// 通用请求函数
async function makeAuthenticatedRequest(url, method, body) {
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount < maxRetries) {
    try {
      const token = await getCsrfToken();
      if (!token) throw new Error('无法获取有效的CSRF令牌');
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Accept': 'application/json'
        },
        body: JSON.stringify(body),
        credentials: 'include'
      });

      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.message === '无效的CSRF令牌') {
          // 清空token重试
          retryCount++;
          continue;
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || `请求失败: ${response.status}`;
        throw new Error(errorMsg);
      }

      const responseData = await response.json();
      return responseData;
    } catch (err) {
      if (err.message.includes('Failed to fetch') && retryCount < maxRetries - 1) {
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`请求失败，已重试 ${maxRetries} 次`);
}

// 显示消息的辅助函数
function showMessage(element, text, color) {
  if (!element) return;
  element.textContent = text;
  element.style.color = color;
}

// =================== 首页内容编辑功能 ===================

function showEditHomeContentPanel() {
  if (document.getElementById('edit-home-content-panel')) return;
  let editBtn = document.getElementById('edit-home-content-btn');
  if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.id = 'edit-home-content-btn';
    editBtn.textContent = '编辑首页内容';
    editBtn.style = 'position:fixed;top:10px;right:10px;z-index:9999;background:#c2a469;color:#fff;border:none;padding:0.7rem 1.2rem;border-radius:8px;box-shadow:0 2px 8px rgba(194,164,105,0.12);cursor:pointer;font-size:1rem;';
    document.body.appendChild(editBtn);
  }
  editBtn.onclick = async () => {
    let panel = document.getElementById('edit-home-content-panel');
    if (panel) {
      panel.style.display = 'block';
      return;
    }
    let aboutContent = '';
    let announcementContent = '';
    try {
      const res = await fetch(`${API_BASE_URL}/api/site-content`, {
        credentials: 'include'
      });
      const data = await res.json();
      aboutContent = data.content?.about || '';
      announcementContent = data.content?.announcement || '';
    } catch (err) {
      aboutContent = '';
      announcementContent = '';
    }
    panel = document.createElement('div');
    panel.id = 'edit-home-content-panel';
    panel.style = 'position:fixed;top:60px;right:10px;width:350px;max-width:95vw;background:#fffbe9;border-radius:12px;box-shadow:0 2px 16px rgba(194,164,105,0.18);padding:1.2rem 1rem;z-index:9999;';
    panel.innerHTML = `
      <h3 style="color:#c2a469;text-align:center;">编辑首页内容</h3>
      <form id="edit-home-content-form">
        <label style="font-weight:bold;">About Section：</label>
        <textarea id="edit-about" rows="5" style="width:100%;margin-bottom:1rem;border-radius:8px;border:1px solid #e0d3b8;padding:0.5rem;">${aboutContent}</textarea>
        <label style="font-weight:bold;">Announcement Section：</label>
        <textarea id="edit-announcement" rows="7" style="width:100%;margin-bottom:1rem;border-radius:8px;border:1px solid #e0d3b8;padding:0.5rem;">${announcementContent}</textarea>
        <div style="display:flex;justify-content:space-between;">
          <button type="submit" style="background:#c2a469;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">保存</button>
          <button type="button" id="close-edit-home-content" style="background:#aaa;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">关闭</button>
        </div>
        <div id="edit-home-content-msg" style="margin-top:0.7rem;min-height:1.2em;font-size:1rem;text-align:center;"></div>
      </form>
    `;
    document.body.appendChild(panel);

    document.getElementById('close-edit-home-content').onclick = () => {
      panel.style.display = 'none';
    };

    document.getElementById('edit-home-content-form').onsubmit = async (e) => {
      e.preventDefault();
      const about = document.getElementById('edit-about').value;
      const announcement = document.getElementById('edit-announcement').value;
      const msgDiv = document.getElementById('edit-home-content-msg');
      msgDiv.textContent = '保存中...';
      msgDiv.style.color = '#333';
      try {
        const res1 = await makeAuthenticatedRequest(
          `${API_BASE_URL}/api/site-content`,
          'POST',
          { key: 'about', value: about }
        );
        const res2 = await makeAuthenticatedRequest(
          `${API_BASE_URL}/api/site-content`,
          'POST',
          { key: 'announcement', value: announcement }
        );
        if (res1.success && res2.success) {
          msgDiv.textContent = '保存成功';
          msgDiv.style.color = 'green';
          updateHomeSections();
        } else {
          msgDiv.textContent = (res1.message || res2.message || '保存失败');
          msgDiv.style.color = 'red';
        }
      } catch (err) {
        msgDiv.textContent = err.message || '保存失败';
        msgDiv.style.color = 'red';
      }
    };
  };
}

function removeEditHomeContentPanel() {
  const panel = document.getElementById('edit-home-content-panel');
  if (panel) panel.remove();
  const btn = document.getElementById('edit-home-content-btn');
  if (btn) btn.remove();
}

// 对首页内容进行XSS转义后再渲染，并支持换行
async function updateHomeSections() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/site-content`, {
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      if (document.getElementById('about-section')) {
        document.getElementById('about-section').innerHTML = escapeHtml(data.content.about || '').replace(/\n/g, '<br>');
      }
      if (document.getElementById('announcement-section')) {
        document.getElementById('announcement-section').innerHTML = escapeHtml(data.content.announcement || '').replace(/\n/g, '<br>');
      }
    }
  } catch (err) {
    // 忽略
  }
}

// 页面初始化 - 增强版
document.addEventListener('DOMContentLoaded', async () => {
  console.log('页面初始化开始...');
  try {
    // 先尝试获取CSRF令牌
    const token = await getCsrfToken();
    
    if (token) {
      console.log('CSRF令牌获取成功，检查认证状态');
      await checkAuth();
    } else {
      console.warn('无法获取CSRF令牌，部分功能可能受限');
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
    }
    if (document.getElementById('about-section') || document.getElementById('announcement-section')) {
      updateHomeSections();
    }
    // 新增：加载系统通知
    await loadSystemNotification();
  } catch (err) {
    console.error('初始化过程中出错:', err);
    const messageElement = document.getElementById('login-message') || 
                          document.getElementById('register-message');
    if (messageElement) {
      const errorMsg = err.message.includes('Failed to fetch') 
        ? '无法连接服务器，请检查网络' 
        : '初始化失败，请刷新页面重试';
      showMessage(messageElement, errorMsg, 'red');
    }
    updateChatVisibility(false);
    removeEditHomeContentPanel();
  } finally {
    console.log('页面初始化完成');
  }
});

// 检查登录状态
async function checkAuth() {
  try {
    const token = await getCsrfToken();
    if (!token) {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      renderNotificationCenterEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
      return;
    }
    const response = await fetch(`${API_BASE_URL}/api/user`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': token,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      renderNotificationCenterEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
      return;
    }
    const data = await response.json();
    if (data.isAuthenticated) {
      currentUser = data.user;
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
      document.getElementById('register-link-row').style.display = 'none';
      updateChatVisibility(true, data.user);
      if (data.user.is_admin) {
        showEditHomeContentPanel();
      } else {
        removeEditHomeContentPanel();
      }
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      await loadFriends();
      await loadFriendRequests();
      await loadAdminPendingUsers();
      await loadSystemNotification();
      renderNotificationCenterEntry();
      renderChatSwitch();
      switchChat('public', 0);
    } else {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      renderNotificationCenterEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
    }
  } catch (err) {
    updateChatVisibility(false);
    removeEditHomeContentPanel();
    if (document.getElementById('admin-link')) {
      document.getElementById('admin-link').innerHTML = '';
    }
    renderNotificationCenterEntry();
    document.getElementById('register-link-row').style.display = '';
    document.getElementById('user-info').style.display = 'none';
  }
}

// 加载好友列表
async function loadFriends() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/friends`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      friendsList = data.friends || [];
    } else {
      friendsList = [];
    }
  } catch (err) {
    friendsList = [];
  }
}

// =================== END 首页内容编辑功能 ===================

// 页面初始化 - 精简版
document.addEventListener('DOMContentLoaded', async () => {
  console.log('页面初始化开始...');
  try {
    // 先尝试获取CSRF令牌
    const token = await getCsrfToken();
    if (token) {
      console.log('CSRF令牌获取成功，检查认证状态');
      await checkAuth();
    } else {
      console.warn('无法获取CSRF令牌，部分功能可能受限');
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
    }
  } catch (err) {
    console.error('初始化过程中出错:', err);
    const messageElement = document.getElementById('login-message') || 
                          document.getElementById('register-message');
    if (messageElement) {
      const errorMsg = err.message.includes('Failed to fetch') 
        ? '无法连接服务器，请检查网络' 
        : '初始化失败，请刷新页面重试';
      showMessage(messageElement, errorMsg, 'red');
    }
    updateChatVisibility(false);
    removeEditHomeContentPanel();
  } finally {
    console.log('页面初始化完成');
  }
});