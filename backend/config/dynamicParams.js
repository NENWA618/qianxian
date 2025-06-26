/**
 * 动态参数集中管理模块
 * 支持运行时热更新，便于自适应限流、缓存、递归熵等参数统一管理与A/B测试
 * 可通过API接口动态调整，所有核心模块引用本文件参数
 * 新增：参数热更新时间戳、参数变更日志、参数重置功能
 * 新增：A/B测试分组、前端参数快照接口、γc等参数支持
 * 优化：支持批量参数热更新、实验/监控数据驱动自进化
 * 新增：支持缓存预热相关参数
 * 新增：参数变更权限控制与操作审计
 * 
 * 2025-06-26 优化：
 * - Ncrit/递归熵参数细化，支持更多场景（如分页、批量、推送）
 * - Langevin/Banach判据参数补充
 * - 支持实验数据/EEG参数自动校准
 * - 参数分组更细粒度，便于A/B测试和多通道自适应
 */

const { logOperation } = require("../models/operation_logs");

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
    reality: 1.0,   // 新增：现实通道
    dream: 0.4      // 新增：梦通道
  },
  // 递归熵终止条件（Ncrit判据，支持多场景）
  ncrit: {
    delta: 0.12,         // Ncrit判据阈值（递归终止条件，结合分形维度/熵）
    maxDepth: 8,         // 最大递归深度
    forPaging: {         // 分页专用
      delta: 0.10,
      maxDepth: 6
    },
    forBatch: {          // 批量任务专用
      delta: 0.15,
      maxDepth: 10
    },
    forPush: {           // 推送/Socket专用
      delta: 0.18,
      maxDepth: 5
    }
  },
  // 缓存分片与TTL
  cache: {
    minShard: 1,
    maxShard: 8,
    fractalThreshold: 1.5, // 分形维度阈值，超过则细分分片
    entropyThreshold: 0.8, // 熵阈值，低于则加大分片
    defaultTTL: 60,        // 默认缓存TTL（秒）
    maxTTL: 300,
    // 新增：热点数据预热配置
    preheatKeys: [
      "members:list",
      "site:content"
    ]
  },
  // Langevin噪声异常阈值（用于流量/递归异常检测）
  langevin: {
    threshold: 2.5,      // 异常检测阈值
    exit: 4.0            // 解除限流阈值
  },
  // Banach收敛判据
  banach: {
    lambda: 0.9,         // 收敛系数
    minSteps: 3,         // 最小收敛步数
    maxSteps: 10         // 最大收敛步数
  },
  // 信息熵判据
  entropyCrit: 1.5,       // 信息熵同步性判据
  // A/B测试分组（可用于参数实验，前端可只读）
  abTestGroup: "A", // "A" | "B" | "C" | ...
  // 实验/EEG参数映射（可自动校准）
  eegMapping: {
    gammaR: 2.5,         // γr（现实通道）
    gammaD: 1.0,         // γd（梦通道）
    ncritREM: 22,        // REM阶段Ncrit
    entropyREM: 0.5      // REM阶段熵速率
  },
  // 参数热更新元信息
  _meta: {
    lastUpdate: Date.now(),
    changeLog: []
  }
};

/**
 * 权限校验辅助（仅管理员及以上可变更参数）
 * @param {object} operatorInfo - { user_id, username, is_admin, is_super_admin }
 * @returns {boolean}
 */
function canChangeParams(operatorInfo) {
  if (!operatorInfo) return false;
  // 超管或管理员
  return !!(operatorInfo.is_super_admin || operatorInfo.is_admin);
}

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
 * 动态更新参数（支持嵌套key，支持多级如 'ncrit.forPaging.delta'）
 * @param {string} key - 如 'betaCrit' 或 'cache.defaultTTL' 或 'ncrit.forPaging.delta'
 * @param {any} value
 * @param {object|string} [operator] - 操作人信息或用户名（建议传对象，便于权限校验和审计）
 * @throws {Error} 无权限时抛出
 */
function setParam(key, value, operator = "system") {
  // 权限校验
  if (typeof operator === "object" && !canChangeParams(operator)) {
    throw new Error("无权限修改参数");
  }
  const operatorName = typeof operator === "object" ? operator.username : operator;
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
      operator: operatorName,
      time: Date.now()
    });
    // 最多保留100条
    if (params._meta.changeLog.length > 100) {
      params._meta.changeLog.shift();
    }
  }
  params._meta.lastUpdate = Date.now();
  // 操作审计日志
  if (operatorName && operatorName !== "system" && typeof logOperation === "function") {
    logOperation({
      user_id: typeof operator === "object" ? operator.user_id : 0,
      username: operatorName,
      action: "param_update",
      detail: JSON.stringify({ key, oldValue, newValue: value }),
      channel_mode: null
    });
  }
}

/**
 * 批量参数热更新（支持实验/监控数据自动推送）
 * @param {object} updates - { key1: value1, key2: value2, ... }
 * @param {object|string} [operator]
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
 * @param {object|string} [operator]
 */
function resetParams(operator = "system") {
  if (typeof operator === "object" && !canChangeParams(operator)) {
    throw new Error("无权限重置参数");
  }
  const operatorName = typeof operator === "object" ? operator.username : operator;
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
      admin: 0.5,
      reality: 1.0,
      dream: 0.4
    },
    ncrit: {
      delta: 0.12,
      maxDepth: 8,
      forPaging: { delta: 0.10, maxDepth: 6 },
      forBatch: { delta: 0.15, maxDepth: 10 },
      forPush: { delta: 0.18, maxDepth: 5 }
    },
    cache: {
      minShard: 1,
      maxShard: 8,
      fractalThreshold: 1.5,
      entropyThreshold: 0.8,
      defaultTTL: 60,
      maxTTL: 300,
      preheatKeys: [
        "members:list",
        "site:content"
      ]
    },
    langevin: {
      threshold: 2.5,
      exit: 4.0
    },
    banach: {
      lambda: 0.9,
      minSteps: 3,
      maxSteps: 10
    },
    entropyCrit: 1.5,
    abTestGroup: "A",
    eegMapping: {
      gammaR: 2.5,
      gammaD: 1.0,
      ncritREM: 22,
      entropyREM: 0.5
    }
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
      operator: operatorName,
      time: Date.now()
    });
    if (params._meta.changeLog.length > 100) {
      params._meta.changeLog.shift();
    }
  }
  // 操作审计日志
  if (operatorName && operatorName !== "system" && typeof logOperation === "function") {
    logOperation({
      user_id: typeof operator === "object" ? operator.user_id : 0,
      username: operatorName,
      action: "param_reset",
      detail: JSON.stringify({
        key: "ALL",
        oldValue: "reset",
        newValue: "reset"
      }),
      channel_mode: null
    });
  }
}

module.exports = {
  params,
  getParams,
  setParam,
  setParamsBatch,
  getChangeLog,
  resetParams,
  canChangeParams
};
