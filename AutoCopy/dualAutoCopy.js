/**
 * 双人自动复制脚本 - 主入口
 * 功能：同时操作两个账号，将已完成账号的实验代码复制到未完成账号
 */

const { loadConfig } = require("./configManager");
const { initBrowser } = require("./browserInit");
const { login } = require("./login");
const { navigateToCourse } = require("./navigation");
const { findIncompleteLabs } = require("./labFinder");
const sessionReporter = require("./sessionReporter");
const {
  getLabContent,
  pasteLabContent,
  enterExperimentLevel,
  switchToLevel,
  checkLabLocked,
} = require("./labInteraction");
const {
  submitLab,
  waitForEvaluationResult,
  goToNextLab,
} = require("./evaluation");

async function countdownWait(label, ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  console.log(`⏱ ${label}，总等待: ${ms}ms (${totalSeconds}s)`);
  for (let s = totalSeconds; s >= 1; s--) {
    console.log(`⏳ 倒计时: ${s}s`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("✅ 等待结束");
}

async function openLabDetail(page, labName) {
  console.log("⏳ 打开实验详情:", labName);
  const strategies = [
    `.listItem___Kb3j3:has(.name___CCaOX:text-is("${labName}")) .titleLeft___iZ9Qh`,
    `.listItem___Kb3j3:has-text("${labName}") .titleLeft___iZ9Qh`,
    `.listItem___Kb3j3:has-text("${labName}")`,
    `.flexBox____AlDk:has-text("开始学习")`,
    `a[href*="detail?tabs=1"]:has-text("${labName}")`,
    `a[href*="detail?tabs=1"]`,
  ];
  let active = page;
  for (const sel of strategies) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      console.log(`⏳ 尝试点击: ${sel}`);

      // 在每次点击前重新设置监听器
      const pagePromise = page
        .context()
        .waitForEvent("page", { timeout: 8000 })
        .catch(() => null);

      await loc.click();

      const newPage = await pagePromise;
      if (newPage) {
        console.log("✅ 详情在新标签页打开");
        await newPage.waitForLoadState();
        active = newPage;
      } else {
        // 如果没有新标签页，等待当前页面可能发生的跳转
        await page.waitForTimeout(2000);
      }

      try {
        await active.waitForURL(/detail/, { timeout: 8000 });
        console.log("✅ 已进入详情页:", active.url());
        return active;
      } catch (e) {
        console.log("⚠️ URL 未匹配详情页，继续尝试其他策略");
        // 如果之前切换到了新页面但不是详情页，重置 active 为原页面以便重试
        active = page;
      }
    } catch (e) {
      console.log(`⚠️ 点击失败: ${sel} - ${e.message}`);
    }
  }
  throw new Error("无法进入实验详情页");
}

async function main() {
  let browser = null;

  try {
    console.log("========================================");
    console.log("  👥 头哥双人自动复制脚本 - 启动");
    console.log("========================================\n");

    // 1. 加载配置
    const config = loadConfig();
    const levelWaitMs =
      (config.timeout && config.timeout.levelWait) !== undefined
        ? config.timeout.levelWait
        : 2000;
    console.log(`⏱ 每关等待时间: ${levelWaitMs}ms`);

    // 用户指定的课程直达链接
    // 由于不同课程导航方式不同，这里记录特定课程的 URL 以便快速跳转和返回
    const COURSE_URL =
      "https://www.educoder.net/classrooms/4M9R2KEK/shixun_homework";

    const sourceCreds = {
      username: config.educoder.completeUsername,
      password: config.educoder.completePassword,
    };
    const targetCreds = {
      username: config.educoder.username,
      password: config.educoder.password,
    };

    // 辅助函数：带重登录机制的导航
    const navigateWithRetry = async (page, creds, directUrl = null) => {
      try {
        return await navigateToCourse(page, config, directUrl);
      } catch (e) {
        if (e.message === "LOGIN_REQUIRED") {
          const { maskIdentifier } = require("./pageUtils");
          console.log(
            `⚠️ 检测到会话失效 (用户: ${maskIdentifier(
              creds.username
            )})，正在重新登录...`
          );
          await login(page, config, creds);
          return await navigateToCourse(page, config, directUrl);
        }
        throw e;
      }
    };

    // 2. 初始化浏览器 (启动一个浏览器实例)
    const { browser: browserInstance } = await initBrowser(config);
    browser = browserInstance;

    // 3. 创建两个独立的上下文
    console.log("\n--- 步骤 0: 初始化双环境 ---");
    const contextSource = await browser.newContext();
    const contextTarget = await browser.newContext();

    // 监听 console 日志
    const setupConsoleListener = (ctx, label) => {
      ctx.on("page", (page) => {
        page.on("console", (msg) => {
          if (msg.text().startsWith("[Browser]")) {
            console.log(`${label} ${msg.text()}`);
          }
        });
      });
    };
    setupConsoleListener(contextSource, "🔵 [来源Browser]");
    setupConsoleListener(contextTarget, "🔴 [目标Browser]");

    const pageSource = await contextSource.newPage();
    const pageTarget = await contextTarget.newPage();

    // 4. 并行登录
    console.log("\n--- 步骤 1: 双账号登录 ---");
    await Promise.all([
      (async () => {
        console.log("🔵 [来源账号] 开始登录...");
        await login(pageSource, config, sourceCreds);
        console.log("🔵 [来源账号] 登录成功");
      })(),
      (async () => {
        console.log("🔴 [目标账号] 开始登录...");
        await login(pageTarget, config, targetCreds);
        console.log("🔴 [目标账号] 登录成功");
      })(),
    ]);

    // 5. 并行导航到课程
    console.log("\n--- 步骤 2: 导航到课程 ---");
    // 注意：navigateToCourse 可能会返回新的 page 对象（如果打开了新标签页）
    let activeSourcePage = pageSource;
    let activeTargetPage = pageTarget;

    await Promise.all([
      (async () => {
        console.log("🔵 [来源账号] 进入课程...");
        // 第一次进入课程，不使用直达URL，而是走正常导航流程
        activeSourcePage = await navigateWithRetry(
          pageSource,
          sourceCreds,
          null
        );
      })(),
      (async () => {
        console.log("🔴 [目标账号] 进入课程...");
        // 第一次进入课程，不使用直达URL，而是走正常导航流程
        activeTargetPage = await navigateWithRetry(
          pageTarget,
          targetCreds,
          null
        );
      })(),
    ]);

    // 6. 确定起始位置
    console.log("\n--- 步骤 3: 同步实验进度 ---");

    // 外层循环：遍历所有实验
    let experimentLoopCount = 0;
    while (true) {
      experimentLoopCount++;
      console.log(`\n📚 === 开始处理第 ${experimentLoopCount} 个实验任务 ===`);

      // 在目标账号中查找未完成的实验
      const { incomplete } = await findIncompleteLabs(activeTargetPage, config);

      if (incomplete.length === 0) {
        console.log("🎉 目标账号没有未完成的实验！脚本结束。");
        break;
      }

      const firstIncompleteLab = incomplete[0];

      // 优化：更精确地获取实验名称
      // 尝试在元素内部查找标题元素，避免获取到状态文本
      let labName = "";
      try {
        // 使用用户提供的类名 .name___CCaOX
        const titleEl = firstIncompleteLab.locator(".name___CCaOX").first();
        if ((await titleEl.count()) > 0) {
          labName = await titleEl.innerText();
        } else {
          // 回退到查找其他可能的标题元素
          const backupEl = firstIncompleteLab
            .locator("h3, .name, .title, a[title]")
            .first();
          if ((await backupEl.count()) > 0) {
            labName = await backupEl.innerText();
          } else {
            const fullText = await firstIncompleteLab.innerText();
            labName = fullText.split("\n")[0].trim();
          }
        }
      } catch (e) {
        const fullText = await firstIncompleteLab.innerText();
        labName = fullText.split("\n")[0].trim();
      }

      // 清理名称中的多余空格
      labName = labName.trim();

      console.log(`🎯 目标起始实验: ${labName}`);
      sessionReporter.startExperiment(labName);

      console.log("⏳ 正在进入起始实验详情...");
      const [srcDetail, tgtDetail] = await Promise.all([
        openLabDetail(activeSourcePage, labName),
        openLabDetail(activeTargetPage, labName),
      ]);
      activeSourcePage = srcDetail;
      activeTargetPage = tgtDetail;

      // 增加：进入实验的具体关卡
      // 因为进入实验详情页后，通常还需要点击 "开始实训" 或选择具体关卡
      console.log("\n--- 步骤 3.5: 进入实验关卡 ---");
      console.log("⏳ 正在尝试进入关卡界面...");

      // 我们尝试并行进入，且默认尝试进入第1关或点击"开始实训"
      const [srcLevelPage, tgtLevelPage] = await Promise.all([
        enterExperimentLevel(activeSourcePage, 1),
        enterExperimentLevel(activeTargetPage, 1),
      ]);
      activeSourcePage = srcLevelPage;
      activeTargetPage = tgtLevelPage;

      // 再次等待加载，确保进入编辑器
      await Promise.all([
        activeSourcePage.waitForLoadState("networkidle"),
        activeTargetPage.waitForLoadState("networkidle"),
      ]);

      // 强制同步到第 1 关
      console.log("⏳ 强制同步到第 1 关，确保两个账号在同一关卡...");
      await Promise.all([
        switchToLevel(activeSourcePage, 1),
        switchToLevel(activeTargetPage, 1),
      ]);

      // 7. 循环执行实验 (内层循环：关卡)
      console.log("\n--- 步骤 4: 开始自动做题循环 (实验内关卡) ---");
      let currentLabIndex = 1;

      while (true) {
        console.log(`\n🔹 --- 当前处理第 ${currentLabIndex} 个任务 ---`);
        await countdownWait("开始处理当前关卡前缓冲", levelWaitMs);

        // A. 从来源获取代码
        const codeResult = await getLabContent(activeSourcePage);

        // 新增：检查目标账号是否被锁定
        if (await checkLabLocked(activeTargetPage)) {
          console.log("⚠️ 目标账号当前关卡未解锁，放弃本实验...");
          sessionReporter.endExperiment("LOCKED");
          break;
        }

        // 检查是否需要跳过当前关卡
        if (codeResult && codeResult.skipped) {
          if (codeResult.reason === "LEVEL_LOCKED") {
            console.log("⚠️ 来源账号检测到关卡未解锁，放弃本实验...");
            sessionReporter.endExperiment("LOCKED");
            break;
          }

          console.log(
            `⏭️ 当前关卡无需代码复制 (${codeResult.reason})，准备跳过并进入下一关...`
          );
          sessionReporter.recordLevel(
            currentLabIndex,
            "SKIPPED",
            codeResult.reason
          );

          // 直接执行“进入下一关”逻辑
          // 注意：这里我们假设跳过的关卡不需要提交测评，直接点下一关
          // 但通常这种关卡需要手动操作，脚本无法完成。用户指示“直接跳过，进入下一个关卡”。
          // 这意味着我们不管当前关卡是否完成，强行尝试切换到下一关。

          const nextLabIndex = currentLabIndex + 1;

          // 尝试切换到下一关
          const [sourceNext, targetNextResult] = await Promise.all([
            switchToLevel(activeSourcePage, nextLabIndex),
            switchToLevel(activeTargetPage, nextLabIndex), // 目标也尝试直接切换，而不是点下一关(因为没有测评通过弹窗)
          ]);

          if (!targetNextResult) {
            // 如果无法切换到下一关（可能是最后一关，或者因为当前关卡未完成被限制？）
            // 如果是 EduCoder 限制必须完成才能下一关，那脚本卡住是预期的，因为无法完成命令行操作。
            // 但如果用户说“跳过”，可能意味着他想放弃这个关卡，或者这些关卡其实是可以直接点下一关的（如阅读类）。
            // 另一种可能是：目标账号其实也需要点“下一关”按钮（如果存在）。

            // 尝试点击下一关按钮作为备选
            console.log(
              "👉 无法直接切换Level，尝试查找并点击 '下一关' 按钮..."
            );
            const btnResult = await goToNextLab(activeTargetPage);
            if (btnResult === "COMPLETED" || !btnResult) {
              console.log("🎉 当前实验已结束或全部跳过。");
              sessionReporter.endExperiment("COMPLETED_SKIP");
              break;
            }
          }

          // 如果成功切换，更新索引并继续
          currentLabIndex++;
          await countdownWait("进入下一关前缓冲", levelWaitMs);
          continue;
        }

        const code = codeResult; // 正常代码内容

        // B. 写入目标
        await pasteLabContent(activeTargetPage, code);

        // C. 提交测评
        await submitLab(activeTargetPage);

        // D. 等待结果
        const isSuccess = await waitForEvaluationResult(activeTargetPage);

        if (!isSuccess) {
          console.warn(
            "❌ 测评失败，记录状态并尝试进入下一关 (根据用户策略)..."
          );
          sessionReporter.recordLevel(currentLabIndex, "FAILED", "测评未通过");
          // 不退出，继续执行下方的进入下一关逻辑
        } else {
          sessionReporter.recordLevel(currentLabIndex, "PASSED");
          // E. 进入下一关或完成
          console.log("✅ 测评通过，准备进入下一关或结束实验...");
        }

        // 计算下一关的索引
        const nextLabIndex = currentLabIndex + 1;

        // 并行操作：
        // 1. 来源账号 (已完成)：直接切换到下一关 (使用 switchToLevel 更快，无需等待弹窗检测)
        // 2. 目标账号 (未完成)：点击下一关按钮 (需要处理测评通过后的弹窗，并检查是否已完成)
        // 3. 如果测评失败，目标账号可能没有 "下一关" 按钮，此时尝试直接切换 switchToLevel
        const [sourceNext, targetNextResult] = await Promise.all([
          switchToLevel(activeSourcePage, nextLabIndex),
          goToNextLab(activeTargetPage),
        ]);

        // 检查目标账号的状态
        if (targetNextResult === "COMPLETED") {
          console.log("🎉 当前实验已全部完成！准备返回课程列表...");
          sessionReporter.endExperiment("COMPLETED");
          break; // 跳出内层循环 (关卡循环)，回到外层循环 (实验循环)
        }

        let finalTargetResult = targetNextResult;

        // 如果 goToNextLab 失败 (可能因为没通过测评没按钮)，尝试强制切换
        if (!targetNextResult) {
          console.log(
            "⚠️ 目标账号未找到下一关按钮 (可能因测评失败)，尝试强制切换关卡..."
          );
          finalTargetResult = await switchToLevel(
            activeTargetPage,
            nextLabIndex
          );
        }

        if (!finalTargetResult) {
          console.log("🎉 目标账号已无下一关，结束本实验。");
          sessionReporter.endExperiment("COMPLETED_OR_STUCK");
          break; // 跳出内层循环
        }

        // 如果目标还有下一关，但来源切换失败
        if (!sourceNext) {
          console.warn(
            `⚠️ 来源账号无法切换到第 ${nextLabIndex} 关（可能已是最后一关）。`
          );
          // 尝试让来源账号也点击 "下一关" 按钮作为备选
          console.log("👉 尝试让来源账号点击 '下一关' 按钮作为备选...");
          const sourceNextBtn = await goToNextLab(activeSourcePage);
          // 来源账号如果完成了，可能也是显示 "完成" 或者就没有按钮了
          // 这里不做严格限制，只要目标账号能继续就行
        }

        // 等待加载
        await Promise.all([
          activeSourcePage.waitForLoadState("networkidle"),
          activeTargetPage.waitForLoadState("networkidle"),
        ]);

        // 简单延迟，模拟人类（可配置）
        await countdownWait("下一关加载完成后的缓冲", levelWaitMs);
        currentLabIndex++;
      } // 内层循环结束

      console.log("🔙 正在返回课程列表，准备查找下一个实验...");
      // 返回课程列表页，使用直达链接
      await Promise.all([
        navigateWithRetry(activeSourcePage, sourceCreds, COURSE_URL),
        navigateWithRetry(activeTargetPage, targetCreds, COURSE_URL),
      ]);

      // 更新 activePage，虽然 navigateToCourse 可能会复用页面，但以防万一
      // 注意：navigateToCourse 内部会处理页面跳转逻辑

      // 稍微等待列表刷新
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } // 外层循环结束

    console.log("\n========================================");
    console.log("  ✅ 双人自动复制脚本执行完毕");
    console.log("========================================");

    // 输出统计报告
    sessionReporter.generateReport();
  } catch (error) {
    console.error("\n❌ 脚本执行发生错误:", error);
    sessionReporter.generateReport();
    if (browser) {
      // await browser.close(); // 出错时不关闭，方便调试
    }
  }
}

main().catch(console.error);
