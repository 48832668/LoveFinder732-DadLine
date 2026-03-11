/**
 * 工程进度可视化插件
 *
 * 功能：实时统计原理图绘制进度，以任务清单形式展示元件引脚连接状态
 */
import * as extensionConfig from '../extension.json';

// 状态管理
let isPanelOpen = false;

// 导出激活函数
export function activate(status?: 'onStartupFinished', arg?: string): void {
	// 扩展激活时的初始化
}

// 打开进度面板
export function openProgressPanel(): void {
	if (isPanelOpen) {
		eda.sys_IFrame.showIFrame('progress-panel');
		return;
	}

	eda.sys_IFrame.openIFrame(
		'/iframe/index.html',
		280,
		undefined,
		'progress-panel',
		{
			maximizeButton: false,
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

// 保留原有的about方法
export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('工程进度可视化插件 v', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}