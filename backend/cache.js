/**
 * 千弦家族社区 - 自适应递归熵判据缓存工具
 * 支持内存缓存和 Redis 缓存（如可用）
 * 新增：递归熵驱动的自适应刷新、同步性判据、性能监控
 */

const redis = require("redis");

// ========== 递归熵判据与同步性判据工具 ==========
function entropy(arr) {
  if (!arr || !arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const probs = arr.map((x) => x / sum).filter((p) => p > 0);
  return -probs.reduce((a, p) => a + p * Math.log(p), 0);
}
function variance(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, x) => a + (x - mean) ** 2, 0) / arr.length;
}
function kurtosis(arr) {
  if (!arr || arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(variance(arr));
  if (std === 0) return 0;
  const n = arr.length;
  return (
    (n * arr.reduce((a, x) => a + ((x - mean) / std) ** 4, 0)) /
      ((n - 1) * (n - 2) * (n - 3)) -
    3
  );
}

// ========== Redis 初始化 ==========
let redisClient = null;
let redisAvailable = false;

async function initRedis() {
  if (redisClient) return;
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || undefined
    });
    await redisClient.connect();
    redisAvailable = true;
  } catch (e) {
    redisAvailable = false;
    redisClient = null;
  }
}

// ========== 内存缓存 ==========
const memoryCache = new Map();
// 记录每个key的历史访问分布、熵序列
const cacheStats = new Map();

/**
 * 获取缓存
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getCache(key) {
  if (redisAvailable && redisClient) {
    try {
      const val = await redisClient.get(key);
      if (val) recordCacheHit(key, true);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      // Redis 异常自动降级为内存
    }
  }
  if (memoryCache.has(key)) {
    recordCacheHit(key, false);
    return memoryCache.get(key);
  }
  return null;
}

/**
 * 设置缓存（递归熵驱动的自适应刷新）
 * @param {string} key
 * @param {any} value
 * @param {number} ttl 过期时间（秒），可选
 * @param {object} [opts] 可选：{ entropyArr, threshold }
 *   - entropyArr: 用于判据的分布数组（如成员注册时间分布、内容热度分布等）
 *   - threshold: 信息熵收敛阈值，默认0.01
 * @returns {Promise<void>}
 */
async function setCache(key, value, ttl, opts = {}) {
  // 递归熵判据：如果分布信息变化剧烈，则强制刷新，否则延长TTL
  if (opts.entropyArr && Array.isArray(opts.entropyArr)) {
    const prevStats = cacheStats.get(key) || { entropySeq: [], lastEntropy: 0 };
    const currEntropy = entropy(opts.entropyArr);
    const entropySeq = prevStats.entropySeq.concat([currEntropy]).slice(-5);
    const delta =
      Math.abs(currEntropy - prevStats.lastEntropy || 0);
    const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.01;
    // 如果熵变化小于阈值，自动延长TTL（最多延长2倍）
    let realTtl = ttl;
    if (delta < threshold && ttl) {
      realTtl = Math.min(ttl * 2, 3600); // 最多延长到1小时
    }
    cacheStats.set(key, { entropySeq, lastEntropy: currEntropy });
    if (redisAvailable && redisClient) {
      try {
        await redisClient.setEx(key, realTtl, JSON.stringify(value));
        return;
      } catch (e) {}
    }
    memoryCache.set(key, value);
    if (realTtl) {
      setTimeout(() => memoryCache.delete(key), realTtl * 1000);
    }
    return;
  }
  // 普通缓存
  if (redisAvailable && redisClient) {
    try {
      if (ttl) {
        await redisClient.setEx(key, ttl, JSON.stringify(value));
      } else {
        await redisClient.set(key, JSON.stringify(value));
      }
      return;
    } catch (e) {}
  }
  memoryCache.set(key, value);
  if (ttl) {
    setTimeout(() => memoryCache.delete(key), ttl * 1000);
  }
}

/**
 * 删除缓存
 * @param {string} key
 * @returns {Promise<void>}
 */
async function delCache(key) {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.del(key);
    } catch (e) {}
  }
  memoryCache.delete(key);
  cacheStats.delete(key);
}

/**
 * 清空所有缓存
 * @returns {Promise<void>}
 */
async function clearCache() {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.flushDb();
    } catch (e) {}
  }
  memoryCache.clear();
  cacheStats.clear();
}

// ========== 缓存命中统计与同步性判据 ==========
function recordCacheHit(key, isRedis) {
  let stat = cacheStats.get(key);
  if (!stat) stat = { hits: 0, misses: 0, entropySeq: [], lastEntropy: 0 };
  stat.hits = (stat.hits || 0) + 1;
  cacheStats.set(key, stat);
}

/**
 * 判断缓存是否需要同步（多节点/分布式场景）
 * @param {string} key
 * @param {Array<number>} arr 分布数组
 * @returns {boolean} true=需要强同步
 */
function shouldSyncCache(key, arr) {
  // 多维同步性判据：方差、熵、峰度
  const v = variance(arr);
  const e = entropy(arr);
  const k = kurtosis(arr);
  // 可根据实际业务调整判据
  // 示例：方差>1.5 或 熵<0.5 或 峰度>2 时强同步
  return v > 1.5 || e < 0.5 || k > 2;
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  delCache,
  clearCache,
  shouldSyncCache
};