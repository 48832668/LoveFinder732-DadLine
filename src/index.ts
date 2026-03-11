/**
 * 工程进度可视化插件
 *
 * 功能：统计原理图中每个图页的元件，以列表形式展示
 */
import * as extensionConfig from '../extension.json';
import { componentBuffer } from './core/component-buffer';
import { DataLoader } from './core/data-loader';

// 状态管理
let isPanelOpen = false;

/**
 * 导出激活函数
 */
export function activate(_status?: 'onStartupFinished', _arg?: string): void {
	// 插件激活
}

/**
 * 打开进度面板
 */
export function openProgressPanel(): void {
	if (isPanelOpen) {
		eda.sys_IFrame.showIFrame('progress-panel');
		return;
	}

	eda.sys_IFrame.openIFrame(
		'/iframe/index.html',
		300,
		300,
		'progress-panel',
		{
			maximizeButton: true,
			minimizeButton: true,
			grayscaleMask: false,
			buttonCallbackFn: (button: 'close' | 'minimize' | 'maximize') => {
				if (button === 'close') {
					isPanelOpen = false;
				}
			},
		},
	);

	isPanelOpen = true;
}

/**
 * 刷新所有图页数据
 */
export async function refreshAllPages(): Promise<void> {
	try {
		eda.sys_Message.showToastMessage('正在加载元件数据...', ESYS_ToastMessageType.INFO, 3);

		const result = await DataLoader.refreshAllPages();

		eda.sys_Message.showToastMessage(
			`加载完成: ${result.totalPages} 个图页, ${result.totalComponents} 个元件`,
			ESYS_ToastMessageType.SUCCESS,
			3,
		);
	}
	catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		eda.sys_Message.showToastMessage(`加载失败: ${message}`, ESYS_ToastMessageType.ERROR, 3);
	}
}

/**
 * 刷新当前图页数据
 */
export async function refreshCurrentPage(): Promise<void> {
	try {
		const count = await DataLoader.refreshCurrentPage();

		eda.sys_Message.showToastMessage(
			`当前图页加载完成: ${count} 个元件`,
			ESYS_ToastMessageType.SUCCESS,
			3,
		);
	}
	catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		eda.sys_Message.showToastMessage(`加载失败: ${message}`, ESYS_ToastMessageType.ERROR, 3);
	}
}

/**
 * 获取缓冲区统计信息
 */
export function getBufferStatistics(): {
	totalComponents: number;
	totalPages: number;
	pageStats: Array<{ name: string; uuid: string; count: number }>;
} {
	return componentBuffer.getStatistics();
}

/**
 * 保留原有的about方法
 */
export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('工程进度可视化插件 v', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}
