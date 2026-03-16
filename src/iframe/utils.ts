/**
 * 工具函数模块
 */

import { edaApi } from './state';

/** 显示 Toast 消息 */
export function showToast(msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
	if (edaApi?.sys_Message) {
		const t = {
			success: (window as any).ESYS_ToastMessageType?.SUCCESS,
			error: (window as any).ESYS_ToastMessageType?.ERROR,
			warning: (window as any).ESYS_ToastMessageType?.WARNING,
		}[type] || (window as any).ESYS_ToastMessageType?.INFO;
		try {
			edaApi.sys_Message.showToastMessage(msg, t, 3);
		}
		catch (e) {
			console.error('Toast failed:', e);
		}
	}
}

/** 获取进度条样式类 */
export function getProgressClass(progress: number): string {
	if (progress >= 100)
		return 'progress-complete';
	if (progress >= 70)
		return 'progress-high';
	if (progress >= 30)
		return 'progress-medium';
	return 'progress-low';
}

/** 获取激励文本 */
export function getMotivationText(progress: number, completed: number, total: number): string {
	if (progress >= 100)
		return '🎉 完美！原理图全部完成！';
	if (progress >= 95)
		return '🏆 就差一点点了！';
	if (progress >= 90)
		return '🚀 冲刺阶段，加油！';
	if (progress >= 80)
		return '💪 进入最后阶段！';
	if (progress >= 70)
		return '🔥 进展神速！';
	if (progress >= 60)
		return '⭐ 超过六成了！';
	if (progress >= 50)
		return '📈 半程里程碑达成！';
	if (progress >= 40)
		return '🎯 稳步推进中！';
	if (progress >= 30)
		return '🌟 势头不错！';
	if (progress >= 20)
		return '🔨 渐入佳境！';
	if (progress >= 10)
		return '🌱 良好的开始！';
	if (progress >= 5)
		return '▶️ 刚刚起步！';
	if (total === 0)
		return '📋 等待加载元件...';
	return '🎯 开始连接元件吧！';
}
