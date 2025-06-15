// 通用CSRF获取（支持并发队列）
let csrfToken = null;
let isFetchingToken = false;
let tokenQueue = [];

/**
 * 获取CSRF Token，自动串行化并发请求，避免多次初始化session。
 * @param {number} retryCount
 * @returns {Promise<string>}
 */
async function getCsrfToken(retryCount = 0) {
  const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';
  const maxRetries = 3;
  const retryDelay = 1000;
  if (csrfToken) return csrfToken;
  if (isFetchingToken) {
    return new Promise(resolve => tokenQueue.push(resolve));
  }
  isFetchingToken = true;
  try {
    // 先访问 /api/user 以确保 session 初始化
    const userRes = await fetch(API_BASE_URL + '/api/user', { credentials: 'include' });
    // 健壮性：即使未登录也应返回200
    if (!userRes.ok) throw new Error('初始化会话失败');
    const res = await fetch(API_BASE_URL + '/api/csrf-token', {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
    });
    const data = await res.json();
    if (!data.token) throw new Error('获取CSRF令牌失败');
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
    if (retryCount < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return getCsrfToken(retryCount + 1);
    }
    csrfToken = null;
    throw new Error('获取CSRF令牌失败');
  } finally {
    isFetchingToken = false;
  }
}

/**
 * 防XSS转义
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 生成权限徽章HTML
 * @param {object} user
 * @returns {string}
 */
function getBadge(user) {
  if (!user) return '';
  if (user.id === 1) {
    return `<span class="member-badge super-admin">创始人</span>`;
  } else if (user.is_super_admin) {
    return `<span class="member-badge super-admin">超管</span>`;
  } else if (user.is_admin) {
    return `<span class="member-badge admin">管理员</span>`;
  } else {
    return `<span class="member-badge normal">普通成员</span>`;
  }
}