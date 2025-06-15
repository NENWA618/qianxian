/**
 * 临界阻尼自适应速率限制中间件（优化版）
 * 结合论文思想：根据流量波动动态调整限流阈值，防止突发拥塞与过度限制
 * 支持 windowMs、min、max、criticalDamping 参数
 * 新增：双阈值同步性判据（βcrit, βexit）限流，抑制突发团簇流量
 * 优化：调高 min/max，放宽同步性判据，仅对敏感操作严格限流，支持白名单IP
 * 新增：多维同步性判据（熵+方差），定期清理过期记录，防止内存泄漏
 */

const rateMap = new Map();

function entropy(arr) {
  if (!arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const probs = arr.map(x => x / sum).filter(p => p > 0);
  return -probs.reduce((a, p) => a + p * Math.log(p), 0);
}

// 定期清理过期IP记录，防止内存泄漏
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap.entries()) {
    if (now - entry.lastWindow > 60 * 60 * 1000) { // 1小时无活动
      rateMap.delete(key);
    }
  }
}, 30 * 60 * 1000); // 每30分钟清理一次

function adaptiveRateLimit(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const min = options.min || 100; // 优化：调高默认值
  const max = options.max || 400; // 优化：调高默认值
  const criticalDamping = options.criticalDamping || false;

  // βcrit判据（触发限流），βexit判据（解除限流），单位：毫秒^2
  const beta_crit = 1500 * 1500; // 优化：放宽同步性判据
  const beta_exit = 3000 * 3000; // 优化：放宽同步性判据
  const entropyCrit = 1.2; // 新增：熵判据，越低越同步

  // 可选：白名单IP跳过限流（如本地开发）
  const whitelist = ['127.0.0.1', '::1'];

  return (req, res, next) => {
    if (whitelist.includes(req.ip)) return next();

    const key = req.ip;
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
        timestamps: [now], // 记录请求时间戳
        isLimited: false,  // 是否处于限流状态
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

    // 记录请求时间戳
    entry.timestamps.push(now);
    if (entry.timestamps.length > 20) entry.timestamps.shift();

    // 只对敏感操作（POST/PUT/DELETE）启用同步性限流
    const isSensitive = ['POST', 'PUT', 'DELETE'].includes(req.method);

    // 计算同步性（请求间隔方差+熵）
    const intervals = [];
    for (let i = 1; i < entry.timestamps.length; i++) {
      intervals.push(entry.timestamps[i] - entry.timestamps[i - 1]);
    }
    let variance = 0;
    if (intervals.length > 1) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      variance = intervals.reduce((a, x) => a + (x - mean) ** 2, 0) / intervals.length;
    }
    const intervalEntropy = entropy(intervals);

    // 双阈值同步性判据（仅敏感操作启用，方差+熵）
    if (
      isSensitive &&
      !entry.isLimited &&
      variance < beta_crit &&
      intervalEntropy < entropyCrit
    ) {
      entry.isLimited = true;
      entry.limitedAt = now;
    } else if (
      entry.isLimited &&
      (variance > beta_exit || intervalEntropy > entropyCrit + 0.5)
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
