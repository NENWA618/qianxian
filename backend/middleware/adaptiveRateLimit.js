/**
 * 临界阻尼自适应速率限制中间件
 * 结合论文思想：根据流量波动动态调整限流阈值，防止突发拥塞与过度限制
 * 支持 windowMs、min、max、criticalDamping 参数
 * 新增：双阈值同步性判据（βcrit, βexit）限流，抑制突发团簇流量
 */

const rateMap = new Map();

function adaptiveRateLimit(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const min = options.min || 60;
  const max = options.max || 200;
  const criticalDamping = options.criticalDamping || false;

  // βcrit判据（触发限流），βexit判据（解除限流），单位：毫秒^2
  const beta_crit = 500 * 500;
  const beta_exit = 1200 * 1200; // 解除限流的同步性阈值（更宽松）

  return (req, res, next) => {
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
        isLimited: false,  // 新增：是否处于限流状态
        limitedAt: null    // 新增：进入限流的时间
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
    const dt = (now - entry.last) / 1000;
    entry.last = now;

    // 记录请求时间戳
    entry.timestamps.push(now);
    if (entry.timestamps.length > 20) entry.timestamps.shift();

    // 计算同步性（请求间隔方差）
    const intervals = [];
    for (let i = 1; i < entry.timestamps.length; i++) {
      intervals.push(entry.timestamps[i] - entry.timestamps[i - 1]);
    }
    let variance = 0;
    if (intervals.length > 1) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      variance = intervals.reduce((a, x) => a + (x - mean) ** 2, 0) / intervals.length;
    }

    // 双阈值同步性判据
    if (!entry.isLimited && variance < beta_crit) {
      // 进入限流状态
      entry.isLimited = true;
      entry.limitedAt = now;
    } else if (entry.isLimited && variance > beta_exit) {
      // 解除限流状态
      entry.isLimited = false;
      entry.limitedAt = null;
      // 重置计数，防止刚解除就再次触发
      entry.count = Math.floor(entry.dynamicMax * 0.5);
    }

    // 速率估算
    const currentRate = entry.count / ((now - entry.lastWindow) / 1000 + 1);
    const dRate = currentRate - entry.lastRate;
    entry.lastRate = currentRate;

    // 临界阻尼自适应调整
    if (criticalDamping) {
      // γc = 2 * sqrt(ω0^2 - noise^2)
      const gamma_c = 2 * Math.sqrt(entry.omega0 * entry.omega0 - entry.noise * entry.noise);
      if (entry.gamma > gamma_c) {
        entry.dynamicMax = Math.min(entry.dynamicMax + 5, max);
      } else if (entry.gamma < gamma_c) {
        entry.dynamicMax = Math.max(entry.dynamicMax - 5, min);
      }
      // γ自适应微调
      entry.gamma += (Math.random() - 0.5) * 0.1;
      if (entry.gamma < 0.5) entry.gamma = 0.5;
      if (entry.gamma > 5) entry.gamma = 5;
    } else {
      // 简单自适应
      if (currentRate > entry.dynamicMax * 0.8) {
        entry.dynamicMax = Math.max(entry.dynamicMax - 1, min);
      } else if (currentRate < entry.dynamicMax * 0.5) {
        entry.dynamicMax = Math.min(entry.dynamicMax + 1, max);
      }
    }

    // 限流判断（同步性限流 或 请求数超限）
    if (entry.isLimited || entry.count > entry.dynamicMax) {
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
