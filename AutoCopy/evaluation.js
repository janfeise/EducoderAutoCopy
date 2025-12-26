/**
 * 测评与导航模块
 * 负责提交测评、检查结果和进入下一关
 */

/**
 * 提交测评
 * @param {Object} page 页面对象
 */
async function submitLab(page) {
  try {
    console.log("⏳ 点击测评按钮...");
    // 查找包含 "测评" 的按钮
    // 更新选择器: 匹配 .btn-run___fh7pl (带图标的按钮) 或 title="运行评测"
    const evalBtn = page
      .locator(
        ".btn-run___fh7pl, button[title='运行评测'], button:has-text('测评'), button:has-text('提交评测')"
      )
      .first();
    if (await evalBtn.isVisible()) {
      await evalBtn.click();
      console.log("✅ 已点击测评");
    } else {
      throw new Error("测评按钮不可见");
    }
  } catch (error) {
    console.error("❌ 找不到测评按钮");
    throw error;
  }
}

/**
 * 等待测评结果
 * @param {Object} page 页面对象
 * @returns {Promise<boolean>} 是否通关
 */
async function waitForEvaluationResult(page) {
  try {
    console.log("⏳ 等待测评结果...");
    // 等待 loading 消失
    // await page.waitForSelector(".loading", { state: 'hidden', timeout: 30000 }).catch(() => {});

    // 轮询检查结果，最多等待 60 秒
    // 成功标志：出现 "下一关" 按钮，或者提示 "恭喜"、"成功"、"全部通过"，或者出现评分弹窗
    // 失败标志：提示 "失败"、"错误"

    // 使用 Promise.race 监听多种情况
    // 注意：避免将 CSS 选择器和 text= 伪类混合在同一个字符串中，以免引发解析错误 (Unexpected token "=")

    const result = await Promise.race([
      // --- 成功情况 ---
      // 1. 明确的文本提示
      page
        .waitForSelector(".success-msg", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("text=恭喜", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("text=通关", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("text=正确", { timeout: 60000 })
        .then(() => "success"),

      // 2. 下一关按钮 (a.current 优先级最高)
      page
        .waitForSelector("a.current:has-text('下一关')", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("a.ghost-link___Y8dGm", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("a:has-text('下一关')", { timeout: 60000 })
        .then(() => "success"),
      page
        .waitForSelector("button:has-text('下一关')", { timeout: 60000 })
        .then(() => "success"),

      // 3. 评分弹窗 (表示已通过) - .evaluate-result-body
      page
        .waitForSelector(".evaluate-result-body", { timeout: 60000 })
        .then(() => "success"),

      // 4. "全部通过" 状态栏 - .test-result.success
      page
        .waitForSelector(".test-result.success:has-text('全部通过')", {
          timeout: 60000,
        })
        .then(() => "success"),

      // --- 失败情况 ---
      page.waitForSelector(".error-msg", { timeout: 60000 }).then(() => "fail"),
      page.waitForSelector("text=失败", { timeout: 60000 }).then(() => "fail"),
      page.waitForSelector("text=错误", { timeout: 60000 }).then(() => "fail"),

      // 超时 (通过 catch 处理)
    ]);

    if (result === "success") {
      console.log("✅ 测评通过！");
      return true;
    } else {
      console.warn("❌ 测评未通过");
      return false;
    }
  } catch (error) {
    console.warn("⚠️ 等待测评结果超时或未知状态:", error.message);
    // 再次尝试检查是否存在下一关按钮，以防万一
    const nextBtn = page
      .locator(
        "a.current:has-text('下一关'), a.ghost-link___Y8dGm, a:has-text('下一关')"
      )
      .first();
    if (await nextBtn.isVisible()) {
      console.log("✅ (超时后检查) 发现下一关按钮，判定为通过");
      return true;
    }
    return false;
  }
}

/**
 * 进入下一关
 * @param {Object} page 页面对象
 * @returns {Promise<boolean>} 是否成功进入下一关
 */
async function goToNextLab(page) {
  try {
    console.log("⏳ 尝试进入下一关...");

    // 1. 等待并关闭评价弹窗 (用户反馈: 必现弹窗)
    // 弹窗可能需要一点时间才会浮现
    try {
      console.log("⏳ 等待评价弹窗出现...");
      // 使用更精确的选择器匹配用户提供的结构: <a class="close-line"><i class="iconfont icon-roundclose"></i></a>
      const closeEvalBtn = await page.waitForSelector(
        "a.close-line, .icon-roundclose",
        { state: "visible", timeout: 15000 }
      );

      if (closeEvalBtn) {
        console.log("ℹ️ 检测到评价弹窗，正在关闭...");
        // 强制等待一下动画
        await page.waitForTimeout(500);
        await closeEvalBtn.click();

        // 等待弹窗消失 (遮罩层消失)
        await page
          .waitForSelector(".evaluate-result-body, .close-line", {
            state: "hidden",
            timeout: 5000,
          })
          .catch(() => {});
        console.log("✅ 评价弹窗已关闭");
        // 再次等待一小会儿确保遮罩层完全移除，避免阻挡点击
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // 超时说明没有弹窗，或者已经在之前被处理
      console.log("ℹ️ 等待弹窗超时 (可能未出现或已关闭)");
    }

    // 2. 查找下一关按钮或完成标志
    // 扩展选择器，并移除 .first()，改为遍历查找可见元素
    // 优先使用用户提供的特定类名
    const nextBtnSelectors = [
      // 完成标志 (优先级最高)
      { selector: "a.current:has-text('完成')", type: "complete" },
      { selector: "a:has-text('完成')", type: "complete" }, // 宽泛匹配

      // 下一关按钮
      { selector: "a.ghost-link___Y8dGm:has-text('下一关')", type: "next" }, // 用户提供的特定类名，优先级最高
      { selector: "div.tc a:has-text('下一关')", type: "next" },
      { selector: "a.current:has-text('下一关')", type: "next" },
      { selector: "a:has-text('下一关')", type: "next" },
      { selector: "button:has-text('下一关')", type: "next" },
    ];

    // 组合成一个 locator 并遍历
    // 由于 Playwright 的 locator 无法直接混合对象，我们需要手动遍历选择器列表
    console.log("ℹ️ 正在查找 [下一关] 按钮或 [完成] 标志...");

    for (const item of nextBtnSelectors) {
      const loc = page.locator(item.selector).first();
      try {
        if (await loc.isVisible()) {
          console.log(`✅ 找到可见元素: ${item.selector} (类型: ${item.type})`);

          if (item.type === "complete") {
            console.log("🎉 检测到 [完成] 标志，本实验已全部结束！");
            return "COMPLETED";
          }

          console.log("👉 点击下一关...");
          // 确保元素在视图中
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await loc.click();
          await page.waitForTimeout(5000); // 等待页面跳转
          console.log("✅ 已进入下一关");
          return true;
        }
      } catch (e) {}
    }

    console.log("ℹ️ 未找到可见的下一关按钮或完成标志");
    return false;
  } catch (error) {
    console.error("❌ 进入下一关失败:", error.message);
    return false;
  }
}

module.exports = {
  submitLab,
  waitForEvaluationResult,
  goToNextLab,
};
