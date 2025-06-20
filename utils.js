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
    // 统一只认 token 字段
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
  if (typeof window.DOMPurify === 'object' && typeof window.DOMPurify.sanitize === 'function') {
    return window.DOMPurify.sanitize(html, {ALLOWED_TAGS: ['b','i','em','strong','a','code','pre','span','img'], ALLOWED_ATTR: ['href','src','alt','class','style']});
  }
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

// 图片懒加载辅助（可用于图片批量渲染时）
function lazyLoadImages() {
  if ('loading' in HTMLImageElement.prototype) return; // 原生支持
  const imgs = document.querySelectorAll('img[loading="lazy"]');
  if ('IntersectionObserver' in window) {
    const observer = new window.IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          obs.unobserve(img);
        }
      });
    });
    imgs.forEach(img => {
      if (img.dataset.src) observer.observe(img);
    });
  } else {
    // fallback: 直接加载
    imgs.forEach(img => {
      if (img.dataset.src) img.src = img.dataset.src;
    });
  }
}

/**
 * 临界阻尼动画（smoothDampedAnimate）
 * @param {HTMLElement} el - 要动画的元素
 * @param {string} prop - CSS属性名（如 'opacity', 'left', 'top'）
 * @param {number} target - 目标值
 * @param {object} options - { duration, onUpdate, onComplete }
 */
function smoothDampedAnimate(el, prop, target, options = {}) {
  const duration = options.duration || 400; // ms
  const fps = 60;
  const dt = 1 / fps;
  const gamma = 2 * Math.sqrt(1); // 临界阻尼
  const omega0 = 1;
  let x = parseFloat(getComputedStyle(el)[prop]) || 0;
  let v = 0;
  let t = 0;
  const x0 = x;

  function step() {
    // 二阶临界阻尼系统数值积分
    const a = -gamma * v - omega0 * omega0 * (x - target);
    v += a * dt;
    x += v * dt;
    t += dt * 1000;
    // 更新属性
    el.style[prop] = prop === "opacity" ? x : x + (prop === "opacity" ? "" : "px");
    if (options.onUpdate) options.onUpdate(x);
    if (Math.abs(x - target) < 0.001 && Math.abs(v) < 0.001) {
      el.style[prop] = prop === "opacity" ? target : target + (prop === "opacity" ? "" : "px");
      if (options.onComplete) options.onComplete();
      return;
    }
    if (t < duration) {
      requestAnimationFrame(step);
    } else {
      el.style[prop] = prop === "opacity" ? target : target + (prop === "opacity" ? "" : "px");
      if (options.onComplete) options.onComplete();
    }
  }
  step();
}

// ========== 新增：缓存命中/失效状态提示 ==========
/**
 * 显示缓存命中/失效提示
 * @param {boolean} hit
 * @param {string} [msg]
 */
function showCacheStatus(hit, msg = "") {
  let el = document.getElementById("cache-status-tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "cache-status-tip";
    el.style.position = "fixed";
    el.style.bottom = "24px";
    el.style.right = "24px";
    el.style.zIndex = "9999";
    el.style.padding = "8px 16px";
    el.style.borderRadius = "6px";
    el.style.background = hit ? "#e6ffe6" : "#fff0f0";
    el.style.color = hit ? "#2e7d32" : "#c62828";
    el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
    el.style.fontSize = "15px";
    el.style.transition = "opacity 0.3s";
    document.body.appendChild(el);
  }
  el.textContent = hit ? (msg || "缓存命中") : (msg || "缓存失效，已刷新");
  el.style.opacity = "1";
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
  }, 1200);
}

// 导出到全局
window.getCsrfToken = getCsrfToken;
window.escapeHtml = escapeHtml;
window.getBadge = getBadge;
window.sanitizeHtml = sanitizeHtml;
window.entropy = entropy;
window.variance = variance;
window.kurtosis = kurtosis;
window.throttle = throttle;
window.debounce = debounce;
window.lazyLoadImages = lazyLoadImages;
window.smoothDampedAnimate = smoothDampedAnimate;