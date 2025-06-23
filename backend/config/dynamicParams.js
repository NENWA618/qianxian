/**
 * 动态参数集中管理模块
 * 支持运行时热更新，便于自适应限流、缓存、递归熵等参数统一管理与A/B测试
 * 可通过API接口动态调整，所有核心模块引用本文件参数
 * 新增：参数热更新时间戳、参数变更日志、参数重置功能
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
  langevinThreshold: 2.5,
  // 参数热更新元信息
  _meta: {
    lastUpdate: Date.now(),
    changeLog: []
  }
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
    langevinThreshold: 2.5
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
  getChangeLog,
  resetParams
};
