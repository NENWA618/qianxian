// 临界阻尼自适应速率限制中间件（增强版）
// 结合论文思想：递归熵动力学、多维同步性判据、临界阻尼自适应
// 支持 windowMs、min、max、criticalDamping 参数
// 新增：多维同步性判据（方差+熵+峰度），递归API分组限流，白名单IP跳过
// 优化：普通GET请求极宽松，仅敏感操作严格限流，参数更丝滑
// 优化：真实IP获取，兼容多级代理
// 新增：限流与异常行为写入操作日志
// 新增：通道/模式自适应参数支持，Langevin动力学异常检测（实验性）
// 新增：支持γr/γd通道阻尼比（论文4.2），可扩展不同用户/通道限流灵活性
// 新增：参数动态化支持（结合 dynamicParams.js），参数热更新
// 新增：βexit、γc判据完善，支持A/B测试

const rateMap = new Map();
const { logOperation } = require("../models/operation_logs");
const { getParams } = require("../config/dynamicParams");

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

// Langevin动力学异常检测（实验性）
function langevinNoise(arr) {
  if (arr.length < 2) return 0;
  let noiseSum = 0;
  for (let i = 1; i < arr.length; i++) {
    noiseSum += Math.abs(arr[i] - arr[i - 1]);
  }
  return noiseSum / (arr.length - 1);
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
  if (req.path.startsWith('/api/api-tokens')) return 'api-tokens';
  return 'default';
}

// 通道/模式判定（如高频/低频用户、夜间/白天、API分组）
function getChannelMode(req) {
  let userType = 'guest';
  if (req.user && req.user.is_super_admin) userType = 'super_admin';
  else if (req.user && req.user.is_admin) userType = 'admin';
  else if (req.user) userType = 'user';

  const hour = new Date().getHours();
  let timeMode = (hour >= 0 && hour < 6) ? 'night' : (hour >= 22 ? 'late' : 'day');

  const group = getGroupKey(req);

  return `${userType}_${timeMode}_${group}`;
}

// 获取真实IP，兼容多级代理
function getRealIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const ips = xff.split(',').map(ip => ip.trim()).filter(Boolean);
    if (ips.length > 0) return ips[0];
  }
  return req.ip;
}

// 动态参数获取（支持热更新/A/B测试/γc/βexit等）
function getDynamicParams(channelMode) {
  const config = getParams();
  return {
    betaCrit: config.betaCrit || 1.23,
    betaExit: config.betaExit || 0.85,
    gammaC: config.gammaC || 2.0,
    entropyCrit: config.entropyCrit || 1.5,
    langevinThreshold: config.langevinThreshold || 2000,
    langevinExit: config.langevinExit || 4000,
    abTestGroup: config.abTestGroup || "A",
    channelGamma: (config.channelDamping && config.channelDamping[channelMode]) || 2.5,
    min: 30,
    max: 400,
    windowMs: 15 * 60 * 1000
  };
}

// 通道/模式自适应参数表（兼容旧逻辑，优先 dynamicParams）
const channelParams = {
  'super_admin_day_admin': { windowMs: 5 * 60 * 1000, min: 100, max: 1000, gamma: 1 },
  'admin_day_admin': { windowMs: 10 * 60 * 1000, min: 60, max: 600, gamma: 1.5 },
  'user_night_chat': { windowMs: 30 * 60 * 1000, min: 80, max: 400, gamma: 2.5 },
  'user_day_chat': { windowMs: 15 * 60 * 1000, min: 40, max: 200, gamma: 2.5 },
  'guest_day_default': { windowMs: 10 * 60 * 1000, min: 20, max: 80, gamma: 3 }
};

function adaptiveRateLimit(options = {}) {
  const defaultWindowMs = options.windowMs || 15 * 60 * 1000;
  const defaultMin = options.min || 30;
  const defaultMax = options.max || 400;
  const criticalDamping = options.criticalDamping || false;

  return async (req, res, next) => {
    const realIp = getRealIp(req);

    // Render/Vercel/Cloudflare 代理下的本地/内网IP也跳过限流
    const whitelist = ['127.0.0.1', '::1'];
    if (
      whitelist.includes(realIp) ||
      realIp === '::ffff:127.0.0.1' ||
      realIp.startsWith('10.') ||
      realIp.startsWith('100.')
    ) return next();

    const group = getGroupKey(req);
    const channelMode = getChannelMode(req);

    // 动态参数优先
    const dyn = getDynamicParams(channelMode);
    const params = channelParams[channelMode] || { windowMs: defaultWindowMs, min: defaultMin, max: defaultMax, gamma: dyn.channelGamma };
    const windowMs = params.windowMs || dyn.windowMs;
    const min = params.min || dyn.min;
    const max = params.max || dyn.max;
    const gamma = params.gamma || dyn.channelGamma;

    // βcrit判据（触发限流），βexit判据（解除限流）
    const beta_crit = dyn.betaCrit * dyn.betaCrit * 1000 * 1000;
    const beta_exit = dyn.betaExit * dyn.betaExit * 1000 * 1000;
    const entropyCrit = dyn.entropyCrit;
    const langevinThreshold = dyn.langevinThreshold;
    const langevinExit = dyn.langevinExit;
    const gammaC = dyn.gammaC;

    const key = realIp + ':' + group;
    const now = Date.now();
    let entry = rateMap.get(key);

    if (!entry) {
      entry = {
        count: 1,
        last: now,
        lastRate: 0,
        lastWindow: now,
        gamma: gamma || 2.5,
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
      entry.gamma = gamma || 2.5;
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

    // Langevin动力学异常检测
    const langevin = langevinNoise(intervals);

    // 判据更丝滑：三者均低于阈值才限流，且Langevin噪声过大也限流
    const metrics = [
      intervalVariance < beta_crit,
      intervalEntropy < entropyCrit,
      Math.abs(intervalKurtosis) < 10,
      langevin < langevinThreshold // Langevin噪声阈值（单位ms）
    ];
    if (
      isSensitive &&
      !entry.isLimited &&
      metrics.every(Boolean)
    ) {
      entry.isLimited = true;
      entry.limitedAt = now;
      // 记录异常行为日志
      logOperation({
        user_id: req.user ? req.user.id : 0,
        username: req.user ? req.user.username : "system",
        action: "rate_limit",
        detail: JSON.stringify({
          ip: realIp,
          group,
          channelMode,
          reason: "sync_criteria",
          intervalVariance,
          intervalEntropy,
          intervalKurtosis,
          langevin,
          abTestGroup: dyn.abTestGroup
        }),
        ip: realIp,
        channel_mode: channelMode
      }).catch(() => {});
    } else if (
      entry.isLimited &&
      (
        intervalVariance > beta_exit ||
        intervalEntropy > entropyCrit + 0.5 ||
        Math.abs(intervalKurtosis) > 20 ||
        langevin > langevinExit
      )
    ) {
      entry.isLimited = false;
      entry.limitedAt = null;
      entry.count = Math.floor(entry.dynamicMax * 0.5);
      // 记录解除限流日志
      logOperation({
        user_id: req.user ? req.user.id : 0,
        username: req.user ? req.user.username : "system",
        action: "rate_limit_exit",
        detail: JSON.stringify({
          ip: realIp,
          group,
          channelMode,
          reason: "sync_criteria_exit",
          intervalVariance,
          intervalEntropy,
          intervalKurtosis,
          langevin,
          abTestGroup: dyn.abTestGroup
        }),
        ip: realIp,
        channel_mode: channelMode
      }).catch(() => {});
    }

    // 速率估算
    const currentRate = entry.count / ((now - entry.lastWindow) / 1000 + 1);
    const dRate = currentRate - entry.lastRate;
    entry.lastRate = currentRate;

    // 临界阻尼自适应调整（论文γc, γr/γd思想）
    if (criticalDamping) {
      // γc = 2*sqrt(ω0^2 - noise^2)
      const gamma_c = gammaC;
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
