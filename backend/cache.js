/**
 * 千弦家族社区 - 高级缓存工具
 * 支持内存缓存和 Redis 缓存（如可用）
 * 增强：缓存失效策略，防止缓存雪崩
 * 新增：递归熵驱动缓存刷新支持（带递归判据的set/get）
 * 新增：多层级递归熵缓存、缓存命中/失效日志
 * 新增：缓存命中率统计与监控接口支持
 * 新增：通道/模式自适应TTL支持
 * 新增：递归熵判据与分形维度分析（论文算法应用点）
 * 新增：参数动态化与分片自适应（结合 dynamicParams）
 * 新增：分形维度驱动的自适应分片
 * 新增：Langevin噪声异常检测与Banach收敛判据
 * 优化：结合Ncrit递归终止、分形维数Df、实验数据驱动参数
 */

const redis = require('redis');
const { logOperation } = require("./models/operation_logs");
const { getParams } = require("./config/dynamicParams");

// ========== 分形维度分析工具 ==========
function boxCountingDimension(arr, boxSize = 10) {
  if (!Array.isArray(arr) || arr.length < 2) return 1;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;
  if (range === 0) return 1;
  const numBoxes = Math.ceil(range / boxSize);
  const boxes = new Set();
  for (const v of arr) {
    boxes.add(Math.floor((v - min) / boxSize));
  }
  return Math.log(boxes.size) / Math.log(numBoxes || 2);
}

// ========== Langevin噪声异常检测 ==========
function langevinNoise(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return 0;
  let noiseSum = 0;
  for (let i = 1; i < arr.length; i++) {
    noiseSum += Math.abs(arr[i] - arr[i - 1]);
  }
  return noiseSum / (arr.length - 1);
}

// ========== Banach收敛判据 ==========
function banachConverge(arr, lambda = 0.9) {
  // 判据：后续变化量 < lambda * 前一轮
  if (!Array.isArray(arr) || arr.length < 2) return true;
  for (let i = 1; i < arr.length; i++) {
    if (Math.abs(arr[i] - arr[i - 1]) > lambda * Math.abs(arr[i - 1])) {
      return false;
    }
  }
  return true;
}

// ========== 缓存命中率统计 ==========
const cacheStats = {
  redis: { hit: 0, miss: 0, set: 0, del: 0, expire: 0, clear: 0 },
  memory: { hit: 0, miss: 0, set: 0, del: 0, expire: 0, clear: 0 }
};

// ========== Redis 客户端 ==========
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
const memoryCacheTimers = new Map();

/**
 * 动态获取缓存TTL（结合 dynamicParams、通道阻尼比γr/γd）
 * @param {string} channelMode
 * @returns {number}
 */
function getDynamicTTL(channelMode) {
  const config = getParams();
  // 支持通道/模式阻尼比（如 reality/dream/user_day/user_night）
  let baseTTL = (config.cache && config.cache.defaultTTL) ? config.cache.defaultTTL : 60;
  if (config.channelDamping && channelMode && config.channelDamping[channelMode]) {
    // 例如 reality:1.0 dream:0.4
    baseTTL = Math.round(baseTTL * config.channelDamping[channelMode]);
  }
  return baseTTL;
}

/**
 * 动态获取分片数量（结合分形维度Df、Ncrit、熵、方差等多指标）
 * @param {Array} arr
 * @returns {number}
 */
function getDynamicShardCount(arr) {
  const config = getParams();
  const Df = boxCountingDimension(arr);
  let shard = config.cache.minShard || 1;
  // 结合分形维度
  if (Df > (config.cache.fractalThreshold || 1.5)) {
    shard = config.cache.maxShard || 8;
  }
  // 结合递归终止条件Ncrit
  if (Array.isArray(arr) && arr.length > 0 && config.ncritDelta) {
    let ncrit = 1;
    let prev = arr;
    for (let d = 0; d < (config.ncritMaxDepth || 8); d++) {
      const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
      const delta = Math.max(...prev) - Math.min(...prev);
      if (delta < config.ncritDelta) break;
      // 模拟递归分割
      prev = prev.filter(x => x > mean);
      ncrit++;
      if (prev.length < 2) break;
    }
    shard = Math.max(shard, ncrit);
  }
  // 可扩展：结合熵、方差等多指标
  return Math.min(Math.max(shard, config.cache.minShard || 1), config.cache.maxShard || 8);
}

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
 * @param {string} channelMode 通道/模式（可选）
 * @returns {Promise<void>}
 */
async function setCache(key, value, ttl, channelMode) {
  let effectiveTtl = ttl;
  if (!effectiveTtl) {
    effectiveTtl = getDynamicTTL(channelMode);
  }
  if (redisAvailable && redisClient) {
    try {
      if (effectiveTtl) {
        const jitter = Math.floor(Math.random() * Math.min(30, Math.floor(effectiveTtl / 10) || 1));
        await redisClient.setEx(key, effectiveTtl + jitter, JSON.stringify(value));
      } else {
        await redisClient.set(key, JSON.stringify(value));
      }
      cacheStats.redis.set++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_set",
        detail: JSON.stringify({ key, type: "redis", ttl: effectiveTtl, channelMode }),
        ip: ""
      }).catch(() => {});
      return;
    } catch (e) {
      // Redis 异常自动降级为内存
    }
  }
  memoryCache.set(key, value);
  if (effectiveTtl) {
    if (memoryCacheTimers.has(key)) {
      clearTimeout(memoryCacheTimers.get(key));
    }
    const jitter = Math.floor(Math.random() * Math.min(30000, Math.floor(effectiveTtl * 1000 / 10) || 1000));
    const timer = setTimeout(() => {
      memoryCache.delete(key);
      memoryCacheTimers.delete(key);
      cacheStats.memory.expire++;
      logOperation({
        user_id: 0,
        username: "system",
        action: "cache_expire",
        detail: JSON.stringify({ key, type: "memory", channelMode }),
        ip: ""
      }).catch(() => {});
    }, effectiveTtl * 1000 + jitter);
    memoryCacheTimers.set(key, timer);
  }
  cacheStats.memory.set++;
  logOperation({
    user_id: 0,
    username: "system",
    action: "cache_set",
    detail: JSON.stringify({ key, type: "memory", ttl: effectiveTtl, channelMode }),
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
 * 支持递归熵判据与分形维度分析（论文算法应用点）
 * 支持Langevin噪声异常检测与Banach收敛判据
 * 结合Ncrit递归终止、分形维数Df、实验数据驱动参数
 * @param {string} key
 * @param {function(): Promise<any>} fetchFn
 * @param {object} options { ttl, entropyJudge, maxDepth, channelMode, fractalJudge, langevinJudge, banachJudge }
 * @returns {Promise<any>}
 */
async function getOrRefreshCacheWithEntropy(key, fetchFn, options = {}) {
  const config = getParams();
  const {
    ttl = config.cache.defaultTTL || 60,
    entropyJudge,
    maxDepth = config.ncritMaxDepth || 1,
    channelMode,
    fractalJudge,
    langevinJudge,
    banachJudge
  } = options;
  let cached = await getCache(key);
  let needRefresh = false;
  let depth = 0;
  // 多层级递归判据
  while (depth < maxDepth) {
    if (cached && typeof entropyJudge === "function") {
      if (!entropyJudge(cached)) {
        needRefresh = true;
        break;
      }
    } else if (cached && typeof fractalJudge === "function") {
      if (!fractalJudge(cached)) {
        needRefresh = true;
        break;
      }
    } else if (cached && typeof langevinJudge === "function") {
      if (!langevinJudge(cached)) {
        needRefresh = true;
        break;
      }
    } else if (cached && typeof banachJudge === "function") {
      if (!banachJudge(cached)) {
        needRefresh = true;
        break;
      }
    } else if (!cached) {
      needRefresh = true;
      break;
    }
    // 结合Ncrit递归终止
    if (Array.isArray(cached) && config.ncritDelta) {
      let prev = cached;
      let ncrit = 1;
      for (let d = 0; d < (config.ncritMaxDepth || 8); d++) {
        const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
        const delta = Math.max(...prev) - Math.min(...prev);
        if (delta < config.ncritDelta) break;
        prev = prev.filter(x => x > mean);
        ncrit++;
        if (prev.length < 2) break;
      }
      if (ncrit > (config.ncritMaxDepth || 8)) {
        needRefresh = true;
        break;
      }
    }
    depth++;
    break;
  }
  if (needRefresh) {
    const fresh = await fetchFn();
    await setCache(key, fresh, ttl, channelMode);
    logOperation({
      user_id: 0,
      username: "system",
      action: "cache_refresh",
      detail: JSON.stringify({ key, depth, channelMode }),
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

/**
 * 监控接口：获取缓存参数与分片信息
 * @returns {object}
 */
function monitorCache() {
  const config = getParams();
  return {
    cacheStats: getCacheStats(),
    dynamicParams: config.cache || {},
    shardInfo: {
      minShard: config.cache.minShard || 1,
      maxShard: config.cache.maxShard || 8,
      currentShard: config.cache.currentShard || 1
    }
  };
}

// 导出分形维度工具，便于外部调用
module.exports = {
  initRedis,
  getCache,
  setCache,
  delCache,
  clearCache,
  getOrRefreshCacheWithEntropy,
  getCacheStats,
  boxCountingDimension, // 导出分形维度分析工具
  langevinNoise,       // 导出Langevin噪声
  banachConverge,     // 导出Banach收敛判据
  monitorCache // 导出监控接口
};