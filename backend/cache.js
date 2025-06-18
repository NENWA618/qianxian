/**
 * 千弦家族社区 - 简易缓存工具
 * 支持内存缓存和 Redis 缓存（如可用）
 * 增强：缓存失效策略，防止缓存雪崩
 */

const redis = require('redis');

let redisClient = null;
let redisAvailable = false;

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
      return val ? JSON.parse(val) : null;
    } catch (e) {
      // Redis 异常自动降级为内存
    }
  }
  return memoryCache.has(key) ? memoryCache.get(key) : null;
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
    }, ttl * 1000 + jitter);
    memoryCacheTimers.set(key, timer);
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
      return;
    } catch (e) {}
  }
  memoryCache.delete(key);
  if (memoryCacheTimers.has(key)) {
    clearTimeout(memoryCacheTimers.get(key));
    memoryCacheTimers.delete(key);
  }
}

/**
 * 清空所有缓存
 * @returns {Promise<void>}
 */
async function clearCache() {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.flushDb();
      return;
    } catch (e) {}
  }
  memoryCache.clear();
  for (const timer of memoryCacheTimers.values()) {
    clearTimeout(timer);
  }
  memoryCacheTimers.clear();
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  delCache,
  clearCache
};