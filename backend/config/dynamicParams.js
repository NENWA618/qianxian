/**
 * 动态参数集中管理模块
 * 支持运行时热更新，便于自适应限流、缓存、递归熵等参数统一管理与A/B测试
 * 可通过API接口动态调整，所有核心模块引用本文件参数
 */

const params = {
  // 限流判据
  betaCrit: 1.23,         // βcrit: 同步判据临界值
  betaExit: 0.85,         // βexit: 去同步判据临界值
  // 通道/模式阻尼比（如 γr/γd）
  channelDamping: {
    default: 1.0,
    user_day: 1.0,
    user_night: 0.7,
    guest_day: 1.2,
    guest_night: 0.8,
    admin: 0.5
  },
  // 递归熵终止条件
  ncritDelta: 0.12,       // Ncrit判据阈值
  ncritMaxDepth: 8,       // 最大递归深度
  // 缓存分片与TTL
  cache: {
    minShard: 1,
    maxShard: 8,
    fractalThreshold: 1.5, // 分形维度阈值，超过则细分分片
    entropyThreshold: 0.8, // 熵阈值，低于则加大分片
    defaultTTL: 60,        // 默认缓存TTL（秒）
    maxTTL: 300
  },
  // Langevin噪声异常阈值
  langevinThreshold: 2.5
};

/**
 * 获取参数快照
 */
function getParams() {
  return JSON.parse(JSON.stringify(params));
}

/**
 * 动态更新参数（支持嵌套key）
 * @param {string} key - 如 'betaCrit' 或 'cache.defaultTTL'
 * @param {any} value
 */
function setParam(key, value) {
  const keys = key.split(".");
  let obj = params;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj)) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
}

module.exports = {
  params,
  getParams,
  setParam
};
