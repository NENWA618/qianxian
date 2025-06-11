// 登录功能
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
  </div>
`;

document.body.insertBefore(loginForm, document.body.firstChild);

// 检查登录状态
async function checkAuth() {
  try {
    const response = await fetch('https://your-render-app.onrender.com/api/user', {
      credentials: 'include'
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

// 登录
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  
  try {
    const response = await fetch('https://your-render-app.onrender.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      checkAuth();
      document.getElementById('login-message').textContent = '登录成功';
      document.getElementById('login-message').style.color = 'green';
    } else {
      document.getElementById('login-message').textContent = '登录失败: ' + (data.message || '未知错误');
      document.getElementById('login-message').style.color = 'red';
    }
  } catch (err) {
    document.getElementById('login-message').textContent = '网络错误: ' + err.message;
    document.getElementById('login-message').style.color = 'red';
  }
});

// 退出登录
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('https://your-render-app.onrender.com/api/logout', {
      method: 'POST',
      credentials: 'include'
    });
    location.reload();
  } catch (err) {
    console.error('退出登录失败:', err);
  }
});

// 页面加载时检查登录状态
document.addEventListener('DOMContentLoaded', checkAuth);