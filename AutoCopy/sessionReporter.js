
class SessionReporter {
  constructor() {
    this.experiments = [];
    this.currentExperiment = null;
  }

  startExperiment(name) {
    this.currentExperiment = {
      name: name,
      levels: [],
      startTime: new Date(),
      status: "IN_PROGRESS"
    };
    this.experiments.push(this.currentExperiment);
  }

  endExperiment(status = "COMPLETED") {
    if (this.currentExperiment) {
      this.currentExperiment.status = status;
      this.currentExperiment.endTime = new Date();
    }
  }

  recordLevel(levelIndex, status, details = "") {
    if (this.currentExperiment) {
      this.currentExperiment.levels.push({
        index: levelIndex,
        status: status, // "PASSED", "FAILED", "SKIPPED"
        details: details,
        timestamp: new Date()
      });
    }
  }

  generateReport() {
    console.log("\n📊 === 本次运行总结 ===");
    if (this.experiments.length === 0) {
      console.log("无实验记录。");
      return;
    }

    this.experiments.forEach((exp, i) => {
      const duration = exp.endTime 
        ? ((exp.endTime - exp.startTime) / 1000).toFixed(1) + "s"
        : "未完成";
      
      console.log(`\n${i + 1}. 实验: ${exp.name} [${exp.status}] (耗时: ${duration})`);
      
      const passed = exp.levels.filter(l => l.status === "PASSED").length;
      const failed = exp.levels.filter(l => l.status === "FAILED").length;
      const skipped = exp.levels.filter(l => l.status === "SKIPPED").length;
      
      console.log(`   - 关卡统计: ✅ 通过 ${passed} | ❌ 失败 ${failed} | ⏭️ 跳过 ${skipped}`);
      
      if (failed > 0) {
        console.log("   - 失败关卡详情:");
        exp.levels.filter(l => l.status === "FAILED").forEach(l => {
          console.log(`     • 第 ${l.index} 关: ${l.details}`);
        });
      }
    });
    console.log("\n========================\n");
  }
}

module.exports = new SessionReporter();
