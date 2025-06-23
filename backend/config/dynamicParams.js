/**
 * 动态参数集中管理模块
 * 支持运行时热更新，便于自适应限流、缓存、递归熵等参数统一管理与A/B测试
 * 可通过API接口动态调整，所有核心模块引用本文件参数
 * 新增：参数热更新时间戳、参数变更日志、参数重置功能
 * 新增：A/B测试分组、前端参数快照接口、γc等参数支持
 * 优化：支持批量参数热更新、实验/监控数据驱动自进化
 */

const params = {
  // 限流判据
  betaCrit: 1.23,         // βcrit: 同步判据临界值（高负载时收紧限流/缓存）
  betaExit: 0.85,         // βexit: 去同步判据临界值（低于此值可提前放宽限流/缓存）
  // 临界阻尼参数
  gammaC: 2.0,            // γc: 临界阻尼系数（可用于限流、批量、动画等）
  // 通道/模式阻尼比（如 γr/γd，支持梦-现实通道/用户类型/场景自适应）
  channelDamping: {
    default: 1.0,
    user_day: 1.0,
    user_night: 0.7,
    guest_day: 1.2,
    guest_night: 0.8,
    admin: 0.5,
    // 可扩展更多通道，如 reality: 1.0, dream: 0.4
  },
  // 递归熵终止条件
  ncritDelta: 0.12,       // Ncrit判据阈值（递归终止条件，结合分形维度/熵）
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
  // Langevin噪声异常阈值（用于流量/递归异常检测）
  langevinThreshold: 2.5,
  langevinExit: 4.0,      // 新增：Langevin噪声解除限流阈值
  // 信息熵判据
  entropyCrit: 1.5,       // 新增：信息熵同步性判据
  // A/B测试分组（可用于参数实验，前端可只读）
  abTestGroup: "A", // "A" | "B" | "C" | ...
  // 参数热更新元信息
  _meta: {
    lastUpdate: Date.now(),
    changeLog: []
  }
};

/**
 * 获取参数快照（可安全暴露给前端，自动过滤敏感字段）
 * @param {boolean} forFrontend
 * @returns {object}
 */
function getParams(forFrontend = false) {
  const snapshot = JSON.parse(JSON.stringify(params));
  if (forFrontend) {
    // 过滤掉_meta等后端专用字段
    delete snapshot._meta;
  }
  return snapshot;
}

/**
 * 动态更新参数（支持嵌套key）
 * @param {string} key - 如 'betaCrit' 或 'cache.defaultTTL'
 * @param {any} value
 * @param {string} [operator] - 操作人（可选，便于审计）
 */
function setParam(key, value, operator = "system") {
  const keys = key.split(".");
  let obj = params;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj)) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  const oldValue = obj[keys[keys.length - 1]];
  obj[keys[keys.length - 1]] = value;
  // 记录变更日志
  if (params._meta && params._meta.changeLog) {
    params._meta.changeLog.push({
      key,
      oldValue,
      newValue: value,
      operator,
      time: Date.now()
    });
    // 最多保留100条
    if (params._meta.changeLog.length > 100) {
      params._meta.changeLog.shift();
    }
  }
  params._meta.lastUpdate = Date.now();
}

/**
 * 批量参数热更新（支持实验/监控数据自动推送）
 * @param {object} updates - { key1: value1, key2: value2, ... }
 * @param {string} [operator]
 */
function setParamsBatch(updates = {}, operator = "system") {
  if (typeof updates !== "object" || updates === null) return;
  for (const key in updates) {
    setParam(key, updates[key], operator);
  }
}

/**
 * 获取参数变更日志
 * @returns {Array}
 */
function getChangeLog() {
  return params._meta && params._meta.changeLog
    ? params._meta.changeLog.slice()
    : [];
}

/**
 * 重置所有参数为初始值
 * @param {string} [operator]
 */
function resetParams(operator = "system") {
  // 这里可根据实际需要调整为更细粒度的重置
  const initial = {
    betaCrit: 1.23,
    betaExit: 0.85,
    gammaC: 2.0,
    channelDamping: {
      default: 1.0,
      user_day: 1.0,
      user_night: 0.7,
      guest_day: 1.2,
      guest_night: 0.8,
      admin: 0.5
    },
    ncritDelta: 0.12,
    ncritMaxDepth: 8,
    cache: {
      minShard: 1,
      maxShard: 8,
      fractalThreshold: 1.5,
      entropyThreshold: 0.8,
      defaultTTL: 60,
      maxTTL: 300
    },
    langevinThreshold: 2.5,
    langevinExit: 4.0,
    entropyCrit: 1.5,
    abTestGroup: "A"
  };
  for (const k in initial) {
    params[k] = JSON.parse(JSON.stringify(initial[k]));
  }
  params._meta.lastUpdate = Date.now();
  if (params._meta && params._meta.changeLog) {
    params._meta.changeLog.push({
      key: "ALL",
      oldValue: "reset",
      newValue: "reset",
      operator,
      time: Date.now()
    });
    if (params._meta.changeLog.length > 100) {
      params._meta.changeLog.shift();
    }
  }
}

module.exports = {
  params,
  getParams,
  setParam,
  setParamsBatch,
  getChangeLog,
  resetParams
};
