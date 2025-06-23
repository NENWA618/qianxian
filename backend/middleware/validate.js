/**
 * 统一参数校验中间件
 * 用于 express-validator 校验结果的统一处理
 * 用法：在路由参数校验后加 validate.handleValidationErrors
 */

const { validationResult } = require("express-validator");

/**
 * 处理 express-validator 校验错误
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // 返回第一个错误信息，或全部错误信息
    return res.status(400).json({
      success: false,
      message: "参数校验失败",
      errors: errors.array().map(e => ({
        param: e.param,
        msg: e.msg
      }))
    });
  }
  next();
}

module.exports = {
  handleValidationErrors
};