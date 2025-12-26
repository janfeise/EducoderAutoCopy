/**
 * 实验查询模块
 * 负责查找和管理实验列表
 */

/**
 * 查找所有实验并按状态分类
 * @param {Object} page Playwright 页面对象
 * @param {Object} config 配置对象
 * @returns {Promise<Object>} 返回分类后的实验 { incomplete: [], completed: [], all: [] }
 */
async function findIncompleteLabs(page, config) {
  const timeout = config.timeout.elementWait;

  try {
    console.log(`⏳ 查找所有实验项目 (等待 ${timeout}ms)...`);

    // 尝试刷新页面以重新加载React组件
    console.log("🔄 刷新页面以确保React完全渲染...");
    await page.reload({ waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(2000);

    // 0. 尝试点击 "实训作业" Tab 并选择 "全部"
    // 用户反馈：点击实训作业后，需点击“全部”按钮才会加载使用
    try {
      console.log("⏳ 尝试切换到 '实训作业' 标签页...");
      const shixunTab = page
        .locator('div:has-text("实训作业")')
        .filter({ has: page.locator(".icon-shixunzuoye1") }) // 确保包含特定图标，更精准
        .first();

      if (await shixunTab.isVisible({ timeout: 5000 })) {
        await shixunTab.click();
        console.log("✅ 已点击 '实训作业' 标签页");
        await page.waitForTimeout(1000); // 等待二级菜单加载

        // 点击 "全部" 按钮
        // 选择器: li.ant-menu-item > span:has-text("全部")
        console.log("⏳ 尝试点击 '全部' 过滤器...");
        const allFilterBtn = page
          .locator("li.ant-menu-item")
          .filter({ hasText: /^全部$/ }) // 精确匹配 "全部"
          .first();

        if (await allFilterBtn.isVisible({ timeout: 3000 })) {
          await allFilterBtn.click();
          console.log("✅ 已点击 '全部' 按钮");
        } else {
          console.warn("⚠️ 未找到 '全部' 按钮，可能已选中或选择器不匹配");
        }
        await page.waitForTimeout(2000); // 等待列表内容刷新
      } else {
        // 备用策略：直接找文本
        const textTab = page.locator('div:has-text("实训作业")').last();
        if (await textTab.isVisible({ timeout: 3000 })) {
          await textTab.click();
          console.log("✅ 已点击 '实训作业' (文本匹配)");
          await page.waitForTimeout(1000);

          // 同样尝试点击 "全部"
          const allFilterBtn = page
            .locator("li.ant-menu-item")
            .filter({ hasText: /^全部$/ })
            .first();
          if (await allFilterBtn.isVisible({ timeout: 3000 })) {
            await allFilterBtn.click();
            console.log("✅ 已点击 '全部' 按钮 (备用流程)");
          }
          await page.waitForTimeout(2000);
        }
      }
    } catch (e) {
      console.warn("⚠️ 切换 '实训作业' 标签页失败或无需切换:", e.message);
    }

    // 定义多种查找策略
    const strategies = [
      { name: "原始类名", selector: ".listItem___Kb3j3" },
      { name: "模糊类名", selector: "div[class*='listItem']" },
      { name: "Ant Design列表项", selector: ".ant-list-item" },
      { name: "实验卡片", selector: ".ant-card" },
      { name: "表格行", selector: "tr.ant-table-row" },
    ];

    let labItemsLocator = null;
    let foundCount = 0;

    // 1. 尝试查找元素
    for (const strategy of strategies) {
      console.log(
        `⏳ 尝试使用策略: ${strategy.name} (${strategy.selector})...`
      );
      try {
        const locator = page.locator(strategy.selector);
        // 等待至少一个元素出现
        await locator
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .catch(() => {});

        const count = await locator.count();
        if (count > 0) {
          console.log(`✅ 策略 ${strategy.name} 成功，找到 ${count} 个元素`);
          labItemsLocator = locator;
          foundCount = count;
          break;
        }
      } catch (e) {
        console.warn(`⚠️ 策略 ${strategy.name} 失败`);
      }
    }

    // 2. 如果未找到，尝试切换到"提交中"
    if (foundCount === 0) {
      console.warn("⚠️ 未找到任何实验项目，尝试切换到'提交中'选项卡...");

      const tabSelector = '.ant-menu-item:has-text("提交中")';
      const tabExists = (await page.locator(tabSelector).count()) > 0;

      if (tabExists) {
        await page
          .locator(tabSelector)
          .click()
          .catch(() => null);
        await page.waitForTimeout(2000);

        // 再次尝试所有策略
        for (const strategy of strategies) {
          try {
            const locator = page.locator(strategy.selector);
            const count = await locator.count();
            if (count > 0) {
              console.log(
                `✅ (重试) 策略 ${strategy.name} 成功，找到 ${count} 个元素`
              );
              labItemsLocator = locator;
              foundCount = count;
              break;
            }
          } catch (e) {}
        }
      }
    }

    if (!labItemsLocator || foundCount === 0) {
      console.warn("❌ 最终未找到任何实验项目");
      return { incomplete: [], completed: [], all: [] };
    }

    // 3. 实验分类：已完成 vs 未完成
    console.log("⏳ 正在分析实验状态...");
    const allLabs = await labItemsLocator.all();
    const completedLabs = [];
    const incompleteLabs = [];

    for (const lab of allLabs) {
      // 检查是否存在 "已完成" 图标
      // 图标类名: iconfont icon-yiwancheng1
      const isCompleted =
        (await lab.locator(".iconfont.icon-yiwancheng1").count()) > 0;

      // 也可以检查文本内容辅助判断
      const text = await lab.innerText();
      // 简单的日志，可选
      // console.log(`  - 实验状态检查: ${isCompleted ? "✅ 已完成" : "⭕ 未完成"} | ${text.split('\n')[0].substring(0, 20)}...`);

      if (isCompleted) {
        completedLabs.push(lab);
      } else {
        incompleteLabs.push(lab);
      }
    }

    console.log(
      `📊 实验统计: 总数 ${allLabs.length} | ✅ 已完成 ${completedLabs.length} | ⭕ 未完成 ${incompleteLabs.length}`
    );

    // 为了兼容旧代码，这里我们可能需要决定返回什么
    // 但为了满足新需求，我们返回分类好的对象
    // 注意：这会破坏 educoderAutoCopy.js，因为它期望返回数组
    // 我们将修改 educoderAutoCopy.js 来适配
    return {
      all: allLabs,
      completed: completedLabs,
      incomplete: incompleteLabs,
    };
  } catch (error) {
    console.error("❌ 查找实验项目时发生错误:", error.message);
    return { incomplete: [], completed: [], all: [] };
  }
}

module.exports = {
  findIncompleteLabs,
};
