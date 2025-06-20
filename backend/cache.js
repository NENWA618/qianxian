/**
 * 千弦家族社区 - 高级缓存工具
 * 支持内存缓存和 Redis 缓存（如可用）
 * 增强：缓存失效策略，防止缓存雪崩
 * 新增：递归熵驱动缓存刷新支持（带递归判据的set/get）
 * 新增：多层级递归熵缓存、缓存命中/失效日志
 * 新增：缓存命中率统计与监控接口支持
 */

const redis = require('redis');
const { logOperation } = require("./models/operation_logs");

let redisClient = null;
let redisAvailable = false;

// 缓存命中率统计
const cacheStats = {
  redis: { hit: 0, miss: 0, set: 0, del: 0, expire: 0, clear: 0 },
  memory: { hit: 0, miss: 0, set: 0, del: 0, expire: 0, clear: 0 }
};

// 初始化 Redis 客户端（如有配置）
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

// 内存缓存
const memoryCache = new Map();
const memoryCacheTimers = new Map();

/**
 * 获取缓存
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getCache(key) {
  if (redisAvailable && redisClient) {
    try {
      const val = await redisClient.get(key);
      if (val !== null) {
        // 命中Redis缓存，写日志
        cacheStats.redis.hit++;
        logOperation({
          user_id: 0,
          username: "system",
          action: "cache_hit",
          detail: JSON.stringify({ key, type: "redis" }),
          ip: ""
        }).catch(() => {});
        return JSON.parse(val);
      }
    } catch (e) {
      // Redis 异常自动降级为内存
    }
  }
  if (memoryCache.has(key)) {
    // 命中内存缓存，写日志
    cacheStats.memory.hit++;
    logOperation({
      user_id: 0,
      username: "system",
      action: "cache_hit",
      detail: JSON.stringify({ key, type: "memory" }),
      ip: ""
    }).catch(() => {});
    return memoryCache.get(key);
  }
  // 未命中缓存，写日志
  cacheStats.redis.miss++;
  cacheStats.memory.miss++;
  logOperation({
    user_id: 0,
    username: "system",
    action: "cache_miss",
    detail: JSON.stringify({ key }),
    ip: ""
  }).catch(() => {});
  return null;
}

/**
 * 设置缓存
 * @param {string} key
 * @param {any} value
 * @param {number} ttl 过期时间（秒），可选
 * @returns {Promise<void>}
 */
async function setCache(key, value, ttl) {
  if (redisAvailable && redisClient) {
    try {
      if (ttl) {
        // 增加缓存失效时间的随机抖动，防止雪崩
        const jitter = Math.floor(Math.random() * Math.min(30, Math.floor(ttl / 10) || 1));
        await redisClient.setEx(key, ttl + jitter, JSON.stringify(value));
      } else {
        await redisClient.set(key, JSON.stringify(value));
      }
      cacheStats.redis.set++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_set",
        detail: JSON.stringify({ key, type: "redis", ttl }),
        ip: ""
      }).catch(() => {});
      return;
    } catch (e) {
      // Redis 异常自动降级为内存
    }
  }
  memoryCache.set(key, value);
  if (ttl) {
    // 清理旧定时器
    if (memoryCacheTimers.has(key)) {
      clearTimeout(memoryCacheTimers.get(key));
    }
    // 增加缓存失效时间的随机抖动，防止雪崩
    const jitter = Math.floor(Math.random() * Math.min(30000, Math.floor(ttl * 1000 / 10) || 1000));
    const timer = setTimeout(() => {
      memoryCache.delete(key);
      memoryCacheTimers.delete(key);
      cacheStats.memory.expire++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_expire",
        detail: JSON.stringify({ key, type: "memory" }),
        ip: ""
      }).catch(() => {});
    }, ttl * 1000 + jitter);
    memoryCacheTimers.set(key, timer);
  }
  cacheStats.memory.set++;
  logOperation({
    user_id: 0,
    username: "system",
    action: "cache_set",
    detail: JSON.stringify({ key, type: "memory", ttl }),
    ip: ""
  }).catch(() => {});
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
      cacheStats.redis.del++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_del",
        detail: JSON.stringify({ key, type: "redis" }),
        ip: ""
      }).catch(() => {});
      return;
    } catch (e) {}
  }
  memoryCache.delete(key);
  if (memoryCacheTimers.has(key)) {
    clearTimeout(memoryCacheTimers.get(key));
    memoryCacheTimers.delete(key);
  }
  cacheStats.memory.del++;
  logOperation({
    user_id: 0,
    username: "system",
    action: "cache_del",
    detail: JSON.stringify({ key, type: "memory" }),
    ip: ""
  }).catch(() => {});
}

/**
 * 清空所有缓存
 * @returns {Promise<void>}
 */
async function clearCache() {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.flushDb();
      cacheStats.redis.clear++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_clear",
        detail: JSON.stringify({ type: "redis" }),
        ip: ""
      }).catch(() => {});
      return;
    } catch (e) {}
  }
  memoryCache.clear();
  for (const timer of memoryCacheTimers.values()) {
    clearTimeout(timer);
  }
  memoryCacheTimers.clear();
  cacheStats.memory.clear++;
  logOperation({
    user_id: 0,
    username: "system",
    action: "cache_clear",
    detail: JSON.stringify({ type: "memory" }),
    ip: ""
  }).catch(() => {});
}

/**
 * 递归熵驱动缓存刷新（高级接口）
 * @param {string} key
 * @param {function(): Promise<any>} fetchFn
 * @param {object} options { ttl, entropyJudge, maxDepth }
 * @returns {Promise<any>}
 */
async function getOrRefreshCacheWithEntropy(key, fetchFn, options = {}) {
  const { ttl = 60, entropyJudge, maxDepth = 1 } = options;
  let cached = await getCache(key);
  let needRefresh = false;
  let depth = 0;
  // 多层级递归判据
  while (depth < maxDepth) {
    if (cached && typeof entropyJudge === "function") {
      // 判断是否需要刷新
      if (!entropyJudge(cached)) {
        needRefresh = true;
        break;
      }
    } else if (!cached) {
      needRefresh = true;
      break;
    }
    depth++;
    break;
  }
  if (needRefresh) {
    const fresh = await fetchFn();
    await setCache(key, fresh, ttl);
    logOperation({
      user_id: 0,
      username: "system",
      action: "cache_refresh",
      detail: JSON.stringify({ key, depth }),
      ip: ""
    }).catch(() => {});
    return fresh;
  }
  return cached;
}

/**
 * 获取缓存命中率统计
 * @returns {object}
 */
function getCacheStats() {
  return {
    redis: { ...cacheStats.redis },
    memory: { ...cacheStats.memory }
  };
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  delCache,
  clearCache,
  getOrRefreshCacheWithEntropy,
  getCacheStats
};