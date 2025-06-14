// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';
let csrfToken = '';
let isFetchingToken = false;
let tokenQueue = [];

// 聊天相关全局变量
let socket = null;
let currentChatType = 'public'; // 'public' or 'private'
let currentTargetId = 0; // 0: 公聊, 其他: 私聊对象ID
let chatHistoryLoaded = false;
let earliestMsgId = null;
let friendsList = [];
let currentUser = null;

// =================== 好友申请相关全局变量 ===================
let friendRequests = []; // 收到的好友申请

// =================== 后台管理弹窗相关全局变量 ===================
let adminPendingUsers = []; // 待审核用户

// 获取CSRF令牌 - 串行化，避免并发初始化session
async function getCsrfToken(retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 1000;

  if (csrfToken) return csrfToken;
  if (isFetchingToken) {
    return new Promise((resolve) => tokenQueue.push(resolve));
  }

  isFetchingToken = true;
  try {
    // 先访问 /api/user，确保 session 初始化
    await fetch(`${API_BASE_URL}/api/user`, {
      method: 'GET',
      credentials: 'include'
    });

    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      if (response.status >= 500 && retryCount < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return getCsrfToken(retryCount + 1);
      }
      throw new Error('获取CSRF令牌失败');
    }

    const data = await response.json();
    if (!data.token) throw new Error('CSRF令牌未在响应中返回');
    csrfToken = data.token;

    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(csrfToken);
    }
    return csrfToken;
  } catch (err) {
    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(null);
    }
    if (err.message.includes('Failed to fetch') && retryCount < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return getCsrfToken(retryCount + 1);
    }
    throw err;
  } finally {
    isFetchingToken = false;
  }
}

// 生成徽章HTML
function getBadge(user) {
  if (user.id === 1) {
    return `<span class="member-badge super-admin">创始人/超管</span>`;
  } else if (user.is_super_admin) {
    return `<span class="member-badge super-admin">超管</span>`;
  } else if (user.is_admin) {
    return `<span class="member-badge admin">管理员</span>`;
  } else {
    return `<span class="member-badge normal">普通成员</span>`;
  }
}

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

// 聊天窗口HTML（增加公聊/私聊切换和加载更多按钮）
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

// 聊天切换UI渲染
function renderChatSwitch() {
  const chatSwitch = document.getElementById('chat-switch');
  if (!currentUser) {
    chatSwitch.innerHTML = '';
    return;
  }
  let html = `<button class="chat-switch-btn" data-type="public" data-id="0" ${currentChatType === 'public' ? 'disabled' : ''}>公聊</button>`;
  if (Array.isArray(friendsList) && friendsList.length > 0) {
    html += ' <span style="margin:0 0.5em;color:#aaa;">|</span> ';
    html += friendsList.map(f =>
      `<button class="chat-switch-btn" data-type="private" data-id="${f.id}" ${currentChatType === 'private' && Number(currentTargetId) === f.id ? 'disabled' : ''}>与 ${escapeHtml(f.username)} 私聊</button>`
    ).join(' ');
  }
  chatSwitch.innerHTML = html;
  // 绑定事件
  chatSwitch.querySelectorAll('.chat-switch-btn').forEach(btn => {
    btn.onclick = () => {
      switchChat(btn.dataset.type, btn.dataset.id);
    };
  });
}

// 切换聊天对象
function switchChat(type, targetId) {
  currentChatType = type;
  currentTargetId = Number(targetId);
  chatHistoryLoaded = false;
  earliestMsgId = null;
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('load-more-msg').style.display = 'none';
  loadChatHistory();
  renderChatSwitch();
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
        // 修改：首次加载append到底部，加载更多prepend到顶部
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

// 聊天消息渲染
function appendMessage(msg, prepend = false) {
  const chatMessages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const badge = getBadge(msg);
  div.innerHTML = `<strong>${escapeHtml(msg.username)} (ID:${msg.sender_id || msg.id})</strong> ${badge} <span style="color:#aaa;font-size:0.8em;">${new Date(msg.created_at || msg.time).toLocaleTimeString()}</span>: ${escapeHtml(msg.content || msg.message)}`;
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

// 渲染后台管理入口按钮（插入到 admin-link 前，只有管理员及以上可见）
function renderAdminEntry() {
  let entry = document.getElementById('admin-popup-entry');
  const adminLink = document.getElementById('admin-link');
  if (!currentUser || !(currentUser.is_admin || currentUser.is_super_admin || currentUser.id === 1)) {
    if (entry) entry.remove();
    if (adminLink) adminLink.innerHTML = '';
    return;
  }
  if (!entry) {
    entry = document.createElement('button');
    entry.id = 'admin-popup-entry';
    entry.className = 'add-friend-btn';
    entry.style = 'margin-right:1rem;';
    entry.textContent = '后台管理';
    entry.onclick = showAdminPopup;
    if (adminLink && adminLink.parentNode) {
      adminLink.parentNode.insertBefore(entry, adminLink.firstChild);
    } else {
      document.body.appendChild(entry);
    }
  }
}

// 显示后台管理弹窗
function showAdminPopup() {
  let popup = document.getElementById('admin-popup');
  if (popup) {
    popup.style.display = 'block';
    loadPendingUsersInPopup();
    return;
  }
  popup = document.createElement('div');
  popup.id = 'admin-popup';
  popup.className = 'friend-request-popup';
  popup.style = 'position:fixed;top:20%;left:50%;transform:translate(-50%,0);background:#fffbe9;border-radius:12px;box-shadow:0 2px 12px rgba(194,164,105,0.12);padding:2rem 1.5rem;z-index:1000;min-width:320px;';
  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">待审核用户</h3>
    <div id="admin-popup-msg" style="text-align:center;color:#b48a3a;margin-bottom:1rem;min-height:1.2em;"></div>
    <ul id="admin-pending-list" style="list-style:none;padding:0;margin:1rem 0;"></ul>
    <button id="close-admin-popup" style="margin-top:1rem;background:#aaa;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">关闭</button>
  `;
  document.body.appendChild(popup);
  document.getElementById('close-admin-popup').onclick = () => {
    popup.style.display = 'none';
  };
  loadPendingUsersInPopup();
}

// 加载待审核用户列表
async function loadPendingUsersInPopup() {
  const msg = document.getElementById('admin-popup-msg');
  const list = document.getElementById('admin-pending-list');
  msg.textContent = '加载中...';
  list.innerHTML = '';
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/admin/pending-users`, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': token, 'Accept': 'application/json' }
    });
    if (res.status === 403) {
      msg.textContent = '无权限访问。请用管理员或超管账号登录。';
      msg.style.color = 'red';
      return;
    }
    const data = await res.json();
    if (!data.success) {
      msg.textContent = data.message || '加载失败';
      msg.style.color = 'red';
      return;
    }
    if (!data.users || data.users.length === 0) {
      msg.textContent = '暂无待审核用户';
      msg.style.color = '#888';
      return;
    }
    msg.textContent = '';
    data.users.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>
          <strong>${escapeHtml(u.username)}</strong>
          <span style="color:#aaa;font-size:0.9em;">（ID:${u.id}，注册于${new Date(u.created_at).toLocaleString()}）</span>
        </span>
        <button class="approve-btn" data-id="${u.id}">通过</button>
      `;
      list.appendChild(li);
    });
    // 绑定审核按钮
    list.querySelectorAll('.approve-btn').forEach(btn => {
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
            msg.textContent = '审核通过成功';
            msg.style.color = 'green';
            btn.parentElement.remove();
            if (list.children.length === 0) {
              msg.textContent = '暂无待审核用户';
              msg.style.color = '#888';
            }
          } else {
            msg.textContent = data.message || '审核失败';
            msg.style.color = 'red';
            btn.disabled = false;
            btn.textContent = '通过';
          }
        } catch (err) {
          msg.textContent = '网络错误，审核失败';
          msg.style.color = 'red';
          btn.disabled = false;
          btn.textContent = '通过';
        }
      };
    });
  } catch (err) {
    msg.textContent = '加载失败，请检查网络';
    msg.style.color = 'red';
  }
}

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
      renderFriendRequestEntry(); // 保证未登录时入口消失
      renderAdminEntry();
      // 未登录：只显示注册，不显示修改密码
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
      renderFriendRequestEntry();
      renderAdminEntry();
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
      // 登录：只显示修改密码，不显示注册
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
      renderAdminEntry();
      await loadFriends();
      await loadFriendRequests(); // 新增：加载好友申请
      renderFriendRequestEntry(); // 新增：渲染好友申请入口
      renderChatSwitch();
      switchChat('public', 0);
    } else {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      renderFriendRequestEntry();
      renderAdminEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
    }
  } catch (err) {
    updateChatVisibility(false);
    removeEditHomeContentPanel();
    if (document.getElementById('admin-link')) {
      document.getElementById('admin-link').innerHTML = '';
    }
    renderFriendRequestEntry();
    renderAdminEntry();
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

// =================== 好友申请相关 ===================

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

// 渲染好友申请入口按钮（插入到后台管理前，所有已登录用户可见）
function renderFriendRequestEntry() {
  let entry = document.getElementById('friend-request-entry');
  const adminLink = document.getElementById('admin-link');
  if (!currentUser) {
    if (entry) entry.remove();
    return;
  }
  if (!entry) {
    entry = document.createElement('button');
    entry.id = 'friend-request-entry';
    entry.className = 'add-friend-btn';
    entry.style = 'margin-right:1rem;';
    // 插入到 admin-link 前
    if (adminLink && adminLink.parentNode) {
      adminLink.parentNode.insertBefore(entry, adminLink);
    } else {
      document.body.appendChild(entry);
    }
  }
  entry.textContent = `好友申请${friendRequests.length > 0 ? ` (${friendRequests.length})` : ''}`;
  // 所有已登录用户都可点击
  entry.disabled = false;
  entry.onclick = showFriendRequestsPopup;
  entry.title = '';
}

// 显示好友申请弹窗
function showFriendRequestsPopup() {
  let popup = document.getElementById('friend-request-popup');
  if (popup) {
    popup.style.display = 'block';
    renderFriendRequestsList();
    return;
  }
  popup = document.createElement('div');
  popup.id = 'friend-request-popup';
  popup.className = 'friend-request-popup';
  popup.style = 'position:fixed;top:20%;left:50%;transform:translate(-50%,0);background:#fffbe9;border-radius:12px;box-shadow:0 2px 12px rgba(194,164,105,0.12);padding:2rem 1.5rem;z-index:1000;min-width:300px;';
  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">收到的好友申请</h3>
    <ul id="friend-request-list" style="list-style:none;padding:0;margin:1rem 0;"></ul>
    <button id="close-friend-request-popup" style="margin-top:1rem;background:#aaa;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">关闭</button>
  `;
  document.body.appendChild(popup);
  document.getElementById('close-friend-request-popup').onclick = () => {
    popup.style.display = 'none';
  };
  renderFriendRequestsList();
}

// 渲染好友申请列表
function renderFriendRequestsList() {
  const list = document.getElementById('friend-request-list');
  if (!list) return;
  if (!friendRequests.length) {
    list.innerHTML = `<li style="color:#aaa;text-align:center;">暂无好友申请</li>`;
    return;
  }
  list.innerHTML = friendRequests.map(req => `
    <li style="margin-bottom:0.7em;">
      <span>${escapeHtml(req.from_username)} (ID:${req.from_user_id})</span>
      <button class="add-friend-btn" style="margin-left:1em;" onclick="respondFriendRequest(${req.id},'accept',this)">同意</button>
      <button class="add-friend-btn" style="background:#bbb;margin-left:0.5em;" onclick="respondFriendRequest(${req.id},'decline',this)">拒绝</button>
    </li>
  `).join('');
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
      renderFriendRequestEntry();
      renderFriendRequestsList();
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

// 连接Socket.IO并处理消息
function connectChat() {
  if (typeof io !== 'function') {
    return;
  }
  socket = io(API_BASE_URL, { withCredentials: true });

  socket.on('connect', () => {});

  socket.on('chat message', (data) => {
    // 只显示当前窗口的消息
    if (
      data.targetType === currentChatType &&
      (currentChatType === 'public' || Number(data.targetId) === Number(currentTargetId))
    ) {
      appendMessage(data, false);
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

  if (!username || !password) {
    showMessage(messageElement, '用户名和密码不能为空', 'red');
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
    csrfToken = '';
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

  if (!username || !password) {
    showMessage(messageElement, '用户名和密码不能为空', 'red');
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
          csrfToken = '';
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

// 防止XSS的简单转义
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      renderFriendRequestEntry();
      renderAdminEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
    }
    if (document.getElementById('about-section') || document.getElementById('announcement-section')) {
      updateHomeSections();
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