/**
 * 导航模块
 * 负责页面导航逻辑，进入课程和实验页面
 */

const { safeClick } = require("./pageUtils");

/**
 * 进入指定课程的实验页面
 * @param {Object} page Playwright 页面对象
 * @param {Object} config 配置对象
 * @param {string} [directUrl] 可选：课程页面的直达URL
 * @returns {Promise<Object>} 返回当前活跃的页面对象 (可能是新标签页)
 */
async function navigateToCourse(page, config, directUrl = null) {
  try {
    const { courseName } = config.educoder;
    const clickTimeout = config.timeout.clickTimeout;
    const pageLoadTimeout = config.timeout.pageLoad;
    let activePage = page;

    // 优先使用直达URL (如果提供)
    if (directUrl) {
      console.log(`⏳ 检测到直达链接，正在跳转: ${directUrl}`);
      try {
        await page.goto(directUrl, { timeout: pageLoadTimeout });
        await page.waitForLoadState("networkidle");

        // 检查是否重定向到了登录页
        if (page.url().includes("login") || page.url().includes("passport")) {
          throw new Error("LOGIN_REQUIRED");
        }

        // 额外检查：页面上是否出现了登录框 (即使URL没变)
        // 有时候Educoder会在当前页面弹出登录框或加载登录组件
        try {
          const isLoginVisible =
            (await page.locator("input[type='password']").isVisible()) ||
            (await page
              .locator(".ant-tabs-tab:has-text('账号登录')")
              .isVisible()) ||
            (await page.locator("button:has-text('登录')").isVisible());

          if (isLoginVisible) {
            console.log("⚠️ 检测到页面包含登录元素，判断为需要登录");
            throw new Error("LOGIN_REQUIRED");
          }
        } catch (e) {
          if (e.message === "LOGIN_REQUIRED") throw e;
          // 忽略其他错误
        }

        // 等待页面容器加载
        await waitForPageContainer(page, config.timeout.elementWait);
        console.log("✅ 直达跳转成功");
        return page;
      } catch (e) {
        if (e.message === "LOGIN_REQUIRED") {
          throw e; // 直接抛出，由上层处理重登录
        }
        console.warn(`⚠️ 直达跳转失败 (${e.message})，尝试回退到 UI 导航...`);
        // 如果失败，回退到下面的 UI 导航逻辑
      }
    }

    // 关闭弹窗广告
    try {
      // 检查页面是否已关闭
      if (page.isClosed()) {
        throw new Error("Page closed");
      }

      const adWasClosed = await safeClick(page, ".close___PycHq", clickTimeout);
      if (adWasClosed) {
        console.log("✅ 广告弹窗已关闭");
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log("⚠️ 关闭弹窗时出错 (非致命):", e.message);
      // 继续执行，不要因为关不掉广告就停止
    }

    // 进入个人主页 / 我的课程
    console.log("⏳ 进入个人主页...");

    const homeStrategies = [
      {
        name: "原CSS选择器",
        selector: "section.ant-dropdown-trigger.height67___asp2E",
      },
      { name: "头像区域", selector: ".ant-avatar" },
      { name: "我的实训/课程", selector: "text=我的实训" },
      { name: "顶部导航-我的", selector: "li.nav-item > a[href*='/users/']" },
    ];

    let homeEntered = false;
    for (const strategy of homeStrategies) {
      if (await safeClick(page, strategy.selector, 3000)) {
        console.log(`✅ 成功点击: ${strategy.name}`);
        homeEntered = true;
        await page.waitForTimeout(1000);
        break;
      }
    }

    if (!homeEntered) {
      console.warn("⚠️ 无法通过点击进入个人主页，尝试直接查找课程...");
    }

    // 进入课程
    console.log(`⏳ 进入课程: ${courseName}...`);

    // 尝试更精确的课程卡片点击策略
    const courseStrategies = [
      // 1. 尝试点击课程名称链接 (根据调试日志推测的类名)
      {
        name: "课程名(class)",
        selector: `.name___Fpf90:has-text("${courseName}")`,
      },
      // 2. 尝试点击包含文本的任何链接
      { name: "课程链接", selector: `a:has-text("${courseName}")` },
      // 3. 尝试点击包含文本的任意元素 (回退)
      { name: "文本匹配", selector: `text=${courseName}` },
    ];

    let clicked = false;
    for (const strategy of courseStrategies) {
      console.log(
        `⏳ 尝试点击课程: ${strategy.name} (${strategy.selector})...`
      );

      // 监听新页面事件 (防止在新标签页打开)
      const pagePromise = page
        .context()
        .waitForEvent("page", { timeout: 3000 })
        .catch(() => null);

      if (await safeClick(page, strategy.selector, 3000)) {
        clicked = true;

        // 1. 检查是否有新页面打开
        const newPage = await pagePromise;
        if (newPage) {
          console.log("✅ 检测到新标签页打开，切换页面上下文...");
          await newPage.waitForLoadState();
          activePage = newPage;
          console.log(`新页面URL: ${activePage.url()}`);
          break;
        }

        // 2. 检查当前页面URL是否变化
        try {
          await page.waitForURL((url) => !url.includes("/users/"), {
            timeout: 5000,
          });
          console.log("✅ 页面URL已跳转 (当前标签页)");
          break;
        } catch (e) {
          console.warn("⚠️ 点击后URL未发生预期的跳转，尝试下一个策略...");
        }
      }
    }

    if (!clicked) {
      throw new Error(`无法找到或点击课程: ${courseName}`);
    }

    // 等待实验列表页面加载完成
    try {
      console.log("⏳ 等待实验列表页面加载 (networkidle)...");
      await activePage.waitForLoadState("networkidle", {
        timeout: pageLoadTimeout,
      });
      console.log("✅ 页面加载完成");
    } catch (e) {
      console.warn("⚠️ 实验列表页面加载超时，尝试继续执行...");
    }

    // 等待页面容器加载
    await waitForPageContainer(activePage, config.timeout.elementWait);
    await activePage.waitForTimeout(1000);

    console.log("✅ 成功进入课程页面");
    return activePage;
  } catch (error) {
    console.error("❌ 导航到课程失败:", error.message);
    throw error;
  }
}

/**
 * 等待页面容器加载 - 多种策略
 * @param {Object} page Playwright 页面对象
 * @param {number} timeout 超时时间（毫秒）
 */
async function waitForPageContainer(page, timeout) {
  console.log("⏳ 等待实验列表页面容器加载...");

  const strategies = [
    {
      name: "主容器",
      selector: "aside.edu-container",
    },
    {
      name: "右侧内容容器",
      selector: "main.ant-layout-content",
    },
    {
      name: "左侧菜单",
      selector: "section.leftMenu___aMBG9",
    },
    {
      name: "布局容器",
      selector: "div.ant-layout",
    },
  ];

  for (const strategy of strategies) {
    try {
      await page.locator(strategy.selector).first().waitFor({
        state: "visible",
        timeout,
      });
      console.log(`✅ ${strategy.name} 已加载`);
      return;
    } catch (e) {
      console.warn(`⚠️ ${strategy.name} 加载失败`);
    }
  }

  console.warn("⚠️ 所有容器检测都失败，但继续执行...可能页面已加载");
}

module.exports = {
  navigateToCourse,
};
