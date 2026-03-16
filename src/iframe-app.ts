/**
 * DadLine - 工程进度可视化插件
 * 任务清单 + 激励式界面
 *
 * 入口文件，负责初始化和模块整合
 */

import { refreshData } from './iframe/data';
import { initEvents } from './iframe/events';

/**
 * 初始化应用
 */
async function init(): Promise<void> {
	initEvents();
	await refreshData();
}

// 启动应用
init();
