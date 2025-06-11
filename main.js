// API基础配置
const API_BASE_URL = 'https://qianxian-backend.onrender.com';
let csrfToken = '';

// 获取CSRF令牌
async function getCsrfToken() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      credentials: 'include'
    });
    const data = await response.json();
    csrfToken = data.token;
  } catch (err) {
    console.error('获取CSRF令牌失败:', err);
  }
}

// 创建登录表单
const loginForm = document.createElement('div');
loginForm.className = 'login-form';
loginForm.innerHTML = `
  <div id="login-container">
    <h2>家族成员登录</h2>
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
    <h2>家族成员注册</h2>
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

// 检查登录状态
async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/user`, {
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken
      }
    });
    const data = await response.json();
    
    if (data.isAuthenticated) {
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
    }
  } catch (err) {
    console.error('检查登录状态失败:', err);
  }
}

// 登录功能
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
    const response = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showMessage(messageElement, '登录成功', 'green');
      await checkAuth();
    } else {
      showMessage(messageElement, `登录失败: ${data.message || '未知错误'}`, 'red');
    }
  } catch (err) {
    showMessage(messageElement, `网络错误: ${err.message}`, 'red');
    console.error('登录错误:', err);
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
    await fetch(`${API_BASE_URL}/api/logout`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken
      },
      credentials: 'include'
    });
    location.reload();
  } catch (err) {
    console.error('退出登录失败:', err);
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

  try {
    const response = await fetch(`${API_BASE_URL}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showMessage(messageElement, '注册成功，请登录', 'green');
      document.getElementById('show-login').click();
      form.reset();
    } else {
      showMessage(messageElement, `注册失败: ${data.message || '未知错误'}`, 'red');
    }
  } catch (err) {
    showMessage(messageElement, `网络错误: ${err.message}`, 'red');
    console.error('注册错误:', err);
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
  element.textContent = text;
  element.style.color = color;
}

// 页面初始化
document.addEventListener('DOMContentLoaded', async () => {
  await getCsrfToken();
  await checkAuth();
});