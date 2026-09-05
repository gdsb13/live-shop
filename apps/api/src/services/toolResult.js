'use strict';

function recoverableToolError(code, message, extra = {}) {
  return {
    success: false,
    code,
    message,
    ...extra,
  };
}

module.exports = {
  recoverableToolError,
};
