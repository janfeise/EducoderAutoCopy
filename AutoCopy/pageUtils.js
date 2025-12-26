/**
 * 页面工具模块
 * 提供通用的页面交互工具函数
 */

/**
 * 安全点击 - 如果元素在指定时间内未出现，则忽略错误并继续执行
 * @param {Object} page Playwright 页面对象
 * @param {string|Object} selectorOrLocator CSS 选择器或 Locator 对象
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<boolean>} 返回是否成功点击
 */
async function safeClick(page, selectorOrLocator, timeout = 5000) {
  let locator;
  let selectorDescription = selectorOrLocator;

  if (typeof selectorOrLocator === "string") {
    locator = page.locator(selectorOrLocator);
    selectorDescription = selectorOrLocator;
  } else if (
    selectorOrLocator &&
    typeof selectorOrLocator.click === "function"
  ) {
    locator = selectorOrLocator;
    selectorDescription = locator.toString() || "Playwright Locator";
  } else {
    console.error("❌ 错误：safeClick 接收到无效的定位器或选择器。");
    return false;
  }

  try {
    if (page.isClosed()) {
      console.warn(`⚠️ 页面已关闭，放弃点击: ${selectorDescription}`);
      return false;
    }

    console.log(`⏳ 尝试点击元素: ${selectorDescription} (超时: ${timeout}ms)`);
    await locator.click({ timeout });
    console.log(`✅ 成功点击元素: ${selectorDescription}`);
    return true;
  } catch (error) {
    if (
      page.isClosed() ||
      error.message.includes("Target page, context or browser has been closed")
    ) {
      console.warn(`⚠️ 页面已关闭，放弃点击: ${selectorDescription}`);
      return false;
    }

    if (error.name === "TimeoutError" || error.message.includes("Timeout")) {
      console.log(
        `⚠️ 元素 ${selectorDescription} 未在 ${timeout}ms 内出现或可点击，跳过操作。`
      );
      return false;
    } else {
      console.error(
        `❌ 点击元素 ${selectorDescription} 时发生意外错误:`,
        error.message
      );
      throw error;
    }
  }
}

function maskIdentifier(id) {
  if (!id) return "";
  const str = String(id);
  if (/^\d{11}$/.test(str)) {
    return `${str.slice(0, 3)}****${str.slice(-4)}`;
  }
  if (str.includes("@")) {
    const [local, domain] = str.split("@");
    const maskedLocal =
      local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
    return `${maskedLocal}@${domain}`;
  }
  if (str.length <= 2) return `*${str.slice(-1)}`;
  return `${str[0]}***${str.slice(-1)}`;
}

module.exports = {
  safeClick,
  maskIdentifier,
};
