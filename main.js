// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';
let csrfToken = '';
let isFetchingToken = false;
let tokenQueue = [];

// 获取CSRF令牌 - 增强版
async function getCsrfToken(retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 1000;

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
    
    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(csrfToken);
    }
    
    return csrfToken;
  } catch (err) {
    console.error('获取CSRF令牌过程中出错:', err);
    
    while (tokenQueue.length > 0) {
      const resolve = tokenQueue.shift();
      resolve(null);
    }
    
    const messageElement = document.getElementById('login-message') || 
                          document.getElementById('register-message');
    if (messageElement) {
      const errorMsg = err.message.includes('Failed to fetch') 
        ? '无法连接服务器，请检查网络' 
        : '服务器暂时不可用，请稍后再试';
      showMessage(messageElement, errorMsg, 'red');
    }
    
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
      <div id="admin-section" style="margin-top: 1rem; display: none;">
        <button id="download-authority-btn">下载管理员文件</button>
      </div>
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

// 检查登录状态 - 增强版
async function checkAuth() {
  try {
    console.log('检查用户认证状态...');
    const token = await getCsrfToken();
    
    if (!token) {
      console.warn('没有有效的CSRF令牌，跳过认证检查');
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
      if (response.status !== 401) {
        const errorText = await response.text();
        throw new Error(`认证检查请求失败: ${response.status} - ${errorText}`);
      }
      return;
    }
    
    const data = await response.json();
    console.log('认证状态响应:', data);
    
    if (data.isAuthenticated) {
      console.log('用户已认证:', data.user.username);
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
      
      // 检查是否是管理员
      const isAdminResponse = await fetch(`${API_BASE_URL}/api/user/is-admin`, {
        credentials: 'include',
        headers: {
          'X-CSRF-Token': token,
          'Accept': 'application/json'
        }
      });
      
      if (isAdminResponse.ok) {
        const isAdminData = await isAdminResponse.json();
        if (isAdminData.isAdmin) {
          document.getElementById('admin-section').style.display = 'block';
          console.log('用户是管理员');
        }
      }
    }
  } catch (err) {
    console.error('检查认证状态时出错:', err);
  }
}

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
      
      if (response.status === 403 && 
          (await response.json()).message === '无效的CSRF令牌') {
        console.log('CSRF令牌失效，刷新令牌后重试');
        csrfToken = '';
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
      await checkAuth();
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
    console.error('登录过程中出错:', err);
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
    document.getElementById('login-form').style.display = '';
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('admin-section').style.display = 'none';
    
    registerForm.style.display = 'none';
    document.getElementById('login-container').style.display = 'block';
    
    showMessage(document.getElementById('login-message'), '您已成功退出登录', 'green');
  } catch (err) {
    const errorMsg = err.message.includes('Failed to fetch') 
      ? '网络连接失败' 
      : err.message;
    showMessage(document.getElementById('login-message'), `退出登录失败: ${errorMsg}`, 'red');
  } finally {
    button.disabled = false;
    button.textContent = '退出登录';
  }
});

// 管理员文件下载功能
document.getElementById('download-authority-btn')?.addEventListener('click', async () => {
  const button = document.getElementById('download-authority-btn');
  button.disabled = true;
  button.textContent = '下载中...';

  try {
    const token = await getCsrfToken();
    if (!token) throw new Error('无法获取CSRF令牌');

    const response = await fetch(`${API_BASE_URL}/api/admin/authority`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': token
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || '下载失败');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'authority.txt';
    a.click();
    window.URL.revokeObjectURL(url);

    showMessage(document.getElementById('login-message'), '文件下载成功', 'green');
  } catch (err) {
    showMessage(document.getElementById('login-message'), `下载失败: ${err.message}`, 'red');
    console.error('文件下载失败:', err);
  } finally {
    button.disabled = false;
    button.textContent = '下载管理员文件';
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
      showMessage(messageElement, '注册成功，请登录', 'green');
      document.getElementById('show-login').click();
      form.reset();
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

// 显示消息的辅助函数
function showMessage(element, text, color) {
  if (!element) return;
  element.textContent = text;
  element.style.color = color;
  console.log(`显示消息: ${text}`);
}

// 页面初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('页面初始化开始...');
  try {
    const token = await getCsrfToken();
    if (token) {
      console.log('CSRF令牌获取成功，检查认证状态');
      await checkAuth();
    } else {
      console.warn('无法获取CSRF令牌，部分功能可能受限');
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
  } finally {
    console.log('页面初始化完成');
  }
});