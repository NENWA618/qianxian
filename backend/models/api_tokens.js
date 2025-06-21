/**
 * API Token 表模型
 * 用于存储和管理用户的 API Token（如第三方集成、自动化等场景）
 * 增强：提供通用的Token管理方法，便于后端API调用
 * 安全增强：Token 只能由后端生成（高强度随机），不允许自定义，且只在创建时返回完整Token
 * 安全补充：数据库和日志仅存储完整token，任何查询/日志输出均需脱敏（前8后4），防止泄漏
 */

const { DataTypes, Op } = require("sequelize");
const sequelize = require("../db");
const crypto = require("crypto");

/**
 * api_tokens 表结构
 * - id: 主键
 * - user_id: 关联用户ID
 * - token: Token字符串（唯一）
 * - description: 用途描述
 * - created_at: 创建时间
 * - expired_at: 过期时间（可选）
 * - is_active: 是否有效
 */
const ApiToken = sequelize.define(
  "api_tokens",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expired_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  },
  {
    tableName: "api_tokens",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["token"] },
      { fields: ["is_active"] }
    ]
  }
);

/**
 * 生成高强度Token字符串
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex"); // 64位16进制
}

/**
 * 创建新Token（只能由后端生成，前端不能自定义token）
 * 返回完整token字符串，仅创建时返回
 * 日志/数据库仅存储完整token，任何日志输出需脱敏
 */
async function createToken({ user_id, description, expired_at }) {
  let token;
  // 保证唯一性（极低概率冲突，最多重试3次）
  for (let i = 0; i < 3; i++) {
    token = generateToken();
    const exists = await ApiToken.findOne({ where: { token } });
    if (!exists) break;
    if (i === 2) throw new Error("Token生成冲突，请重试");
  }
  const record = await ApiToken.create({
    user_id,
    token,
    description,
    expired_at,
    is_active: true
  });
  // 只返回完整token和部分字段
  return {
    id: record.id,
    token, // 完整token仅创建时返回
    description: record.description,
    created_at: record.created_at,
    expired_at: record.expired_at,
    is_active: record.is_active
  };
}

/**
 * 获取用户所有Token（只返回部分token字符串，防止泄漏）
 */
async function getUserTokens(user_id) {
  const tokens = await ApiToken.findAll({
    where: { user_id },
    order: [["created_at", "DESC"]]
  });
  // 只返回部分token（前8后4），完整token不再返回
  return tokens.map(t => ({
    id: t.id,
    token: maskToken(t.token),
    description: t.description,
    created_at: t.created_at,
    expired_at: t.expired_at,
    is_active: t.is_active
  }));
}

/**
 * 只显示部分token（前8后4）
 */
function maskToken(token) {
  if (!token || token.length < 12) return token;
  return token.slice(0, 8) + "..." + token.slice(-4);
}

/**
 * 失效/删除Token
 * 日志写入时请脱敏token
 */
async function deactivateToken(token, user_id) {
  // token参数为完整token，日志/操作建议脱敏
  return await ApiToken.update(
    { is_active: false },
    { where: { token, user_id } }
  );
}

/**
 * 校验Token有效性
 */
async function verifyToken(token) {
  const now = new Date();
  const found = await ApiToken.findOne({
    where: {
      token,
      is_active: true,
      [Op.or]: [
        { expired_at: null },
        { expired_at: { [Op.gt]: now } }
      ]
    }
  });
  return !!found;
}

module.exports = ApiToken;
module.exports.createToken = createToken;
module.exports.getUserTokens = getUserTokens;
module.exports.deactivateToken = deactivateToken;
module.exports.verifyToken = verifyToken;