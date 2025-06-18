/**
 * 千弦家族社区 - 简易缓存工具
 * 支持内存缓存和 Redis 缓存（如可用）
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
        await redisClient.setEx(key, ttl, JSON.stringify(value));
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
      return;
    } catch (e) {}
  }
  memoryCache.delete(key);
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
}

module.exports