/**
 * 实验交互模块
 * 负责代码的获取与写入、进入关卡、切换关卡
 */

/**
 * 获取实验编辑器中的代码
 * @param {Object} page 页面对象
 * @returns {Promise<string>} 代码内容
 */
async function getLabContent(page) {
  try {
    console.log("⏳ 正在获取实验代码...");
    await page.waitForTimeout(5000); // 等待编辑器完全加载

    // 0. 特殊情况检测：
    // 如果没有“评测”按钮，或者属于特殊关卡，则跳过
    const skipReason = await page.evaluate(() => {
      // 1. 检查是否存在“评测”按钮
      // 策略：查找含有“评测”文字的按钮或特定类名
      // Educoder 的评测按钮通常有 id="submit_code_btn" 或 class="submit-code-btn"
      const hasSubmitBtn =
        document.querySelector("#submit_code_btn") ||
        document.querySelector(".submit-code-btn") ||
        Array.from(document.querySelectorAll("button")).some((b) =>
          b.innerText.includes("评测")
        );

      if (!hasSubmitBtn) {
        return "NO_EVALUATION_BUTTON";
      }

      // 2. 之前的特殊文本检测（作为补充）
      const bodyText = document.body.innerText;

      // 情况一：请在右侧命令行中直接操作
      if (
        document.querySelector("span.mtk1") &&
        document
          .querySelector("span.mtk1")
          .innerText.includes("请在右侧命令行中直接操作")
      ) {
        return "COMMAND_LINE_ONLY";
      }

      // 情况二：点击上方按钮，启动实验环境
      const pTags = Array.from(document.querySelectorAll("p"));
      const envStartText = pTags.find((p) =>
        p.innerText.includes("点击上方按钮，启动实验环境")
      );
      if (envStartText) {
        return "ENV_START_REQUIRED";
      }

      // 情况三：关卡未解锁（需完成上一关）
      if (
        bodyText.includes("完成上一关才能解锁") ||
        bodyText.includes("上一关未完成")
      ) {
        return "LEVEL_LOCKED";
      }

      return null;
    });

    if (skipReason) {
      console.log(`⚠️ 检测到无需评测关卡 (${skipReason})，跳过代码复制`);
      return { skipped: true, reason: skipReason };
    }

    // 0.5 检测是否为选择题关卡
    const isChoiceQuestion = await page
      .locator(".choose-container")
      .isVisible()
      .catch(() => false);
    if (isChoiceQuestion) {
      console.log("📝 检测到选择题关卡，正在提取答案...");
      const answers = await extractChoiceAnswers(page);
      return { type: "CHOICE", answers };
    }

    // 等待编辑器加载
    await page
      .waitForSelector(".monaco-editor, .CodeMirror, .view-lines", {
        timeout: 10000,
      })
      .catch(() => console.log("⚠️ 等待编辑器选择器超时"));

    // 尝试多种方式获取代码: API -> Clipboard -> DOM (Fallback)
    // 1. 尝试通过编辑器 API 获取 (最准确)
    let code = await extractCodeViaApi(page);

    // 2. 如果 API 失败，尝试模拟剪贴板操作 (Ctrl+A -> Ctrl+C)
    // 这能解决 DOM 提取因虚拟滚动导致代码不全的问题
    if (!code) {
      code = await extractCodeViaClipboard(page);
    }

    // 3. 如果都失败，尝试 DOM 抓取 (作为最后的兜底，可能只获取部分代码)
    if (!code) {
      console.log("⚠️ API 和剪贴板获取均失败，尝试 DOM 抓取 (可能不完整)...");
      code = await extractCodeViaDom(page);
    }

    // 如果主页面没找到，遍历所有 iframe
    if (!code) {
      console.log("⚠️ 主页面未找到编辑器，尝试遍历 iframe...");
      const frames = page.frames();
      for (const frame of frames) {
        try {
          // Frame 策略: API -> Clipboard
          let frameCode = await extractCodeViaApi(frame);
          if (!frameCode) {
            frameCode = await extractCodeViaClipboard(frame);
          }
          // Frame DOM 抓取通常效果不佳且慢，暂不优先尝试，除非必要

          if (frameCode) {
            console.log(`✅ 在 iframe (${frame.url()}) 中找到代码`);
            code = frameCode;
            break;
          }
        } catch (e) {
          // 忽略跨域或其他 frame 访问错误
        }
      }
    }

    if (code) {
      console.log(`✅ 成功获取代码 (${code.length} 字符)`);
      return code;
    } else {
      throw new Error("无法找到编辑器实例或代码内容");
    }
  } catch (error) {
    console.error("❌ 获取代码失败:", error.message);
    throw error;
  }
}

/**
 * 策略1：通过编辑器 API 提取代码 (最推荐)
 */
async function extractCodeViaApi(context) {
  return context.evaluate(() => {
    // 1. 尝试 Monaco Editor API
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      if (models.length > 0) {
        return models[0].getValue();
      }
    }

    // 2. 尝试 CodeMirror API
    const cmElement = document.querySelector(".CodeMirror");
    if (cmElement && cmElement.CodeMirror) {
      return cmElement.CodeMirror.getValue();
    }

    return null;
  });
}

/**
 * 策略3：DOM 抓取 (兜底，可能受虚拟滚动影响)
 */
async function extractCodeViaDom(context) {
  return context.evaluate(() => {
    // 3. 通用 DOM 提取 (Monaco/CodeMirror 的 DOM 结构)
    // 针对 Monaco Editor 的 view-lines 结构
    // 优先选择可见的编辑器容器
    const editors = Array.from(document.querySelectorAll(".monaco-editor"));
    // 查找所有可见的编辑器 (offsetParent !== null)
    const visibleEditors = editors.filter((e) => e.offsetParent !== null);

    // 如果有多个可见编辑器，我们可能需要判断哪一个是主要的
    // 通常高度最大的那个是主代码编辑区
    let targetEditor = null;
    if (visibleEditors.length > 0) {
      targetEditor = visibleEditors.reduce((prev, current) => {
        return prev.clientHeight > current.clientHeight ? prev : current;
      });
    } else {
      targetEditor = editors[0];
    }

    let viewLines;
    if (targetEditor) {
      viewLines = targetEditor.querySelectorAll(".view-lines .view-line");
    } else {
      viewLines = document.querySelectorAll(".view-lines .view-line");
    }

    if (viewLines && viewLines.length > 0) {
      // DEBUG: 打印排序前的状态
      console.log(`[Browser] Found ${viewLines.length} view-lines`);
      const firstLine = viewLines[0];
      console.log(
        `[Browser] First line style.top: "${
          firstLine.style.top
        }", computed top: "${window.getComputedStyle(firstLine).top}"`
      );

      // Monaco Editor 的 DOM 元素可能是乱序的（基于 top 绝对定位）
      // 必须根据 top 属性进行排序
      const sortedLines = Array.from(viewLines).sort((a, b) => {
        // 使用 getComputedStyle 获取更可靠的 top 值
        const styleA = window.getComputedStyle(a);
        const styleB = window.getComputedStyle(b);
        const topA = parseInt(styleA.top || "0", 10);
        const topB = parseInt(styleB.top || "0", 10);
        return topA - topB;
      });

      return sortedLines
        .map((line) => {
          // 使用 textContent 以避免 innerText 自动去除行首空格或处理样式导致的缩进丢失
          // Monaco Editor 的 view-line 结构通常是纯文本的 span 组合，textContent 更能保留原始空白符
          let text = line.textContent;
          return text.replace(/\u00A0/g, " ");
        })
        .join("\n");
    }

    const editorLine = document.querySelector(".view-lines");
    if (editorLine) {
      return editorLine.textContent.replace(/\u00A0/g, " ");
    }

    return null;
  });
}

/**
 * 尝试通过模拟键盘操作获取代码 (Ctrl+A -> Ctrl+C)
 * @param {Object} context Page 或 Frame 对象
 */
async function extractCodeViaClipboard(context) {
  try {
    const page = context.page ? context.page() : context;
    console.log("尝试通过剪贴板获取代码 (Ctrl+A -> Ctrl+C)...");

    // 1. 确保有剪贴板权限
    const browserContext = page.context();
    await browserContext
      .grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => {});

    // 2. 聚焦编辑器
    // 必须确保点击的是当前 context (Page or Frame) 内的元素
    const selector = ".monaco-editor, .CodeMirror, .view-lines";
    const element = await context.$(selector);
    if (!element) {
      console.log("⚠️ 剪贴板提取跳过: 未找到编辑器元素");
      return null;
    }

    await element.click();
    await page.waitForTimeout(500);

    // 3. 全选并复制
    // 使用 element.press 而不是 page.keyboard.press，以确保焦点正确
    // 如果页面有其他可聚焦元素，可能需要更精确的点击
    await element.press("Control+A");
    await page.waitForTimeout(300);
    await element.press("Control+C");
    await page.waitForTimeout(500);

    // 4. 读取剪贴板
    const code = await page.evaluate(() => navigator.clipboard.readText());

    if (code && code.trim().length > 0) {
      console.log(`✅ 剪贴板提取成功 (${code.length} 字符)`);
      return code;
    }
  } catch (e) {
    console.log("⚠️ 剪贴板提取尝试失败: " + e.message);
  }
  return null;
}

/**
 * 将代码或答案写入实验
 * @param {Object} page 页面对象
 * @param {string|Object} content 代码内容或答案对象
 */
async function pasteLabContent(page, content) {
  try {
    // 1. 处理选择题答案
    if (typeof content === "object" && content.type === "CHOICE") {
      console.log("📝 正在填写选择题答案...");
      const answers = content.answers;

      let targetContext = page;
      let containerFound = false;

      // 1.1 优先检查主页面
      try {
        await page.waitForSelector("ul.choose-container", {
          state: "visible",
          timeout: 5000,
        });
        containerFound = true;
      } catch (e) {
        // 主页面未找到，不打印警告，继续检查 iframe
      }

      // 1.2 如果主页面未找到，检查 iframe
      if (!containerFound) {
        console.log("ℹ️ 主页面未找到选择题容器，尝试查找 iframe...");
        const frames = page.frames();
        for (const frame of frames) {
          try {
            // 检查 iframe 中是否可见
            const isVisible = await frame
              .locator("ul.choose-container")
              .isVisible();
            if (isVisible) {
              console.log(`✅ 在 iframe (${frame.url()}) 中找到选择题容器`);
              targetContext = frame;
              containerFound = true;
              break;
            }
          } catch (e) {
            // 忽略跨域或 frame 访问错误
          }
        }
      }

      // 1.3 如果都未找到，打印详细调试信息
      if (!containerFound) {
        console.warn(
          "⚠️ 等待选择题容器 (ul.choose-container) 超时，页面可能未正确加载"
        );
        // 尝试打印当前页面的一些信息以便调试
        const bodyText = await page.evaluate(() =>
          document.body.innerText.substring(0, 200)
        );
        console.log(`Debug: 页面前200字符: ${bodyText.replace(/\n/g, " ")}`);
        // 尝试查找是否存在 .subject-body (题目内容)，可能结构不同
        const hasSubject = await page.locator(".subject-body").count();
        if (hasSubject > 0) {
          console.log(
            "Debug: 发现 .subject-body 元素，可能容器选择器不匹配或层级变化"
          );
        }
      }

      // 遍历每个题目
      for (const ans of answers) {
        const { questionIndex, selectedOptions } = ans;
        console.log(
          `   - 第 ${questionIndex + 1} 题，选择选项: [${selectedOptions.join(
            ", "
          )}]`
        );

        // 定位到该题目的选项容器
        // 注意：Playwright 的 nth 是从 0 开始的
        const questionItem = targetContext
          .locator("ul.choose-container > li")
          .nth(questionIndex);

        // 确保该题目可见
        await questionItem
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {
            console.warn(`⚠️ 第 ${questionIndex + 1} 题容器未在 5s 内可见`);
          });

        for (const optIndex of selectedOptions) {
          // 定位具体的选项 label
          // .option > a.flex-container > label
          const optionLabel = questionItem
            .locator(
              ".option .ant-checkbox-wrapper, .option .ant-radio-wrapper"
            )
            .nth(optIndex);

          // 增加等待，确保元素存在
          try {
            await optionLabel.waitFor({ state: "attached", timeout: 5000 });
          } catch (e) {
            console.warn(
              `⚠️ 无法找到选项 ${optIndex} (第 ${questionIndex + 1} 题)`
            );
            continue;
          }

          // 检查是否已经选中，如果已选中则跳过（避免反选），如果是单选可能需要强制点击
          // 先简单地点击。如果是 checkbox，点击已选中的会取消选中。
          // 所以我们需要先检查当前状态。
          const isChecked = await optionLabel.evaluate((el) => {
            return (
              el.classList.contains("ant-checkbox-wrapper-checked") ||
              el.classList.contains("ant-radio-wrapper-checked") ||
              el.classList.contains("checked")
            );
          });

          if (!isChecked) {
            await optionLabel.click();
            await page.waitForTimeout(200); // 稍作等待
          }
        }
      }
      console.log("✅ 选择题填写完成");
      return;
    }

    // 2. 处理代码写入
    const code = content;
    console.log("⏳ 正在写入代码...");

    // 确保编辑器可见
    await page
      .click(".monaco-editor, .CodeMirror, .view-lines")
      .catch(() => {});
    await page.waitForTimeout(500);

    // 尝试在主页面或 iframe 中通过 API 写入
    // 逻辑：优先尝试主页面，失败则遍历 iframe
    let success = await writeCodeViaApi(page, code);

    if (!success) {
      console.log("⚠️ 主页面 API 写入失败，尝试遍历 iframe...");
      const frames = page.frames();
      for (const frame of frames) {
        try {
          if (await writeCodeViaApi(frame, code)) {
            console.log(`✅ 在 iframe (${frame.url()}) 中 API 写入成功`);
            success = true;
            break;
          }
        } catch (e) {
          // 忽略跨域错误
        }
      }
    }

    if (success) {
      console.log("✅ 代码写入成功");
    } else {
      console.warn(
        "⚠️ 无法通过 API 写入，尝试模拟键盘输入 (可能存在缩进问题)..."
      );
      // 尝试使用 Clipboard API + Paste 以减少缩进问题 (需要浏览器权限支持)
      try {
        // 尝试授权剪贴板写权限 (仅 Chrome/Edge)
        const context = page.context();
        await context
          .grantPermissions(["clipboard-read", "clipboard-write"])
          .catch(() => {});

        // DEBUG: 打印即将写入剪贴板的内容预览
        const debugLines = code
          .split("\n")
          .slice(0, 5)
          .map((line) => line.replace(/ /g, "·"));
        console.log("🐛 [DEBUG] 剪贴板写入预览:\n" + debugLines.join("\n"));

        // 确保再次聚焦编辑器，防止焦点丢失
        await page
          .click(".monaco-editor, .CodeMirror, .view-lines")
          .catch(() => {});
        await page.waitForTimeout(300);

        await page.evaluate(
          (text) => navigator.clipboard.writeText(text),
          code
        );
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Control+V");
        console.log("✅ 模拟粘贴 (Clipboard+Ctrl+V) 完成");
      } catch (clipboardError) {
        console.warn(
          "⚠️ 剪贴板操作失败，回退到逐字输入:",
          clipboardError.message
        );
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.insertText(code);
        console.log("✅ 模拟输入 (insertText) 完成");
      }
    }

    await page.waitForTimeout(1000);
  } catch (error) {
    console.error("❌ 写入代码失败:", error.message);
    throw error;
  }
}

/**
 * 辅助函数：通过 API 写入代码
 */
async function writeCodeViaApi(context, codeContent) {
  return context.evaluate((code) => {
    try {
      // DEBUG: 检查环境
      console.log(`[Browser] Checking editor in ${window.location.href}`);

      // 1. Monaco Editor
      if (window.monaco && window.monaco.editor) {
        console.log("[Browser] Found window.monaco");
        const models = window.monaco.editor.getModels();
        console.log(`[Browser] Monaco models count: ${models.length}`);
        if (models.length > 0) {
          models[0].setValue(code);
          return true;
        }
      } else {
        console.log("[Browser] window.monaco not found");
      }

      // 2. CodeMirror
      const cmElement = document.querySelector(".CodeMirror");
      if (cmElement) {
        console.log("[Browser] Found .CodeMirror element");
        if (cmElement.CodeMirror) {
          cmElement.CodeMirror.setValue(code);
          return true;
        } else {
          console.log(
            "[Browser] .CodeMirror element has no CodeMirror property"
          );
        }
      }

      return false;
    } catch (e) {
      console.error("[Browser] writeCodeViaApi error:", e);
      return false;
    }
  }, codeContent);
}

/**
 * 进入实验关卡
 * @param {Object} page 页面对象
 * @param {number} levelIndex 关卡索引 (从 1 开始)
 * @returns {Promise<Object>} 返回进入后的页面对象 (可能是新页面)
 */
async function enterExperimentLevel(page, levelIndex = 1) {
  // console.log(`⏳ 正在尝试进入实验界面...`); // Removed verbose log
  await page.waitForTimeout(3000); // 等待页面稳定

  // 监听新页面
  const context = page.context();
  let newPage = null;
  const pageHandler = (p) => {
    // console.log("⚠️ 检测到新页面创建 (在 enterExperimentLevel 中)"); // Removed verbose log
    newPage = p;
  };
  context.on("page", pageHandler);

  try {
    // 1. 检查是否已经在编辑器页面
    const isAlreadyInEditor = await page.evaluate(() => {
      return !!(
        document.querySelector(".monaco-editor") ||
        document.querySelector(".CodeMirror") ||
        document.querySelector(".view-lines")
      );
    });

    if (isAlreadyInEditor) {
      // console.log("✅ 检测到已在编辑器页面，无需跳转"); // Removed verbose log
      context.off("page", pageHandler);
      return page;
    }

    // 2. 尝试点击 "继续挑战" / "查看实战"
    // 策略 1: 结构化段落 (高优先级)
    // 未完成: <aside class="rightMenu___pcK7x"><p><span class="iconfont icon-kaiqizhong"></span>继续挑战</p></aside>
    const continueChallengeP = page
      .locator('p:has(.iconfont.icon-kaiqizhong):has-text("继续挑战")')
      .first();
    if (
      (await continueChallengeP.count()) > 0 &&
      (await continueChallengeP.isVisible())
    ) {
      // console.log("✅ 发现结构化 '继续挑战' 段落，点击进入..."); // Removed verbose log
      await continueChallengeP.click();
      return await handleNewPage();
    }

    // 已完成: <p><span class="iconfont icon-kaiqizhong"></span>查看实战</p>
    const viewPracticeP = page
      .locator('p:has(.iconfont.icon-kaiqizhong):has-text("查看实战")')
      .first();
    if (
      (await viewPracticeP.count()) > 0 &&
      (await viewPracticeP.isVisible())
    ) {
      // console.log("✅ 发现结构化 '查看实战' 段落，点击进入..."); // Removed verbose log
      await viewPracticeP.click();
      return await handleNewPage();
    }

    // 策略 2: 文本搜索 (放宽条件)
    const targetTexts = ["继续挑战", "查看实战", "开始实训", "继续实训"];
    for (const text of targetTexts) {
      const elements = page.getByText(text);
      const count = await elements.count();
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const el = elements.nth(i);
          if (await el.isVisible()) {
            // console.log(`✅ 发现文本 "${text}" (第 ${i + 1} 个)，尝试点击...`); // Removed verbose log
            await el.click();
            return await handleNewPage();
          }
        }
      }
    }

    // 策略 3: 右侧菜单/Icon
    const rightMenu = page.locator(".rightMenu___pcK7x").first();
    if (await rightMenu.isVisible()) {
      // console.log("✅ 发现右侧菜单 (.rightMenu___pcK7x)，点击..."); // Removed verbose log
      await rightMenu.click();
      return await handleNewPage();
    }

    // 3. 辅助函数：处理可能的页面跳转
    async function handleNewPage() {
      await page.waitForTimeout(5000); // 增加等待时间，确保新页面加载
      if (newPage) {
        // console.log("🔄 切换到新打开的关卡页面..."); // Removed verbose log
        await newPage.waitForLoadState("networkidle");
        await newPage.bringToFront();
        return newPage;
      } else {
        await page.waitForLoadState("networkidle");
        return page;
      }
    }

    console.warn("⚠️ 未找到明显的入口按钮，假设已在详情页或无需点击");
    return page;
  } catch (error) {
    console.error("❌ 进入关卡失败:", error);
    return page;
  } finally {
    context.off("page", pageHandler);
  }
}

/**
 * 切换到指定关卡
 * @param {Object} page 页面对象
 * @param {number} levelIndex 关卡索引 (从 1 开始)
 * @returns {Promise<boolean>} 是否成功切换
 */
async function switchToLevel(page, levelIndex) {
  // console.log(`🔄 尝试切换到第 ${levelIndex} 关...`); // Removed verbose log

  try {
    // 优化：优先检查当前页面是否已经是目标关卡
    // 查找包含 "第X关" 的 h3 标签
    const currentLevelTitle = page
      .locator("h3")
      .filter({ hasText: `第${levelIndex}关` })
      .first();

    if (await currentLevelTitle.isVisible()) {
      // console.log(`✅ 检测到页面标题包含 "第${levelIndex}关"，无需切换或打开任务列表`); // Removed verbose log
      return true;
    }

    // 检查任务列表是否可见，如果不可见则点击 "查看全部任务" 按钮
    const taskListVisible = await page.isVisible(".task-item-container");
    if (!taskListVisible) {
      // console.log("ℹ️ 任务列表不可见，尝试打开任务抽屉..."); // Removed verbose log
      // 匹配 title="查看全部任务" 的 a 标签，或使用图标类名
      const viewAllBtn = page
        .locator(
          'a[title="查看全部任务"], .icon-gongnengliebiao, .icon-bars, .task-list-trigger'
        )
        .first();

      if (await viewAllBtn.isVisible()) {
        await viewAllBtn.click();
        // console.log("👉 点击了 '查看全部任务' 按钮"); // Removed verbose log
        // 等待抽屉打开 (等待 .task-item-container 出现)
        await page
          .waitForSelector(".task-item-container", {
            state: "visible",
            timeout: 5000,
          })
          .catch(() => {
            // console.log("⚠️ 等待任务列表出现超时"); // Removed verbose log
          });
      } else {
        // console.log("⚠️ 未找到 '查看全部任务' 按钮，尝试直接查找任务列表"); // Removed verbose log
        // 尝试通过 text=查看全部任务
        const textBtn = page.locator("text=查看全部任务").first();
        if (await textBtn.isVisible()) {
          await textBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    await page
      .waitForSelector(".task-item-container", { timeout: 5000 })
      .catch(() => {});

    // 获取所有 task-item-container
    const taskItems = page.locator(".task-item-container");
    const count = await taskItems.count();
    // console.log(`   - 找到 ${count} 个任务项`); // Removed verbose log

    if (count === 0) {
      console.warn("⚠️ 未找到任务列表 (.task-item-container)");
      return false;
    }

    // 策略 1: 尝试通过文本匹配 "1. ", "2. " 等
    for (let i = 0; i < count; i++) {
      const item = taskItems.nth(i);
      // 查找内部的 a 标签，它包含了关卡名称，例如 "1. 距离度量"
      const link = item.locator("a").first();
      const text = await link.innerText().catch(() => item.innerText());

      // 匹配 "1. 距离度量" 这种格式
      // 或者 "第1关"
      // 使用正则进行更严格的匹配，防止 "1. " 匹配到 "11. "
      const regex = new RegExp(`(^|\\s)${levelIndex}\\.|第${levelIndex}关`);
      if (regex.test(text)) {
        const classAttr = await item.getAttribute("class");
        if (classAttr && classAttr.includes("active")) {
          // console.log(`✅ 已在第 ${levelIndex} 关 (匹配文本: "${text.split("\n")[0]}")`); // Removed verbose log
          return true;
        }

        // console.log(`👉 点击第 ${levelIndex} 关任务项 ("${text.split("\n")[0]}")...`); // Removed verbose log
        await link.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000); // 等待内容切换
        return true;
      }
    }

    // 策略 2: 直接使用索引 (如果文本匹配失败)
    // 假设列表顺序对应关卡顺序
    if (count >= levelIndex) {
      const targetItem = taskItems.nth(levelIndex - 1);

      // 安全检查：在点击前检查文本，防止错误点击到第1关
      const targetText = await targetItem.innerText().catch(() => "");
      // 如果我们要找的不是第1关，但文本显示是第1关，则中止
      if (levelIndex > 1) {
        const wrongRegex = /(^|\s)1\.|第1关/;
        if (wrongRegex.test(targetText)) {
          console.error(
            `❌ (安全拦截) 试图通过索引点击第 ${levelIndex} 关，但目标项文本疑似第 1 关: "${
              targetText.split("\n")[0]
            }". 取消操作。`
          );
          return false;
        }
      }

      const classAttr = await targetItem.getAttribute("class");
      if (classAttr && classAttr.includes("active")) {
        // console.log(`✅ (按索引) 已在第 ${levelIndex} 关`); // Removed verbose log
        return true;
      }

      // console.log(`👉 (按索引) 点击第 ${levelIndex} 关任务项...`); // Removed verbose log
      // 尝试点击内部的 a 标签，如果不存在则点击 item 本身
      const link = targetItem.locator("a").first();
      if (await link.isVisible()) {
        await link.click();
      } else {
        await targetItem.click();
      }

      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
      return true;
    }

    console.warn(`⚠️ 未找到第 ${levelIndex} 关对应的任务项`);
    // Debug: 打印所有找到的项，方便排查
    for (let i = 0; i < Math.min(count, 5); i++) {
      const txt = await taskItems
        .nth(i)
        .innerText()
        .catch(() => "");
      console.log(`   - Item ${i + 1}: ${txt.split("\n")[0]}`);
    }

    return false;
  } catch (e) {
    console.error(`❌ 切换关卡失败: ${e.message}`);
    return false;
  }
}

/**
 * 提取选择题答案
 * @param {Object} page 页面对象
 * @returns {Promise<Array>} 答案列表 [{questionIndex: 0, selectedOptions: [0, 2]}]
 */
async function extractChoiceAnswers(page) {
  return await page.evaluate(() => {
    const results = [];
    // 获取所有题目容器 (li 元素)
    const questionItems = document.querySelectorAll("ul.choose-container > li");

    questionItems.forEach((item, qIndex) => {
      const selectedIndices = [];
      // 获取该题目下的所有选项
      // 选项结构: .option > a.flex-container > label
      // 实际上我们只需要找 .option 下的 label，并检查 checked 类名
      const options = item.querySelectorAll(
        ".option .ant-checkbox-wrapper, .option .ant-radio-wrapper"
      );

      options.forEach((opt, oIndex) => {
        // 检查是否选中
        if (
          opt.classList.contains("ant-checkbox-wrapper-checked") ||
          opt.classList.contains("ant-radio-wrapper-checked") ||
          opt.classList.contains("checked")
        ) {
          selectedIndices.push(oIndex);
        }
      });

      if (selectedIndices.length > 0) {
        results.push({
          questionIndex: qIndex,
          selectedOptions: selectedIndices,
        });
      }
    });

    return results;
  });
}

/**
 * 检查当前页面是否提示关卡未解锁
 * @param {Object} page 页面对象
 * @returns {Promise<boolean>} 是否锁定
 */
async function checkLabLocked(page) {
  return await page.evaluate(() => {
    const bodyText = document.body.innerText;
    return (
      bodyText.includes("完成上一关才能解锁") ||
      bodyText.includes("上一关未完成")
    );
  });
}

module.exports = {
  getLabContent,
  pasteLabContent,
  enterExperimentLevel,
  switchToLevel,
  checkLabLocked,
  extractChoiceAnswers,
};
