// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';
let csrfToken = '';
let isFetchingToken = false;
let tokenQueue = [];

// 获取CSRF令牌 - 增强版
async function getCsrfToken(retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 1000; // 1秒重试延迟

  // 如果正在获取令牌，将请求加入队列
  if (isFetchingToken) {
    return new Promise((resolve) => {
      tokenQueue.push(resolve);
    });
  }

  isFetchingToken = true;
  console.log(`开始获取CSRF令牌 (尝试 ${retryCount + 1}/${maxRetries})...`);

  try {
    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      const errorMsg = `获取CSRF令牌失败: ${response.status} - ${errorText}`;
      console.error(errorMsg);
      
      // 如果是服务器错误且未达到最大重试次数，则重试
      if (response.status >= 500 && retryCount < maxRetries - 1) {
        console.log(`等待 ${retryDelay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return getCsrfToken(retryCount + 1);
      }
      
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    if (!data.token) {
      throw new Error('CSRF令牌未在响应中返回');
    }
    
    csrfToken = data.token;
    console.log('成功获取CSRF令牌');
    
    // 处理队列中的等待请求
    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(csrfToken);
    }
    
    return csrfToken;
  } catch (err) {
    console.error('获取CSRF令牌过程中出错:', err);
    
    // 处理队列中的等待请求
    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(null);
    }
    
    // 显示用户友好的错误信息
    const messageElement = document.getElementById('login-message') || 
                          document.getElementById('register-message');
    if (messageElement) {
      const errorMsg = err.message.includes('Failed to fetch') 
        ? '无法连接服务器，请检查网络' 
        : '服务器暂时不可用，请稍后再试';
      showMessage(messageElement, errorMsg, 'red');
    }
    
    // 如果是网络错误且未达到最大重试次数，则重试
    if (err.message.includes('Failed to fetch') && retryCount < maxRetries - 1) {
      console.log(`等待 ${retryDelay}ms 后重试...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return getCsrfToken(retryCount + 1);
    }
    
    throw err;
  } finally {
    isFetchingToken = false;
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
    <div id="chat-messages" style="height:200px;overflow-y:auto;border:1px solid #eee;padding:1rem;margin-bottom:1rem;background:#faf8f4;"></div>
    <form id="chat-form" style="display:flex;gap:0.5rem;">
      <input id="chat-input" autocomplete="off" placeholder="输入消息..." style="flex:1;padding:0.5rem;border-radius:8px;border:1px solid #ddd;">
      <button type="submit" style="background:#c2a469;color:white;border:none;padding:0.5rem 1rem;border-radius:8px;">发送</button>
    </form>
  </div>
`;
document.body.appendChild(chatBox);

let socket = null;

// 检查登录状态 - 增强版
async function checkAuth() {
  try {
    console.log('检查用户认证状态...');
    const token = await getCsrfToken();
    
    if (!token) {
      console.warn('没有有效的CSRF令牌，跳过认证检查');
      updateChatVisibility(false);
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
      // 401未授权是预期中的情况，不视为错误
      if (response.status !== 401) {
        const errorText = await response.text();
        throw new Error(`认证检查请求失败: ${response.status} - ${errorText}`);
      }
      updateChatVisibility(false);
      return;
    }
    
    const data = await response.json();
    console.log('认证状态响应:', data);
    
    if (data.isAuthenticated) {
      console.log('用户已认证:', data.user.username);
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
      updateChatVisibility(true, data.user);
      // 管理员系统入口
      if (data.user.id === 1) {
        showSuperAdminPanel(data.user);
      } else {
        removeSuperAdminPanel();
      }
    } else {
      updateChatVisibility(false);
      removeSuperAdminPanel();
    }
  } catch (err) {
    console.error('检查认证状态时出错:', err);
    updateChatVisibility(false);
    removeSuperAdminPanel();
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
  // 需确保 socket.io 客户端已加载
  if (typeof io !== 'function') {
    console.error('Socket.IO 客户端未加载');
    return;
  }
  socket = io(API_BASE_URL, { withCredentials: true });

  socket.on('connect', () => {
    console.log('已连接到聊天服务器');
  });

  socket.on('chat message', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<strong>${escapeHtml(data.username)} (ID:${data.id})</strong> <span style="color:#aaa;font-size:0.8em;">${new Date(data.time).toLocaleTimeString()}</span>: ${escapeHtml(data.message)}`;
    document.getElementById('chat-messages').appendChild(msgDiv);
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
  });

  socket.on('disconnect', () => {
    console.log('已断开聊天服务器');
  });
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

// 登录功能 - 增强版
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('login-message');

  // 输入验证
  if (!username || !password) {
    showMessage(messageElement, '用户名和密码不能为空', 'red');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = '登录中...';

  try {
    console.log('尝试登录:', username);
    const data = await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/login`,
      'POST',
      { username, password }
    );
    
    if (data.success) {
      showMessage(messageElement, '登录成功', 'green');
      console.log('登录成功:', data.user.username);
      await checkAuth();
    } else {
      const errorMsg = data.message || '未知错误';
      showMessage(messageElement, `登录失败: ${errorMsg}`, 'red');
      console.log('登录失败:', errorMsg);
    }
  } catch (err) {
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败，请检查网络' 
      : err.message.includes('无效的CSRF令牌')
        ? '会话已过期，请刷新页面重试'
        : err.message;
    showMessage(messageElement, `登录错误: ${errorMsg}`, 'red');
    console.error('登录过程中出错:', err);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '登录';
  }
});

// 退出登录 - 增强版
document.getElementById('logout-btn').addEventListener('click', async () => {
  const button = document.getElementById('logout-btn');
  button.disabled = true;
  button.textContent = '退出中...';
  console.log('尝试退出登录...');

  try {
    await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/logout`,
      'POST',
      {}
    );
    console.log('退出登录成功');
    
    // 清除本地状态
    csrfToken = '';
    document.getElementById('login-form').style.display = '';
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    
    // 显示登录表单
    registerForm.style.display = 'none';
    document.getElementById('login-container').style.display = 'block';
    
    showMessage(document.getElementById('login-message'), '您已成功退出登录', 'green');
    updateChatVisibility(false);
    removeSuperAdminPanel();
  } catch (err) {
    console.error('退出登录失败:', err);
    
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败' 
      : err.message;
    showMessage(document.getElementById('login-message'), `退出登录失败: ${errorMsg}`, 'red');
  } finally {
    button.disabled = false;
    button.textContent = '退出登录';
  }
});

// 注册功能 - 增强版
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('register-message');

  // 输入验证
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
  console.log('尝试注册:', username);

  try {
    const data = await makeAuthenticatedRequest(
      `${API_BASE_URL}/api/register`,
      'POST',
      { username, password }
    );
    
    if (data.success) {
      showMessage(messageElement, '注册成功，请登录', 'green');
      console.log('注册成功:', data.user.username);
      document.getElementById('show-login').click();
      form.reset();
    } else {
      const errorMsg = data.message || '未知错误';
      showMessage(messageElement, `注册失败: ${errorMsg}`, 'red');
      console.log('注册失败:', errorMsg);
    }
  } catch (err) {
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败' 
      : err.message;
    showMessage(messageElement, `注册错误: ${errorMsg}`, 'red');
    console.error('注册过程中出错:', err);
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
  console.log('切换到注册表单');
});

document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.style.display = 'none';
  document.getElementById('register-form').reset();
  document.getElementById('register-message').textContent = '';
  document.getElementById('login-container').style.display = 'block';
  console.log('切换到登录表单');
});

// 通用请求函数 - 增强版
async function makeAuthenticatedRequest(url, method, body) {
  let retryCount = 0;
  const maxRetries = 2;
  
  while (retryCount < maxRetries) {
    try {
      console.log(`准备请求 (尝试 ${retryCount + 1}): ${method} ${url}`);
      const token = await getCsrfToken();
      
      if (!token) {
        throw new Error('无法获取有效的CSRF令牌');
      }

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
      
      // 处理CSRF令牌失效的情况
      if (response.status === 403 && 
          (await response.json()).message === '无效的CSRF令牌') {
        console.log('CSRF令牌失效，刷新令牌后重试');
        csrfToken = ''; // 清除当前令牌
        retryCount++;
        continue;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || `请求失败: ${response.status}`;
        console.error(`请求错误: ${method} ${url} - ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      const responseData = await response.json();
      console.log(`请求成功: ${method} ${url}`, responseData);
      return responseData;
    } catch (err) {
      console.error(`请求过程中出错: ${method} ${url}`, err);
      
      // 如果是网络错误且未达到最大重试次数，则重试
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
  console.log(`显示消息: ${text}`);
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

// 管理员系统面板（仅ID=1显示）
function showSuperAdminPanel(user) {
  if (document.getElementById('super-admin-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'super-admin-panel';
  panel.style = 'max-width:800px;margin:2rem auto;padding:1.5rem;background:rgba(255,255,255,0.95);border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);';
  panel.innerHTML = `
    <h3 style="color:#c2a469;">管理员权限管理</h3>
    <input type="number" id="set-admin-id" placeholder="用户ID" style="width:100px;">
    <select id="set-admin-action">
      <option value="true">赋予管理员</option>
      <option value="false">取消管理员</option>
    </select>
    <button id="set-admin-btn" style="margin-left:1rem;">提交</button>
    <div id="set-admin-msg" style="margin-top:0.5rem;"></div>
  `;
  document.body.appendChild(panel);
  document.getElementById('set-admin-btn').onclick = async () => {
    const userId = Number(document.getElementById('set-admin-id').value);
    const isAdmin = document.getElementById('set-admin-action').value === 'true';
    const msgDiv = document.getElementById('set-admin-msg');
    if (!userId || userId < 1) {
      msgDiv.textContent = '请输入有效的用户ID';
      msgDiv.style.color = 'red';
      return;
    }
    msgDiv.textContent = '操作中...';
    msgDiv.style.color = '#333';
    try {
      const res = await makeAuthenticatedRequest(
        `${API_BASE_URL}/api/admin/set-admin`,
        'POST',
        { userId, isAdmin }
      );
      msgDiv.textContent = res.success ? '操作成功' : (res.message || '操作失败');
      msgDiv.style.color = res.success ? 'green' : 'red';
    } catch (err) {
      msgDiv.textContent = err.message || '操作失败';
      msgDiv.style.color = 'red';
    }
  };
}

// 移除管理员面板
function removeSuperAdminPanel() {
  const panel = document.getElementById('super-admin-panel');
  if (panel) panel.remove();
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
      removeSuperAdminPanel();
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
    removeSuperAdminPanel();
  } finally {
    console.log('页面初始化完成');
  }
});