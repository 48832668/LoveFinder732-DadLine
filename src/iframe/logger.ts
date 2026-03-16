/**
 * 调试日志模块
 */

import type { DebugLog } from './types';
import { $, debugLogs } from './state';

/** 添加调试日志 */
export function addDebugLog(level: DebugLog['level'], message: string, details?: any): void {
	const log: DebugLog = {
		time: new Date().toLocaleTimeString(),
		level,
		message,
		details,
	};
	debugLogs.push(log);
	renderDebugPanel();
}

/** 渲染调试面板 */
export function renderDebugPanel(): void {
	const container = $('debugContent');
	if (!container)
		return;

	container.innerHTML = debugLogs.slice(-50).map(log => `
		<div class="debug-log debug-${log.level}">
			<span class="debug-time">[${log.time}]</span>
			<span class="debug-msg">${log.message}</span>
			${log.details ? `<pre class="debug-details">${typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : log.details}</pre>` : ''}
		</div>
	`).join('');

	container.scrollTop = container.scrollHeight;
}

/** 清空调试日志 */
export function clearDebugLogs(): void {
	debugLogs.length = 0;
	renderDebugPanel();
}
