// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';
let csrfToken = '';
let isFetchingToken = false;
let tokenQueue = [];

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
    </div>
    <div id="login-message"></div>
    <p>还没有账号? <a href="#" id="show-register">注册</a></p>
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
    <div id="chat-messages" style="height:400px;overflow-y:auto;border:1px solid #eee;padding:1rem;margin-bottom:1rem;background:#faf8f4;"></div>
    <form id="chat-form" style="display:flex;gap:0.5rem;">
      <input id="chat-input" autocomplete="off" placeholder="输入消息..." style="flex:1;padding:0.5rem;border-radius:8px;border:1px solid #ddd;">
      <button type="submit" style="background:#c2a469;color:white;border:none;padding:0.5rem 1rem;border-radius:8px;">发送</button>
    </form>
  </div>
`;
document.body.appendChild(chatBox);

let socket = null;

// 检查登录状态
async function checkAuth() {
  try {
    const token = await getCsrfToken();
    if (!token) {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
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
      return;
    }
    const data = await response.json();
    if (data.isAuthenticated) {
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
      updateChatVisibility(true, data.user);
      if (data.user.is_admin) {
        showEditHomeContentPanel();
      } else {
        removeEditHomeContentPanel();
      }
    } else {
      updateChatVisibility(false);
      removeEditHomeContentPanel();
    }
  } catch (err) {
    updateChatVisibility(false);
    removeEditHomeContentPanel();
  }
}

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
    const msgDiv = document.createElement('div');
    const badge = getBadge(data);
    msgDiv.innerHTML = `<strong>${escapeHtml(data.username)} (ID:${data.id})</strong> ${badge} <span style="color:#aaa;font-size:0.8em;">${new Date(data.time).toLocaleTimeString()}</span>: ${escapeHtml(data.message)}`;
    document.getElementById('chat-messages').appendChild(msgDiv);
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
  });

  socket.on('disconnect', () => {});
}

// 发送消息
document.addEventListener('submit', function(e) {
  if (e.target && e.target.id === 'chat-form') {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (input.value.trim() && socket) {
      socket.emit('chat message', input.value.trim());
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
      // 登录成功后强制刷新页面，确保 session/cookie/UI 状态同步
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
      showMessage(messageElement, '注册成功，正在跳转...', 'green');
      setTimeout(() => {
        window.location.href = 'members.html';
      }, 1000);
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
    }
    // 首页内容渲染时做XSS转义
    if (document.getElementById('about-section') || document.getElementById('announcement-section')) {
      updateHomeSections();
    }
  } catch (err) {
    console.error('初始化过程中出错:', err);
    
    // 显示用户友好的错误信息
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