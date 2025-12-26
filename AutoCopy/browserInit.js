/**
 * 浏览器初始化模块
 * 负责浏览器和上下文的初始化
 */

const { chromium } = require("playwright");

/**
 * 初始化浏览器和上下文
 * @param {Object} config 配置对象
 * @returns {Promise<Object>} 返回 { browser, context }
 */
async function initBrowser(config) {
  try {
    console.log("⏳ 初始化浏览器...");
    const browser = await chromium.launch({
      headless: config.browser.headless,
    });
    const context = await browser.newContext();
    console.log("✅ 浏览器初始化成功");
    return { browser, context };
  } catch (error) {
    console.error("❌ 浏览器初始化失败:", error.message);
    throw error;
  }
}

module.exports = {
  initBrowser,
};
