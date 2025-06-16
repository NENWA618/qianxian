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
  if (typeof str !== 'string') return '';
  return str
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

/**
 * 富文本安全过滤（如需支持富文本，建议引入DOMPurify等库）
 * @param {string} html
 * @returns {string}
 */
function sanitizeHtml(html) {
  // 若引入DOMPurify则用DOMPurify.sanitize(html)
  // 这里只做简单转义，实际生产建议严格过滤
  return escapeHtml(html);
}

/**
 * 计算信息熵（带缓存，提升高频调用性能）
 * @param {number[]} arr
 * @returns {number}
 */
const entropyCache = new WeakMap();
function entropy(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  // 缓存机制：只缓存长度≤100的数组
  if (arr.length <= 100) {
    if (entropyCache.has(arr)) return entropyCache.get(arr);
    const sum = arr.reduce((a, b) => a + b, 0) || 1;
    const val = -arr.map(x => x / sum).filter(p => p > 0).reduce((a, p) => a + p * Math.log(p), 0);
    entropyCache.set(arr, val);
    return val;
  } else {
    const sum = arr.reduce((a, b) => a + b, 0) || 1;
    return -arr.map(x => x / sum).filter(p => p > 0).reduce((a, p) => a + p * Math.log(p), 0);
  }
}

/**
 * 计算方差
 * @param {number[]} arr
 * @returns {number}
 */
function variance(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, x) => a + (x - mean) ** 2, 0) / arr.length;
}

/**
 * 计算峰度
 * @param {number[]} arr
 * @returns {number}
 */
function kurtosis(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(variance(arr));
  if (std === 0) return 0;
  const n = arr.length;
  return n * arr.reduce((a, x) => a + ((x - mean) / std) ** 4, 0) / ((n - 1) * (n - 2)) - 3;
}

/**
 * 节流函数（高频操作性能优化）
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function throttle(fn, delay = 200) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last > delay) {
      last = now;
      fn.apply(this, args);
    }
  };
}

/**
 * 防抖函数（高频操作性能优化）
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay = 200) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

// 导出到全局
window.getCsrfToken = getCsrfToken;