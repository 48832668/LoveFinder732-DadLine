/**
 * 事件处理模块
 */

import { selectComponent } from './api';
import { refreshCurrentPageOnly, refreshData } from './data';
import { addDebugLog } from './logger';
import { renderTaskList } from './renderer';
import { $, getAutoRefreshInterval, isAutoRefreshEnabled, isDebugExpanded, setAutoRefreshEnabled, setAutoRefreshInterval, setSearchText, toggleDebugExpanded } from './state';

/** 切换自动刷新 */
export function toggleAutoRefresh(): void {
	const newState = !isAutoRefreshEnabled();
	setAutoRefreshEnabled(newState);

	const btn = $('autoRefreshBtn');
	if (btn) {
		btn.textContent = newState ? '⏸️' : '▶️';
		btn.title = newState ? '暂停自动刷新' : '开启自动刷新';
		btn.classList.toggle('active', newState);
	}

	if (newState) {
		addDebugLog('info', '自动刷新已开启 (1秒间隔)');
		const interval = window.setInterval(() => {
			refreshCurrentPageOnly();
		}, 1000);
		setAutoRefreshInterval(interval);
	}
	else {
		addDebugLog('info', '自动刷新已关闭');
		const currentInterval = getAutoRefreshInterval();
		if (currentInterval) {
			clearInterval(currentInterval);
			setAutoRefreshInterval(null);
		}
	}
}

/** 初始化事件 */
export function initEvents(): void {
	// 刷新按钮
	const refreshBtn = $('refreshBtn');
	if (refreshBtn) {
		refreshBtn.onclick = () => {
			if (isAutoRefreshEnabled()) {
				toggleAutoRefresh();
			}
			refreshData();
		};
	}

	// 自动刷新按钮
	const autoRefreshBtn = $('autoRefreshBtn');
	if (autoRefreshBtn) {
		autoRefreshBtn.onclick = () => toggleAutoRefresh();
	}

	// 搜索框
	const searchInput = $('searchInput') as HTMLInputElement;
	if (searchInput) {
		searchInput.oninput = (e) => {
			setSearchText((e.target as HTMLInputElement).value);
			renderTaskList();
		};
	}

	// 元件点击事件（事件委托）
	const taskListContainer = $('taskListContainer');
	if (taskListContainer) {
		taskListContainer.addEventListener('click', async (e) => {
			const target = e.target as HTMLElement;
			const taskItem = target.closest('.task-item') as HTMLElement;
			if (!taskItem)
				return;

			const primitiveId = taskItem.dataset.primitiveId;
			const pageUuid = taskItem.dataset.pageUuid;

			if (primitiveId && pageUuid) {
				await selectComponent(primitiveId, pageUuid);
			}
		});
	}

	// 调试面板折叠
	const debugHeader = $('debugHeader');
	if (debugHeader) {
		debugHeader.onclick = () => {
			toggleDebugExpanded();
			const content = $('debugContent');
			const icon = $('debugToggleIcon');
			if (content) {
				content.style.display = isDebugExpanded() ? 'block' : 'none';
			}
			if (icon) {
				icon.textContent = isDebugExpanded() ? '▼' : '▶';
			}
		};
	}
}
