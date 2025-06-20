/**
 * API Token 表模型
 * 用于存储和管理用户的 API Token（如第三方集成、自动化等场景）
 * 增强：提供通用的Token管理方法，便于后端API调用
 */

const { DataTypes, Op } = require("sequelize");
const sequelize = require("../db");

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
 * 创建新Token
 */
async function createToken({ user_id, token, description, expired_at }) {
  return await ApiToken.create({
    user_id,
    token,
    description,
    expired_at,
    is_active: true
  });
}

/**
 * 获取用户所有Token
 */
async function getUserTokens(user_id) {
  return await ApiToken.findAll({
    where: { user_id },
    order: [["created_at", "DESC"]]
  });
}

/**
 * 失效/删除Token
 */
async function deactivateToken(token, user_id) {
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