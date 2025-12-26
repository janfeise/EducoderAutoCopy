/**
 * 登录模块
 * 负责用户登录逻辑
 */

const { safeClick, maskIdentifier } = require("./pageUtils");

/**
 * 登录到头哥实验平台
 * @param {Object} page Playwright 页面对象
 * @param {Object} config 配置对象
 * @param {Object} [credentials] 登录凭证 { username, password } (可选，覆盖 config)
 */
async function login(page, config, credentials = null) {
  try {
    console.log("⏳ 打开登录页面...");

    // 优先使用传入的凭证，否则使用 config 中的默认凭证
    const username = credentials
      ? credentials.username
      : config.educoder.username;
    const password = credentials
      ? credentials.password
      : config.educoder.password;
    const loginUrl = config.educoder.loginUrl;

    const clickTimeout = config.timeout.clickTimeout;
    const elementWait = config.timeout.elementWait;

    console.log(`👤 正在登录用户: ${maskIdentifier(username)}`);

    // 1. 检查当前是否已经在登录页面 (包含 /login 或 /passport)
    const currentUrl = page.url();
    let isLoginPage =
      currentUrl.includes("/login") || currentUrl.includes("/passport");

    if (!isLoginPage) {
      // 如果不在登录页，且没有传入 credentials (即首次运行)，尝试访问 loginUrl
      // 或者如果 loginUrl 本身就是登录页，直接访问
      if (loginUrl.includes("/login")) {
        await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
        isLoginPage = true;
      } else {
        // 访问首页并点击登录按钮
        await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
        console.log("✅ 首页已打开，准备点击登录按钮");

        // 点击登录按钮
        const loginBtnSelector = "span.ml10.mr5.current.c-white";
        try {
          await page.waitForSelector(loginBtnSelector, { timeout: 5000 });
          await safeClick(page, loginBtnSelector, clickTimeout);
        } catch (e) {
          console.warn(
            "⚠️ 未找到首页登录按钮，可能已在登录页或结构变化，尝试直接查找表单..."
          );
        }
      }
    } else {
      console.log("ℹ️ 当前已在登录页面，直接进行登录操作");
    }

    // 等待登录表单加载 (兼容弹窗和独立页面)
    // 独立页面通常没有 .ant-modal-content，直接找 #login
    console.log("⏳ 等待登录表单加载...");
    try {
      await Promise.race([
        page.waitForSelector(".ant-modal-content", { timeout: 5000 }), // 弹窗模式
        page.waitForSelector("#login", { state: "visible", timeout: 5000 }), // 独立页面模式
      ]);
    } catch (e) {
      console.warn("⚠️ 等待表单容器超时，尝试直接查找输入框");
    }

    // 尝试切换到"账号登录" Tab (以防默认是验证码登录或扫码登录)
    try {
      const accountTab = page
        .locator("div.ant-tabs-tab-btn:has-text('账号登录')")
        .first();
      if (await accountTab.isVisible()) {
        console.log("👉 切换到 '账号登录' 模式...");
        await accountTab.click();
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // 忽略，可能没有 Tab 或者已经是账号登录
    }

    await page
      .locator("#login")
      .waitFor({ state: "visible", timeout: elementWait });
    await page
      .locator("#password")
      .waitFor({ state: "visible", timeout: elementWait });
    console.log("✅ 登录表单已就绪");

    // 输入用户名和密码
    console.log("⏳ 输入用户名和密码...");
    await page.fill("#login", username);
    await page.fill("#password", password);
    await page.waitForTimeout(800);

    // 尝试点击登录按钮
    await clickLoginButton(page, elementWait);

    // 检测是否有滑块验证码或错误提示
    console.log("⏳ 检查登录结果...");
    const checkResult = await Promise.race([
      // 1. 成功标志
      page
        .waitForSelector(".ant-avatar", { state: "visible", timeout: 30000 })
        .then(() => "SUCCESS"),
      page
        .waitForURL(
          (url) => !url.includes("login") && !url.includes("passport"),
          { timeout: 30000 }
        )
        .then(() => "SUCCESS"),
      // 2. 错误提示
      page
        .waitForSelector(".ant-form-explain", {
          state: "visible",
          timeout: 30000,
        })
        .then(() => "ERROR"),
      page
        .waitForSelector(".ant-message-error", {
          state: "visible",
          timeout: 30000,
        })
        .then(() => "ERROR"),
      // 3. 滑块验证码 (Geetest or similar)
      page
        .waitForSelector(".geetest_widget", {
          state: "visible",
          timeout: 30000,
        })
        .then(() => "CAPTCHA"),
      page
        .waitForSelector("#captcha", { state: "visible", timeout: 30000 })
        .then(() => "CAPTCHA"),
    ]).catch(() => "TIMEOUT");

    if (checkResult === "CAPTCHA") {
      console.log("⚠️ 检测到验证码！请在浏览器中手动完成验证...");
      // 等待直到验证码消失或登录成功
      await Promise.race([
        page.waitForSelector(".geetest_widget", {
          state: "hidden",
          timeout: 60000,
        }),
        page.waitForSelector(".ant-avatar", {
          state: "visible",
          timeout: 60000,
        }),
        page.waitForURL((url) => !url.includes("login"), { timeout: 60000 }),
      ]);
      console.log("✅ 验证码处理可能已完成，继续等待跳转...");
    } else if (checkResult === "ERROR") {
      console.error("❌ 检测到登录错误提示 (如密码错误)");
      // 获取具体错误文本
      try {
        const errText = await page
          .locator(".ant-form-explain, .ant-message-error")
          .first()
          .textContent();
        console.error(`❌ 错误信息: ${errText}`);
      } catch (e) {}
      // 不抛出错误，而是暂停让用户处理
      console.log("⚠️ 请手动修正账号密码并登录...");
      await page.waitForTimeout(30000);
    }

    // 等待登录完成
    console.log("⏳ 最终验证登录状态...");
    try {
      // 只要满足以下任意一个条件，就认为登录成功：
      // 1. 登录框消失
      // 2. 出现头像
      // 3. 出现"我的实训"
      // 4. URL 不再包含 login
      await Promise.race([
        page.waitForSelector(".ant-modal-content", {
          state: "hidden",
          timeout: 60000,
        }),
        page.waitForSelector(".ant-avatar", {
          state: "visible",
          timeout: 60000,
        }),
        page.waitForSelector("text=我的实训", {
          state: "visible",
          timeout: 60000,
        }),
        page.waitForURL(
          (url) => !url.includes("login") && !url.includes("passport"),
          { timeout: 60000 }
        ),
      ]);
      console.log("✅ 验证通过：登录成功");
      // 额外等待一下，确保 Cookie 写入
      await page.waitForTimeout(2000);
    } catch (e) {
      console.warn("⚠️ 登录验证超时，可能登录未完成或网络延迟，尝试继续...");
    }
  } catch (error) {
    console.error("❌ 登录失败:", error.message);
    throw error;
  }
}

/**
 * 点击登录按钮 - 多种策略尝试
 * @param {Object} page Playwright 页面对象
 * @param {number} timeout 超时时间（毫秒）
 */
async function clickLoginButton(page, timeout) {
  const strategies = [
    {
      name: "CSS 选择器",
      locator: () => page.locator('button[type="submit"]'),
    },
    {
      name: "getByRole",
      locator: () => page.getByRole("button", { name: "登录" }),
    },
    {
      name: "文本选择器",
      locator: () => page.locator("button:has-text('登录')"),
    },
    {
      name: "class 选择器",
      locator: () => page.locator("button.ant-btn-primary"),
    },
  ];

  for (const strategy of strategies) {
    try {
      const locator = strategy.locator();
      await locator.waitFor({ state: "visible", timeout });
      console.log(`✅ 使用 ${strategy.name} 找到登录按钮`);
      await locator.click();
      return;
    } catch (e) {
      console.warn(`⚠️ 方法 (${strategy.name}) 失败`);
    }
  }

  // 所有方法都失败，进行调试
  console.error("❌ 所有方法都失败，进行调试...");
  const allButtons = await page.locator("button").all();
  console.log(`📋 页面中找到 ${allButtons.length} 个 button 元素`);

  for (let i = 0; i < Math.min(10, allButtons.length); i++) {
    const text = await allButtons[i].textContent();
    const type = await allButtons[i].getAttribute("type");
    const classes = await allButtons[i].getAttribute("class");
    console.log(
      `  - Button ${i}: type="${type}", text="${text.trim()}", class="${classes}"`
    );
  }

  throw new Error("登录失败：无法找到或点击登录按钮");
}

module.exports = {
  login,
};
