/**
 * 头哥实验自动复制 - 主入口
 * 功能：自动登录、进入课程、查找未完成的实验
 */

// ============= 模块导入 =============
const { loadConfig } = require("./configManager");
const { initBrowser } = require("./browserInit");
const { login } = require("./login");
const { navigateToCourse } = require("./navigation");
const { findIncompleteLabs } = require("./labFinder");

// ============= 主入口函数 =============
/**
 * 主程序 - 协调所有业务逻辑
 */
async function main() {
  let browser = null;

  try {
    console.log("========================================");
    console.log("  头哥实验自动复制脚本 - 启动");
    console.log("========================================\n");

    // 1. 加载配置
    const config = loadConfig();

    // 2. 初始化浏览器
    const { browser: browserInstance, context } = await initBrowser(config);
    browser = browserInstance;

    // 3. 创建页面
    let page = await context.newPage();

    // 4. 执行登录
    console.log("\n--- 步骤 1: 用户登录 ---");
    await login(page, config);

    // 5. 导航到课程
    console.log("\n--- 步骤 2: 导航到课程 ---");
    // 更新 page 对象，因为导航可能会打开新标签页
    page = await navigateToCourse(page, config);

    // 6. 查找实验
    console.log("\n--- 步骤 3: 查找实验 ---");
    const { incomplete, completed, all } = await findIncompleteLabs(
      page,
      config
    );

    // 7. 输出结果
    console.log("\n========================================");
    console.log(`  📊 实验总数: ${all.length}`);
    console.log(`  ✅ 已完成:   ${completed.length}`);
    console.log(`  ⭕ 未完成:   ${incomplete.length}`);
    console.log("========================================");

    // 将未完成的实验赋值给 labs 变量以便后续（如果有）逻辑使用
    const labs = incomplete;

    // 注意：不关闭浏览器，保持页面打开以便用户查看
    console.log("\n✅ 脚本执行成功！浏览器已打开，保持连接...");
  } catch (error) {
    console.error("\n❌ 脚本执行失败:", error.message);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

// ============= 脚本执行 =============
main().catch((error) => {
  console.error("脚本执行过程中发生致命错误:", error);
  process.exit(1);
});
