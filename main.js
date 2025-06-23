// 引入 utils.js（确保在 HTML 中 <script src="utils.js"></script> 在 main.js 之前引入）
// 新增：引入 zxcvbn 密码强度库
// <script src="https://cdn.jsdelivr.net/npm/zxcvbn@4.4.2/dist/zxcvbn.js"></script> 建议在 HTML 中引入

const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';

let socket = null;
let currentChatType = 'public';
let currentTargetId = 0;
let chatHistoryLoaded = false;
let earliestMsgId = null;
let friendsList = [];
let currentUser = null;
let displayedMsgIds = new Set();
let friendRequests = [];
let adminPendingUsers = [];
let notifications = [];
let unreadNotificationCount = 0;
let systemNotification = '';
let unreadChat = {};

// ========== 动态参数快照加载（前端自适应/热更新） ==========
window.dynamicParams = {};
(async function loadDynamicParams() {
  if (window.fetchDynamicParams) {
    window.dynamicParams = await window.fetchDynamicParams();
  }
})();

// ========== 分形维度与递归熵自适应分页/信息展示 ==========
// 新增：自适应信息面板渲染（如成员列表、聊天窗口等）
function renderAdaptiveInfoPanel(arr, panelId = "adaptive-info-panel") {
  if (!Array.isArray(arr) || arr.length < 2) return;
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const entropyVal = typeof entropy === "function" ? entropy(arr) : 0;
  const varianceVal = typeof variance === "function" ? variance(arr) : 0;
  const Df = typeof boxCountingDimension === "function" ? boxCountingDimension(arr) : 1;
  // 递归熵自适应分页粒度
  const pageSize = typeof recursiveNcrit === "function"
    ? recursiveNcrit(arr, entropy, 5, 2, Df)
    : 20;
  panel.innerHTML = `
    <strong>自适应参数：</strong>
    分形维度 D<sub>f</sub> = ${Df.toFixed(2)}，
    熵 H = ${entropyVal.toFixed(2)}，
    方差 = ${varianceVal.toFixed(2)}，
    推荐分页粒度 N<sub>crit</sub> = ${pageSize}
  `;
  panel.style.display = "block";
}

// ========== 密码强度检测工具 ==========
function showPasswordStrength(password, container) {
  if (typeof zxcvbn !== "function") return;
  const result = zxcvbn(password);
  let text = "";
  let color = "";
  switch (result.score) {
    case 0:
      text = "极弱";
      color = "red";
      break;
    case 1:
      text = "弱";
      color = "orangered";
      break;
    case 2:
      text = "中";
      color = "orange";
      break;
    case 3:
      text = "强";
      color = "green";
      break;
    case 4:
      text = "极强";
      color = "darkgreen";
      break;
    default:
      text = "";
      color = "";
  }
  container.textContent = text;
  container.style.color = color;
}

// ========== 聊天窗口HTML ==========
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
    <!-- 新增：自适应信息面板 -->
    <div id="adaptive-info-panel" class="adaptive-info-panel" style="display:none;margin-top:1rem;"></div>
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

// 显示通知中心弹窗（修正：弹窗显示前先加载数据）
async function showNotificationCenterPopup() {
  // 弹窗显示前先加载数据
  await Promise.all([
    loadFriendRequests(),
    loadAdminPendingUsers(),
    loadSystemNotification()
  ]);
  let popup = document.getElementById('notification-center-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'notification-center-popup';
    popup.className = 'friend-request-popup';
    popup.style = 'position:fixed;top:16%;left:50%;transform:translate(-50%,0);background:#fffbe9;border-radius:12px;box-shadow:0 2px 12px rgba(194,164,105,0.12);padding:2rem 1.5rem;z-index:1000;min-width:340px;max-width:95vw;';
    document.body.appendChild(popup);
  }
  popup.style.display = 'block';

  // ====== 修改点：根据权限动态渲染Tab按钮 ======
  let adminTabHtml = '';
  if (currentUser && (currentUser.is_admin || currentUser.is_super_admin || currentUser.id === 1)) {
    adminTabHtml = `<button id="tab-admin" class="notification-tab-btn">后台审核</button>`;
  }

  popup.innerHTML = `
    <h3 style="color:#c2a469;text-align:center;">消息中心</h3>
    <div id="notification-tabs" style="display:flex;justify-content:center;gap:1.5rem;margin-bottom:1rem;">
      <button id="tab-friend" class="notification-tab-btn active">好友申请</button>
      ${adminTabHtml}
      <button id="tab-system" class="notification-tab-btn">系统通知</button>
    </div>
    <div id="notification-list-container"></div>
    <button id="close-notification-center-popup" style="margin-top:1rem;background:#aaa;color:#fff;border:none;padding:0.5rem 1.2rem;border-radius:8px;cursor:pointer;">关闭</button>
  `;
  document.getElementById('close-notification-center-popup').onclick = () => {
    popup.style.display = 'none';
  };
  // tab切换
  document.getElementById('tab-friend').onclick = () => switchNotificationTab('friend');
  if (adminTabHtml) {
    document.getElementById('tab-admin').onclick = () => switchNotificationTab('admin');
  }
  document.getElementById('tab-system').onclick = () => switchNotificationTab('system');
  renderNotificationCenterList('friend');
  unreadNotificationCount = 0;
  updateNotificationRedDot();
}

// tab切换
function switchNotificationTab(tab) {
  document.querySelectorAll('.notification-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (tab === 'friend') document.getElementById('tab-friend').classList.add('active');
  if (tab === 'admin' && document.getElementById('tab-admin')) document.getElementById('tab-admin').classList.add('active');
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
    let html = `<div id="system-notification-content" class="system-notification" style="white-space:pre-line;text-align:left;padding:0.5em 0;">${escapeHtml(systemNotification || '暂无系统通知')}</div>`;
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
      // 临界阻尼动画切换Tab
      smoothDampedAnimate(chatBox, 'opacity', 0, { duration: 120 });
      setTimeout(() => {
        switchChat(btn.dataset.type, btn.dataset.id);
        smoothDampedAnimate(chatBox, 'opacity', 1, { duration: 180 });
      }, 120);
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
  displayedMsgIds.clear(); // 切换会话时清空已显示消息ID
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

// 聊天消息渲染（带@高亮）
function appendMessage(msg, prepend = false) {
  // 修正：兼容后端推送的msgId/id
  const msgId = msg.msgId || msg.id || (msg.sender_id + '_' + (msg.created_at || msg.time));
  if (displayedMsgIds.has(msgId)) return;
  displayedMsgIds.add(msgId);

  const chatMessages = document.getElementById('chat-messages');
  const user = {
    id: msg.sender_id || msg.senderId || msg.id, // 兼容 senderId
    is_admin: msg.is_admin,
    is_super_admin: msg.is_super_admin
  };
  const badge = getBadge(user);
  // 富文本安全过滤
  let content = sanitizeHtml(msg.content || msg.message || '');
  // 图片消息支持
  content = content.replace(/\[img\](https?:\/\/[^\s\[\]]+)\[\/img\]/g, '<img src="$1" alt="图片" style="max-width:120px;max-height:120px;vertical-align:middle;margin:0 4px;" loading="lazy">');
  // @高亮
  content = content.replace(/@([a-zA-Z0-9_]{3,16})/g, '<span class="mention">@$1</span>');
  const div = document.createElement('div');
  div.innerHTML = `<strong>${escapeHtml(msg.username)} (ID:${user.id})</strong> ${badge} <span style="color:#aaa;font-size:0.8em;">${new Date(msg.created_at || msg.time).toLocaleTimeString()}</span>: ${content}`;
  if (prepend) {
    chatMessages.insertBefore(div, chatMessages.firstChild);
  } else {
    chatMessages.appendChild(div);
    smoothScrollToBottom(chatMessages);
  }
}

// 聊天历史分页（递归熵自适应分页，论文算法应用点）
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
        // 递归熵自适应分页：根据消息时间间隔的熵动态调整每页条数
        const times = data.messages.map(m => new Date(m.created_at || m.time).getTime());
        const intervals = [];
        for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
        if (intervals.length > 0) {
          const H = entropy(intervals);
          let newLimit = Math.round(10 + H * 10);
          newLimit = Math.min(Math.max(5, newLimit), 100);
          // 若与当前limit差异较大则调整
          // 这里仅做演示，实际分页参数可传递给后端
        }
        for (let i = 0; i < data.messages.length; i++) {
          const msg = data.messages[i];
          appendMessage(msg, !!beforeId);
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

// 平滑滚动到底部（临界阻尼动画）
function smoothScrollToBottom(container) {
  const start = container.scrollTop;
  const end = container.scrollHeight - container.clientHeight;
  if (Math.abs(end - start) < 2) return;
  let v = 0, x = start;
  const gamma = 0.7, omega0 = 1.5;
  function animate() {
    const dt = 1 / 60;
    const a = -gamma * v - omega0 * omega0 * (x - end);
    v += a * dt;
    x += v * dt;
    container.scrollTop = x;
    if (Math.abs(end - x) > 1) {
      requestAnimationFrame(animate);
    }
  }
  requestAnimationFrame(animate);
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
  socket = io(API_BASE_URL, { withCredentials: true, reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });

  socket.on('connect', () => {});

  // ====== 修正：让私聊消息和公聊一样即时显示 ======
  socket.on('chat message', (data) => {
    // 公聊消息
    if (
      data.targetType === 'public' &&
      currentChatType === 'public'
    ) {
      appendMessage(data, false);
      loadUnreadChat();
      return;
    }
    // 私聊消息：只要是当前会话双方的消息都应即时显示
    if (
      data.targetType === 'private' &&
      currentChatType === 'private' &&
      (
        // 自己发的，或对方发给自己
        (Number(data.senderId || data.sender_id || data.id) === Number(currentUser.id) && Number(data.targetId || data.target_id) === Number(currentTargetId)) ||
        (Number(data.senderId || data.sender_id || data.id) === Number(currentTargetId) && Number(data.targetId || data.target_id) === Number(currentUser.id))
      )
    ) {
      appendMessage(data, false);
      loadUnreadChat();
      return;
    }
    // 其他会话的消息不显示
  });

  socket.on('disconnect', () => {});
}

// 发送消息
document.addEventListener('submit', function(e) {
  if (e.target && e.target.id === 'chat-form') {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (input.value.trim() && socket) {
      // 检测@用户
      const atMatches = input.value.match(/@([a-zA-Z0-9_]{3,16})/g);
      let atUsers = [];
      if (atMatches) {
        atUsers = atMatches.map(s => s.slice(1));
      }
      socket.emit('chat message', {
        message: input.value.trim(),
        targetType: currentChatType,
        targetId: currentTargetId,
        atUsers // 新增：传递@的用户名数组
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
  // 用户名不再限制格式
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
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById("register-message");

  // 实时校验
  if (password.length < 8) {
    showMessage(messageElement, "密码至少需要8个字符", "red");
    return;
  }
  // 新增：密码强度检测
  if (typeof zxcvbn === "function") {
    const score = zxcvbn(password).score;
    if (score < 2) {
      showMessage(messageElement, "密码过于简单，请设置更强密码", "red");
      return;
    }
  }

  submitButton.disabled = true;
  submitButton.textContent = "注册中...";

  try {
    const data = await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/register`,
      "POST",
      { username, password }
    );
    if (data.success) {
      showMessage(messageElement, "注册成功，请等待管理员或超管审核通过后再登录", "green");
      setTimeout(() => {
        window.location.href = "members.html";
      }, 1200);
    } else {
      const errorMsg = data.message || "未知错误";
      showMessage(messageElement, `注册失败: ${errorMsg}`, "red");
    }
  } catch (err) {
    const errorMsg = err.message.includes("Failed to fetch")
      ? "网络连接失败"
      : err.message;
    showMessage(messageElement, `注册错误: ${errorMsg}`, "red");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "注册";
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
  let popup = document.getElementById("change-password-popup");
  if (popup) {
    popup.style.display = "block";
    bindChangePwdStrength();
    return;
  }
  popup = document.createElement("div");
  popup.id = "change-password-popup";
  popup.className = "popup-center";
  popup.style =
    "z-index:2000;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fffbe9;border-radius:12px;box-shadow:0 2px 16px rgba(194,164,105,0.18);padding:2rem 1.5rem;min-width:300px;";
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
      <div id="change-password-strength" style="margin-top:0.3em;font-size:0.95em;"></div>
      <div id="change-password-msg" style="margin-top:1rem;min-height:1.2em;"></div>
    </form>
  `;
  document.body.appendChild(popup);

  document.getElementById("close-change-password").onclick = () => {
    popup.style.display = "none";
  };

  bindChangePwdStrength();

  document.getElementById("change-password-form").onsubmit = async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById("old-password").value.trim();
    const newPassword = document.getElementById("new-password").value.trim();
    const msgDiv = document.getElementById("change-password-msg");
    msgDiv.textContent = "提交中...";
    msgDiv.style.color = "#333";
    if (!oldPassword || !newPassword) {
      msgDiv.textContent = "请填写完整";
      msgDiv.style.color = "red";
      return;
    }
    if (newPassword.length < 8) {
      msgDiv.textContent = "新密码至少8位";
      msgDiv.style.color = "red";
      return;
    }
    // 新增：密码强度检测
    if (typeof zxcvbn === "function") {
      const score = zxcvbn(newPassword).score;
      if (score < 2) {
        msgDiv.textContent = "新密码过于简单，请设置更强密码";
        msgDiv.style.color = "red";
        return;
      }
    }
    try {
      const res = await makeAuthenticatedRequest(
        `${API_BASE_URL}/api/change-password`,
        "POST",
        { oldPassword, newPassword }
      );
      if (res.success) {
        msgDiv.textContent = "修改成功，请重新登录";
        msgDiv.style.color = "green";
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        msgDiv.textContent = res.message || "修改失败";
        msgDiv.style.color = "red";
      }
    } catch (err) {
      msgDiv.textContent = err.message || "修改失败";
      msgDiv.style.color = "red";
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

// 绑定新密码输入实时检测强度（注册和修改密码）
function bindChangePwdStrength() {
  const pwdInput = document.getElementById('new-password');
  const strengthDiv = document.getElementById('change-password-strength');
  if (pwdInput && strengthDiv) {
    pwdInput.oninput = function () {
      showPasswordStrength(pwdInput.value, strengthDiv);
    };
  }
}
const regPwdInput = document.getElementById('reg-password');
const regStrengthDiv = document.createElement('div');
regStrengthDiv.id = 'register-password-strength';
regPwdInput && regPwdInput.parentNode.insertBefore(regStrengthDiv, regPwdInput.nextSibling);
if (regPwdInput && regStrengthDiv) {
  regPwdInput.oninput = function () {
    showPasswordStrength(regPwdInput.value, regStrengthDiv);
  };
}

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
    // ========== 新增：未登录时隐藏API Token管理入口 ==========
    const apiTokenLink = document.getElementById('api-token-link');
    if (apiTokenLink && !currentUser) {
      apiTokenLink.style.display = 'none';
    }
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
      // 新增：未登录时隐藏API Token管理入口
      const apiTokenLink = document.getElementById('api-token-link');
      if (apiTokenLink) apiTokenLink.style.display = 'none';
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
      // 新增：未登录时隐藏API Token管理入口
      const apiTokenLink = document.getElementById('api-token-link');
      if (apiTokenLink) apiTokenLink.style.display = 'none';
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
      // 新增：已登录时显示API Token管理入口
      const apiTokenLink = document.getElementById('api-token-link');
      if (apiTokenLink) apiTokenLink.style.display = '';
    } else {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
      if (document.getElementById('admin-link')) {
        document.getElementById('admin-link').innerHTML = '';
      }
      renderNotificationCenterEntry();
      document.getElementById('register-link-row').style.display = '';
      document.getElementById('user-info').style.display = 'none';
      // 新增：未登录时隐藏API Token管理入口
      const apiTokenLink = document.getElementById('api-token-link');
      if (apiTokenLink) apiTokenLink.style.display = 'none';
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
    // 新增：未登录时隐藏API Token管理入口
    const apiTokenLink = document.getElementById('api-token-link');
    if (apiTokenLink) apiTokenLink.style.display = 'none';
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
      // 新增：未登录时隐藏API Token管理入口
      const apiTokenLink = document.getElementById('api-token-link');
      if (apiTokenLink) apiTokenLink.style.display = 'none';
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
    // 新增：未登录时隐藏API Token管理入口
    const apiTokenLink = document.getElementById('api-token-link');
    if (apiTokenLink) apiTokenLink.style.display = 'none';
  } finally {
    console.log('页面初始化完成');
  }
});

// ========== 新增：@成员选择与图片发送功能 ==========

// 1. @成员选择弹窗
function showMentionUserList(inputElem) {
  if (!Array.isArray(friendsList) || friendsList.length === 0) return;
  let mentionBox = document.getElementById('mention-user-list');
  if (!mentionBox) {
    mentionBox = document.createElement('div');
    mentionBox.id = 'mention-user-list';
    mentionBox.style = 'position:absolute;z-index:9999;background:#fffbe9;border:1px solid #c2a469;border-radius:8px;box-shadow:0 2px 8px rgba(194,164,105,0.12);padding:0.5em;min-width:120px;';
    document.body.appendChild(mentionBox);
  }
  mentionBox.innerHTML = friendsList.map(u =>
    `<div class="mention-user-item" data-username="${u.username}" style="padding:0.3em 0.7em;cursor:pointer;">@${escapeHtml(u.username)}</div>`
  ).join('');
  // 定位
  const rect = inputElem.getBoundingClientRect();
  mentionBox.style.left = rect.left + window.scrollX + 'px';
  mentionBox.style.top = (rect.top + inputElem.offsetHeight + window.scrollY) + 'px';
  mentionBox.style.display = 'block';

  mentionBox.querySelectorAll('.mention-user-item').forEach(item => {
    item.onclick = function () {
      insertAtCursor(inputElem, '@' + this.dataset.username + ' ');
      mentionBox.style.display = 'none';
      inputElem.focus();
    };
  });
  // 点击外部关闭
  document.addEventListener('mousedown', function hideMentionBox(e) {
    if (!mentionBox.contains(e.target)) {
      mentionBox.style.display = 'none';
      document.removeEventListener('mousedown', hideMentionBox);
    }
  });
}

// 插入文本到光标处
function insertAtCursor(input, text) {
  if (document.selection) {
    input.focus();
    const sel = document.selection.createRange();
    sel.text = text;
  } else if (input.selectionStart || input.selectionStart === 0) {
    const startPos = input.selectionStart;
    const endPos = input.selectionEnd;
    input.value = input.value.substring(0, startPos) + text + input.value.substring(endPos, input.value.length);
    input.selectionStart = input.selectionEnd = startPos + text.length;
  } else {
    input.value += text;
  }
}

// 监听@触发
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keyup', function (e) {
      if (e.key === '@') {
        showMentionUserList(chatInput);
      }
    });
    chatInput.addEventListener('blur', function () {
      setTimeout(() => {
        const mentionBox = document.getElementById('mention-user-list');
        if (mentionBox) mentionBox.style.display = 'none';
      }, 200);
    });
  }
});

// 2. 图片发送功能
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chat-input');
  if (!chatInput) return;

  // 粘贴图片
  chatInput.addEventListener('paste', async function (e) {
    const items = (e.clipboardData || window.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        await uploadAndInsertImage(file, chatInput);
        e.preventDefault();
        break;
      }
    }
  });

  // 拖拽图片
  chatInput.addEventListener('drop', async function (e) {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      await uploadAndInsertImage(files[0], chatInput);
    }
  });
});

// 上传图片并插入[img]url[/img]
async function uploadAndInsertImage(file, inputElem) {
  const formData = new FormData();
  formData.append('image', file);
  try {
    const token = await getCsrfToken();
    const res = await fetch(`${API_BASE_URL}/api/upload-image`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': token },
      body: formData
    });
    const data = await res.json();
    if (data.success && data.url) {
      insertAtCursor(inputElem, `[img]${data.url}[/img] `);
    } else {
      alert(data.message || '图片上传失败');
    }
  } catch (err) {
    alert('图片上传失败');
  }
}

// ========== PWA推送注册 ==========

if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('service-worker.js').then(async reg => {
    // 注册推送订阅
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: '你的VAPID公钥' // 替换为后端提供的VAPID公钥
        });
        // 发送到后端保存
        await fetch(API_BASE_URL + '/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() },
          body: JSON.stringify({ subscription: sub })
        });
      } catch (e) {
        // 用户拒绝或浏览器不支持推送
      }
    }
  }).catch(() => {});
}