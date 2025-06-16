// 临界阻尼自适应速率限制中间件（增强版）
// 结合论文思想：递归熵动力学、多维同步性判据、临界阻尼自适应
// 支持 windowMs、min、max、criticalDamping 参数
// 新增：多维同步性判据（方差+熵+峰度），递归API分组限流，白名单IP跳过
// 优化：普通GET请求极宽松，仅敏感操作严格限流，参数更丝滑
// 优化：真实IP获取，兼容多级代理

const rateMap = new Map();

// 统计量工具
function entropy(arr) {
  if (!arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const probs = arr.map(x => x / sum).filter(p => p > 0);
  return -probs.reduce((a, p) => a + p * Math.log(p), 0);
}
function variance(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, x) => a + (x - mean) ** 2, 0) / arr.length;
}
function kurtosis(arr) {
  if (arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(variance(arr));
  if (std === 0) return 0;
  const n = arr.length;
  return n * arr.reduce((a, x) => a + ((x - mean) / std) ** 4, 0) / ((n - 1) * (n - 2)) - 3;
}

// 定期清理过期IP记录，防止内存泄漏
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap.entries()) {
    if (now - entry.lastWindow > 60 * 60 * 1000) {
      rateMap.delete(key);
    }
  }
}, 30 * 60 * 1000);

// 递归API分组限流（如 /api/chat, /api/members, ...）
function getGroupKey(req) {
  if (req.path.startsWith('/api/chat')) return 'chat';
  if (req.path.startsWith('/api/members')) return 'members';
  if (req.path.startsWith('/api/friends')) return 'friends';
  if (req.path.startsWith('/api/admin')) return 'admin';
  return 'default';
}

// 获取真实IP，兼容多级代理
function getRealIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // 可能有多个IP，取第一个非空
    const ips = xff.split(',').map(ip => ip.trim()).filter(Boolean);
    if (ips.length > 0) return ips[0];
  }
  // Express会自动识别 req.ip，但有时是 ::1 或 127.0.0.1
  return req.ip;
}

function adaptiveRateLimit(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const min = options.min || 30; // 更宽松
  const max = options.max || 400;
  const criticalDamping = options.criticalDamping || false;

  // βcrit判据（触发限流），βexit判据（解除限流），单位：毫秒^2
  const beta_crit = 2500 * 2500; // 更宽松
  const beta_exit = 5000 * 5000;
  const entropyCrit = 1.5; // 更宽松

  // 白名单IP跳过限流
  const whitelist = ['127.0.0.1', '::1'];

  return (req, res, next) => {
    const realIp = getRealIp(req);
    if (whitelist.includes(realIp)) return next();

    const group = getGroupKey(req);
    const key = realIp + ':' + group;
    const now = Date.now();
    let entry = rateMap.get(key);

    if (!entry) {
      entry = {
        count: 1,
        last: now,
        lastRate: 0,
        lastWindow: now,
        gamma: 1,
        omega0: 1,
        noise: 0.1,
        dynamicMax: min,
        timestamps: [now],
        isLimited: false,
        limitedAt: null
      };
      rateMap.set(key, entry);
      return next();
    }

    // 窗口重置
    if (now - entry.lastWindow > windowMs) {
      entry.count = 1;
      entry.lastWindow = now;
      entry.lastRate = 0;
      entry.dynamicMax = min;
      entry.timestamps = [now];
      entry.isLimited = false;
      entry.limitedAt = null;
      return next();
    }

    entry.count += 1;
    entry.last = now;
    entry.timestamps.push(now);
    if (entry.timestamps.length > 30) entry.timestamps.shift();

    // 只对敏感操作（POST/PUT/DELETE）启用同步性限流
    const isSensitive = ['POST', 'PUT', 'DELETE'].includes(req.method);

    // 多维同步性判据（方差+熵+峰度）
    const intervals = [];
    for (let i = 1; i < entry.timestamps.length; i++) {
      intervals.push(entry.timestamps[i] - entry.timestamps[i - 1]);
    }
    const intervalVariance = variance(intervals);
    const intervalEntropy = entropy(intervals);
    const intervalKurtosis = kurtosis(intervals);

    // 判据更丝滑：三者均低于阈值才限流
    const metrics = [intervalVariance < beta_crit, intervalEntropy < entropyCrit, Math.abs(intervalKurtosis) < 10];
    if (
      isSensitive &&
      !entry.isLimited &&
      metrics.every(Boolean)
    ) {
      entry.isLimited = true;
      entry.limitedAt = now;
    } else if (
      entry.isLimited &&
      (intervalVariance > beta_exit || intervalEntropy > entropyCrit + 0.5 || Math.abs(intervalKurtosis) > 20)
    ) {
      entry.isLimited = false;
      entry.limitedAt = null;
      entry.count = Math.floor(entry.dynamicMax * 0.5);
    }

    // 速率估算
    const currentRate = entry.count / ((now - entry.lastWindow) / 1000 + 1);
    const dRate = currentRate - entry.lastRate;
    entry.lastRate = currentRate;

    // 临界阻尼自适应调整
    if (criticalDamping) {
      const gamma_c = 2 * Math.sqrt(entry.omega0 * entry.omega0 - entry.noise * entry.noise);
      if (entry.gamma > gamma_c) {
        entry.dynamicMax = Math.min(entry.dynamicMax + 5, max);
      } else if (entry.gamma < gamma_c) {
        entry.dynamicMax = Math.max(entry.dynamicMax - 5, min);
      }
      entry.gamma += (Math.random() - 0.5) * 0.1;
      if (entry.gamma < 0.5) entry.gamma = 0.5;
      if (entry.gamma > 5) entry.gamma = 5;
    } else {
      if (currentRate > entry.dynamicMax * 0.8) {
        entry.dynamicMax = Math.max(entry.dynamicMax - 1, min);
      } else if (currentRate < entry.dynamicMax * 0.5) {
        entry.dynamicMax = Math.min(entry.dynamicMax + 1, max);
      }
    }

    // 普通GET请求极宽松（只超max才限流）
    if (!isSensitive && entry.count <= max) {
      return next();
    }

    // 限流判断（同步性限流 或 请求数超限）
    if ((isSensitive && entry.isLimited) || entry.count > entry.dynamicMax) {
      res.set('Retry-After', Math.ceil((windowMs - (now - entry.lastWindow)) / 1000));
      res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        retryAfter: Math.ceil((windowMs - (now - entry.lastWindow)) / 1000)
      });
      return;
    }

    next();
  };
}

module.exports = adaptiveRateLimit;
