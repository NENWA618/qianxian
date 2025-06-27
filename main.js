// 引入 utils.js（确保在 HTML 中 <script src="utils.js"></script> 在 main.js 之前引入）
// 新增：引入 zxcvbn 密码强度库
// <script src="https://cdn.jsdelivr.net/npm/zxcvbn@4.4.2/dist/zxcvbn.js"></script> 建议在 HTML 中引入

const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';

// ====== 全局错误提示组件 ======
function showGlobalError(msg, duration = 4000) {
  let el = document.getElementById('global-error-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-error-tip';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.display = 'none';
    }, 400);
  }, duration);
}

// ========== 密码强度检测工具 ==========
function showPasswordStrength(password, container) {
  if (!window.zxcvbn) return;
  const result = window.zxcvbn(password);
  const score = result.score;
  const msg = [
    "极弱",
    "弱",
    "中等",
    "强",
    "极强"
  ][score] || "";
  container.textContent = `密码强度：${msg}`;
  container.style.color = ["#d00", "#e67e22", "#f1c40f", "#27ae60", "#2ecc71"][score] || "#333";
}

// ========== 表单输入前端校验（增强XSS/SQL注入防护） ==========
function validateInput(str, type = "text") {
  if (typeof str !== "string") return false;
  if (type === "desc") {
    // 仅限中英文、数字、空格及常用标点，2-64字符
    return /^[\u4e00-\u9fa5\w\s.,，。:：;；!！?？\-()（）【】\[\]{}《》<>@#&*+=~$%^'"|\\/]{2,64}$/.test(str);
  }
  if (type === "username") {
    return /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(str);
  }
  if (type === "password") {
    return typeof str === "string" && str.length >= 6 && str.length <= 64;
  }
  // 通用文本
  return !/[<>"'%;(){}]/.test(str);
}

// ========== 登录/注册UI渲染 ==========
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

// ========== 聊天小窗功能 ==========
function showChatFloatWindow() {
  if (document.getElementById('chat-float-iframe')) return;
  const iframe = document.createElement('iframe');
  iframe.src = 'chat_window.html';
  iframe.id = 'chat-float-iframe';
  iframe.style = 'position:fixed;right:24px;bottom:24px;width:360px;height:500px;border:none;z-index:9999;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.13);background:transparent;';
  iframe.allow = 'clipboard-write';
  document.body.appendChild(iframe);
}

// 登录后自动显示聊天小窗
function handleLoginSuccess() {
  showChatFloatWindow();
}

// ========== 登录/注册/登出逻辑 ==========
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById("register-message");

  if (!username) {
    showMessage(messageElement, "用户名不能为空", "red");
    return;
  }
  if (!validateInput(password, "password")) {
    showMessage(messageElement, "密码格式不合法，8-64位", "red");
    return;
  }
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
      showMessage(messageElement, "注册成功，请等待审核", "green");
      setTimeout(() => {
        document.getElementById("register-form").reset();
        showLoginForm();
      }, 1000);
      return;
    } else {
      const errorMsg = data.message || "未知错误";
      showMessage(messageElement, `注册失败: ${errorMsg}`, "red");
    }
  } catch (err) {
    const errorMsg = err.message.includes("Failed to fetch")
      ? "网络连接失败，请检查网络"
      : err.message.includes("无效的CSRF令牌")
        ? "会话已过期，请刷新页面重试"
        : err.message;
    showMessage(messageElement, `注册错误: ${errorMsg}`, "red");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "注册";
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('login-message');

  if (!username) {
    showMessage(messageElement, "用户名不能为空", "red");
    return;
  }
  if (!validateInput(password, "password")) {
    showMessage(messageElement, "密码格式不合法，8-64位", "red");
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
      setTimeout(() => {
        handleLoginSuccess();
      }, 500);
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

// ========== 修改密码功能 ==========
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

document.addEventListener('DOMContentLoaded', () => {
  const changePwdLink = document.getElementById('show-change-password');
  if (changePwdLink) {
    changePwdLink.onclick = function(e) {
      e.preventDefault();
      showChangePasswordPopup();
    };
  }
});

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

// ========== 通用请求函数 ==========
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

function showMessage(element, text, color) {
  if (!element) return;
  element.textContent = text;
  element.style.color = color;
}

// ========== 登录/注册切换 ==========
document.getElementById('show-register').onclick = function(e) {
  e.preventDefault();
  loginForm.style.display = 'none';
  registerForm.style.display = '';
};
document.getElementById('show-login').onclick = function(e) {
  e.preventDefault();
  loginForm.style.display = '';
  registerForm.style.display = 'none';
};
function showLoginForm() {
  loginForm.style.display = '';
  registerForm.style.display = 'none';
}

// ========== 聊天小窗入口自动显示（登录后） ==========
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 检查登录状态
    const res = await fetch(`${API_BASE_URL}/api/user`, { credentials: 'include' });
    const data = await res.json();
    if (data && data.isAuthenticated) {
      handleLoginSuccess();
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('user-info').style.display = 'block';
      document.getElementById('username-display').textContent = data.user.username;
      document.getElementById('register-link-row').style.display = 'none';
    } else {
      document.getElementById('login-form').style.display = '';
      document.getElementById('user-info').style.display = 'none';
      document.getElementById('register-link-row').style.display = '';
    }
  } catch (err) {
    document.getElementById('login-form').style.display = '';
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('register-link-row').style.display = '';
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

// ========== 上传图片并插入[img]url[/img] ==========
async function uploadAndInsertImage(file, inputElem) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showGlobalError('图片不能超过2MB');
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
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
      showGlobalError(data.message || '图片上传失败');
    }
  } catch (err) {
    showGlobalError('图片上传失败');
  }
}

// ========== END PWA推送注册 ==========

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