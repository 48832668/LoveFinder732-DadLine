/**
 * 全局状态管理模块
 */

import type { BufferData, DebugLog } from './types';

/** 内存缓冲区 */
export const memoryBuffer: BufferData = {
	pages: [],
	components: [],
	currentPageUuid: null,
	totalPins: 0,
	connectedPins: 0,
	totalProgress: 0,
	cachedAt: 0,
};

/** 调试日志数组 */
export const debugLogs: DebugLog[] = [];

/** 内部状态变量 */
let _searchText = '';
let _debugExpanded = false;
let _autoRefreshEnabled = false;
let _autoRefreshInterval: number | null = null;

/** 搜索文本 */
export function getSearchText(): string {
	return _searchText;
}

export function setSearchText(text: string): void {
	_searchText = text;
}

/** 调试面板展开状态 */
export function isDebugExpanded(): boolean {
	return _debugExpanded;
}

export function toggleDebugExpanded(): void {
	_debugExpanded = !_debugExpanded;
}

/** 自动刷新启用状态 */
export function isAutoRefreshEnabled(): boolean {
	return _autoRefreshEnabled;
}

export function setAutoRefreshEnabled(enabled: boolean): void {
	_autoRefreshEnabled = enabled;
}

/** 自动刷新定时器 */
export function getAutoRefreshInterval(): number | null {
	return _autoRefreshInterval;
}

export function setAutoRefreshInterval(interval: number | null): void {
	_autoRefreshInterval = interval;
}

/** 已完成元件ID映射 */
export const completedPrimitiveIds: Map<string, string> = new Map();

/** EDA API */
export const edaApi = (window as any).eda || (window.parent as any)?.eda || (window.top as any)?.eda;

/** DOM 选择器 */
export const $ = (id: string) => document.getElementById(id);
