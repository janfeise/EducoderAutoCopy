/**
 * 配置管理模块
 * 负责加载和管理应用配置
 */

const fs = require("fs");
const path = require("path");

function parseBool(value, def) {
  if (value === undefined || value === null) return def;
  const v = String(value).toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function parseNumber(value, def) {
  if (value === undefined || value === null || value === "") return def;
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

function loadDotEnv(envPath) {
  try {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, "utf-8");
    const obj = {};
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#"))
      .forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          obj[key] = val;
        }
      });
    return obj;
  } catch {
    return {};
  }
}

/**
 * 加载配置文件
 * @returns {Object} 配置对象
 */
function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  const envPath = path.join(__dirname, "..", ".env");

  // 1) 加载 .env 到内存（不依赖第三方库）
  const fileEnv = loadDotEnv(envPath);
  const env = { ...fileEnv, ...process.env };

  // 2) 尝试加载本地 config.json（如果存在）
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(configContent);
      console.log("✅ 本地 config.json 已加载");
    } catch (error) {
      console.warn("⚠️ 本地 config.json 解析失败，忽略: " + error.message);
    }
  } else {
    console.log("ℹ️ 未检测到本地 config.json，使用环境变量配置");
  }

  // 3) 组装最终配置（环境变量优先，其次本地文件，最后默认值）
  const config = {
    educoder: {
      username:
        env.EDUCODER_USERNAME ??
        (fileConfig.educoder && fileConfig.educoder.username) ??
        "",
      password:
        env.EDUCODER_PASSWORD ??
        (fileConfig.educoder && fileConfig.educoder.password) ??
        "",
      completeUsername:
        env.EDUCODER_COMPLETE_USERNAME ??
        (fileConfig.educoder && fileConfig.educoder.completeUsername) ??
        "",
      completePassword:
        env.EDUCODER_COMPLETE_PASSWORD ??
        (fileConfig.educoder && fileConfig.educoder.completePassword) ??
        "",
      courseName:
        env.EDUCODER_COURSE_NAME ??
        (fileConfig.educoder && fileConfig.educoder.courseName) ??
        "机器学习",
      loginUrl:
        env.EDUCODER_LOGIN_URL ??
        (fileConfig.educoder && fileConfig.educoder.loginUrl) ??
        "https://www.educoder.net/",
    },
    browser: {
      headless: parseBool(
        env.BROWSER_HEADLESS,
        fileConfig.browser && fileConfig.browser.headless !== undefined
          ? fileConfig.browser.headless
          : false
      ),
      type:
        env.BROWSER_TYPE ??
        (fileConfig.browser && fileConfig.browser.type) ??
        "chromium",
    },
    timeout: {
      pageLoad: parseNumber(
        env.TIMEOUT_PAGE_LOAD,
        fileConfig.timeout && fileConfig.timeout.pageLoad !== undefined
          ? fileConfig.timeout.pageLoad
          : 20000
      ),
      elementWait: parseNumber(
        env.TIMEOUT_ELEMENT_WAIT,
        fileConfig.timeout && fileConfig.timeout.elementWait !== undefined
          ? fileConfig.timeout.elementWait
          : 10000
      ),
      clickTimeout: parseNumber(
        env.TIMEOUT_CLICK_TIMEOUT,
        fileConfig.timeout && fileConfig.timeout.clickTimeout !== undefined
          ? fileConfig.timeout.clickTimeout
          : 8000
      ),
      levelWait: parseNumber(
        env.TIMEOUT_LEVEL_WAIT,
        fileConfig.timeout && fileConfig.timeout.levelWait !== undefined
          ? fileConfig.timeout.levelWait
          : 3000
      ),
    },
  };

  console.log("✅ 配置加载完成：已优先使用环境变量");
  return config;
}

module.exports = {
  loadConfig,
};
