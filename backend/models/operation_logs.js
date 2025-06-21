/**
 * 操作日志表模型
 * 记录用户的关键操作，便于审计和追踪
 * 增强：支持记录限流、缓存命中/失效、批量任务等系统事件
 * 新增：导出 logOperation 通用日志写入函数，便于全局调用
 * 新增：定期归档与清理历史日志的辅助方法
 * 新增：支持“通道/模式”字段，便于多场景分析
 * 新增：日志敏感信息自动脱敏（如API Token，仅记录前8后4）
 */

const { DataTypes, Op } = require("sequelize");
const sequelize = require("../db");

/**
 * operation_logs 表结构
 * - id: 主键
 * - user_id: 操作用户ID（系统事件可为0）
 * - username: 操作用户名（冗余，便于查询，系统事件可为 'system'）
 * - action: 操作类型（如 login、register、edit_content、set_admin、rate_limit、cache_hit、cache_miss、batch_task 等）
 * - detail: 操作详情（JSON字符串或文本）
 * - ip: 操作IP
 * - channel_mode: 通道/模式（如 user_day_chat、admin_night_admin 等，便于多场景分析）
 * - created_at: 操作时间
 */
const OperationLog = sequelize.define(
  "operation_logs",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0 // 系统事件为0
    },
    username: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'system'
    },
    action: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    detail: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    channel_mode: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: null
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "operation_logs",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["action"] },
      { fields: ["created_at"] },
      { fields: ["channel_mode"] }
    ]
  }
);

/**
 * 脱敏API Token，仅保留前8后4
 * @param {string} token
 * @returns {string}
 */
function maskToken(token) {
  if (!token || token.length < 12) return token;
  return token.slice(0, 8) + "..." + token.slice(-4);
}

/**
 * detail字段敏感信息自动脱敏（如API Token）
 * 支持 detail 为字符串或对象
 */
function maskSensitiveDetail(action, detail) {
  // 针对API Token相关操作，自动脱敏token字段
  if (
    action &&
    typeof detail === "string" &&
    (action.includes("api_token") || action.includes("token"))
  ) {
    try {
      const obj = JSON.parse(detail);
      if (obj.token) obj.token = maskToken(obj.token);
      return JSON.stringify(obj);
    } catch {
      // 非JSON字符串，尝试正则替换
      return detail.replace(/[a-f0-9]{64}/gi, (t) => maskToken(t));
    }
  }
  if (
    action &&
    typeof detail === "object" &&
    detail !== null &&
    (action.includes("api_token") || action.includes("token"))
  ) {
    if (detail.token) detail.token = maskToken(detail.token);
    return JSON.stringify(detail);
  }
  return typeof detail === "object" ? JSON.stringify(detail) : detail;
}

/**
 * 通用操作日志写入函数
 * @param {object} param0
 * @param {number} [param0.user_id] 操作用户ID
 * @param {string} [param0.username] 操作用户名
 * @param {string} param0.action 操作类型
 * @param {string|object} [param0.detail] 操作详情
 * @param {string} [param0.ip] 操作IP
 * @param {string} [param0.channel_mode] 通道/模式
 * @returns {Promise<void>}
 */
async function logOperation({
  user_id = 0,
  username = 'system',
  action,
  detail = '',
  ip = '',
  channel_mode = null
}) {
  try {
    const safeDetail = maskSensitiveDetail(action, detail);
    await OperationLog.create({
      user_id,
      username,
      action,
      detail: safeDetail,
      ip,
      channel_mode,
      created_at: new Date()
    });
  } catch (err) {
    // 日志写入失败不抛出，仅打印
    console.error('操作日志写入失败:', err);
  }
}

/**
 * 定期归档与清理历史日志
 * @param {Date} beforeDate 删除该日期之前的日志
 * @param {string} [channel_mode] 可选，按通道/模式分组归档
 * @returns {Promise<number>} 删除的日志条数
 */
async function archiveAndCleanLogs(beforeDate, channel_mode = null) {
  try {
    const where = {
      created_at: {
        [Op.lt]: beforeDate
      }
    };
    if (channel_mode) {
      where.channel_mode = channel_mode;
    }
    // 可扩展为导出到文件/表后再删除
    const count = await OperationLog.destroy({ where });
    return count;
  } catch (err) {
    console.error('日志归档/清理失败:', err);
    return 0;
  }
}

module.exports = OperationLog;
module.exports.logOperation = logOperation;
module.exports.archiveAndCleanLogs = archiveAndCleanLogs;