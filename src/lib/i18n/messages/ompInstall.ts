import { defineMessages } from "../define";

export default defineMessages({
	"zh-CN": {
		noOutput: "（暂无输出）",
		manualCommandHint: "也可以在{target}里手动安装：",
		targetPowershell: " PowerShell ",
		targetTerminal: "终端",
		stagePreparing: "正在准备安装",
		installIntro:
			"omp 是本应用的 AI 内核。正在从官方源下载并安装，文件较大（约 200 MB），请保持网络畅通。",
		downloadedBytes: "已下载 {bytes}",
		elapsedTime: "已用时 {time}",
		fullLog: "完整日志",
		installedTitleVersion: "omp 内核 {version} 已安装",
		installedTitleNoVersion: "omp 内核已安装",
		installedDesc:
			"无需重启应用。接下来配置一个模型供应商，就可以开始对话了。",
		btnConfigModels: "去配置模型",
		btnStartUsing: "开始使用",
		cancelledTitle: "安装已取消",
		failedTitle: "omp 内核安装失败",
		notFoundWarning: "仍未检测到 omp，请确认安装完成后再试。",
		btnRecheckManual: "我已手动安装，重新检测",
		btnSpecifyPath: "指定 omp 位置",
		titleBinaryNotFound: "找不到你指定的 omp 位置",
		invalidPathFallback: "已配置的路径无效",
		binaryNotFoundDesc:
			"可以改用自动安装（会把 omp 程序位置恢复为默认的 omp），或者去设置里修正路径。",
		btnGoSettings: "去设置",
		btnSwitchAutoInstall: "改用自动安装",
		dialogTitle: "安装 omp 内核",
		noticeNotInstalledTitle: "尚未安装 omp 内核",
		btnStartInstall: "开始安装",
	},
	"en-US": {
		noOutput: "(No output)",
		manualCommandHint: "Or install manually in {target}:",
		targetPowershell: " PowerShell ",
		targetTerminal: "Terminal",
		stagePreparing: "Preparing installation",
		installIntro:
			"omp is the AI engine of this app. Downloading and installing from official source (~200 MB); please keep network connected.",
		downloadedBytes: "Downloaded {bytes}",
		elapsedTime: "Elapsed {time}",
		fullLog: "Full log",
		installedTitleVersion: "omp engine {version} installed",
		installedTitleNoVersion: "omp engine installed",
		installedDesc:
			"No restart needed. Configure a model provider to start chatting.",
		btnConfigModels: "Configure models",
		btnStartUsing: "Get started",
		cancelledTitle: "Installation cancelled",
		failedTitle: "omp engine installation failed",
		notFoundWarning:
			"omp still not detected. Please verify installation before retrying.",
		btnRecheckManual: "I installed manually, recheck",
		btnSpecifyPath: "Specify omp path",
		titleBinaryNotFound: "Cannot find specified omp location",
		invalidPathFallback: "Configured path is invalid",
		binaryNotFoundDesc:
			"You can switch to automatic installation (resets path to default omp), or correct the path in Settings.",
		btnGoSettings: "Go to Settings",
		btnSwitchAutoInstall: "Switch to auto install",
		dialogTitle: "Install omp engine",
		noticeNotInstalledTitle: "omp engine not installed",
		btnStartInstall: "Start installation",
	},
});
