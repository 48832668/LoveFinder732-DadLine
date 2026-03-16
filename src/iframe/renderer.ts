/**
 * 渲染模块
 */

import type { ComponentTask } from './types';
import { $, completedPrimitiveIds, getSearchText, memoryBuffer } from './state';
import { getMotivationText, getProgressClass } from './utils';

/** 主渲染函数 */
export function render(): void {
	renderHeader();
	renderTaskList();
}

/** 渲染头部进度区域 */
export function renderHeader(): void {
	const { totalProgress, totalPins, connectedPins, components } = memoryBuffer;
	const completedCount = completedPrimitiveIds.size;
	const totalCount = components.length;

	const progressPercent = $('progressPercent');
	const pinStats = $('pinStats');
	const compStats = $('compStats');
	const motivation = $('motivation');

	if (progressPercent)
		progressPercent.textContent = `${totalProgress}%`;
	if (pinStats)
		pinStats.textContent = `${connectedPins}/${totalPins} 引脚`;
	if (compStats)
		compStats.textContent = `${completedCount}/${totalCount} 元件`;
	if (motivation)
		motivation.textContent = getMotivationText(totalProgress, completedCount, totalCount);

	// 更新圆形进度条
	const progressCircle = $('progressCircle') as SVGCircleElement;
	if (progressCircle) {
		const circumference = 2 * Math.PI * 32;
		const offset = circumference - (totalProgress / 100) * circumference;
		progressCircle.style.strokeDasharray = `${circumference}`;
		progressCircle.style.strokeDashoffset = `${offset}`;
	}

	// 更新背景渐变
	const progressHeader = $('progressHeader');
	if (progressHeader) {
		progressHeader.classList.remove('progress-0', 'progress-10', 'progress-30', 'progress-50', 'progress-70', 'progress-90', 'progress-100');
		if (totalProgress >= 100) {
			progressHeader.classList.add('progress-100');
		}
		else if (totalProgress >= 90) {
			progressHeader.classList.add('progress-90');
		}
		else if (totalProgress >= 70) {
			progressHeader.classList.add('progress-70');
		}
		else if (totalProgress >= 50) {
			progressHeader.classList.add('progress-50');
		}
		else if (totalProgress >= 30) {
			progressHeader.classList.add('progress-30');
		}
		else if (totalProgress >= 10) {
			progressHeader.classList.add('progress-10');
		}
		else {
			progressHeader.classList.add('progress-0');
		}
	}
}

/** 渲染任务列表 */
export function renderTaskList(): void {
	const container = $('taskListContainer');
	if (!container)
		return;

	// 过滤掉已完成的元件
	let filtered = memoryBuffer.components.filter(c => !completedPrimitiveIds.has(c.primitiveId));

	// 搜索过滤
	const searchText = getSearchText();
	if (searchText) {
		const lower = searchText.toLowerCase();
		filtered = filtered.filter(c =>
			c.designator.toLowerCase().includes(lower)
			|| c.name.toLowerCase().includes(lower),
		);
	}

	// 排序：进度高的在前，相同进度按位号排序
	filtered.sort((a, b) => {
		if (a.progress !== b.progress)
			return b.progress - a.progress;
		return (a.designator || '').localeCompare(b.designator || '', undefined, { numeric: true });
	});

	if (filtered.length === 0) {
		let emptyMessage = '暂无元件数据';
		let emptyIcon = '📋';

		if (getSearchText()) {
			emptyMessage = '未找到匹配的元件';
			emptyIcon = '🔍';
		}
		else if (memoryBuffer.totalProgress === 100 && memoryBuffer.totalPins > 0) {
			emptyMessage = '🎉 所有元件已完成！';
			emptyIcon = '✅';
		}

		container.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">${emptyIcon}</div>
				<div>${emptyMessage}</div>
			</div>
		`;
		return;
	}

	container.innerHTML = filtered.map(comp => renderTaskItem(comp)).join('');
}

/** 渲染单个任务项 */
function renderTaskItem(comp: ComponentTask): string {
	const statusIcon = comp.completed ? '✅' : (comp.progress > 0 ? '🔧' : '⏳');
	const statusClass = comp.completed ? 'task-completed' : (comp.progress > 0 ? 'task-progress' : 'task-pending');
	const completedClass = comp.completed ? 'completed-animate' : '';

	// 引脚排序：未连接的排在前面
	const sortedPins = [...comp.pins].sort((a, b) => {
		if (a.connected !== b.connected) {
			return a.connected ? 1 : -1;
		}
		return (a.number || '').localeCompare(b.number || '', undefined, { numeric: true });
	});

	return `
		<div class="task-item ${statusClass} ${completedClass}" data-primitive-id="${comp.primitiveId}" data-page-uuid="${comp.schematicPageUuid}">
			<div class="task-header">
				<div class="task-info">
					<span class="task-icon">${statusIcon}</span>
					<span class="task-designator">${comp.designator}</span>
					<span class="task-name">${comp.name || '-'}</span>
				</div>
				<div class="task-meta">
					<span class="task-page">${comp.pageName}</span>
					<span class="task-progress-text">${comp.connectedPins}/${comp.totalPins}</span>
				</div>
			</div>
			<div class="task-progress-bar">
				<div class="progress-bar-inner ${getProgressClass(comp.progress)}" style="width: ${comp.progress}%"></div>
			</div>
			<div class="task-pins">
				${sortedPins.slice(0, 8).map(pin => `
					<span class="pin-dot ${pin.connected ? 'connected' : ''} ${pin.noConnect ? 'no-connect' : ''}" title="${pin.name || pin.number}${pin.net ? ` → ${pin.net}` : ''}${pin.noConnect ? ' [非连接]' : ''} [${pin.detectMethod}]">
						${pin.name || pin.number}
					</span>
				`).join('')}
				${sortedPins.length > 8 ? `<span class="pin-more">+${sortedPins.length - 8}</span>` : ''}
			</div>
		</div>
	`;
}

/** 渲染空状态 */
export function renderEmptyState(message: string): void {
	const progressPercent = $('progressPercent');
	const pinStats = $('pinStats');
	const compStats = $('compStats');
	const motivation = $('motivation');
	const container = $('taskListContainer');

	if (progressPercent)
		progressPercent.textContent = '0%';
	if (pinStats)
		pinStats.textContent = '0/0 引脚';
	if (compStats)
		compStats.textContent = '0/0 元件';
	if (motivation)
		motivation.textContent = message;
	if (container) {
		container.innerHTML = `
			<div class="empty-state">
				<div class="empty-icon">📋</div>
				<div>${message}</div>
			</div>
		`;
	}

	const progressHeader = $('progressHeader');
	if (progressHeader) {
		progressHeader.classList.remove('progress-0', 'progress-10', 'progress-30', 'progress-50', 'progress-70', 'progress-90', 'progress-100');
		progressHeader.classList.add('progress-0');
	}
}
