/**
 * 类型定义模块
 */

/** 引脚信息 */
export interface PinInfo {
	number: string;
	name: string;
	x: number;
	y: number;
	net: string | null;
	connected: boolean;
	detectMethod: string;
	noConnect: boolean;
}

/** 元件任务 */
export interface ComponentTask {
	primitiveId: string;
	designator: string;
	name: string;
	schematicPageUuid: string;
	pageName: string;
	pins: PinInfo[];
	totalPins: number;
	connectedPins: number;
	progress: number;
	completed: boolean;
}

/** 图页数据 */
export interface PageData {
	uuid: string;
	name: string;
	index: number;
}

/** 缓冲区数据 */
export interface BufferData {
	pages: PageData[];
	components: ComponentTask[];
	currentPageUuid: string | null;
	totalPins: number;
	connectedPins: number;
	totalProgress: number;
	cachedAt: number;
}

/** 调试日志 */
export interface DebugLog {
	time: string;
	level: 'info' | 'success' | 'warning' | 'error';
	message: string;
	details?: any;
}

/** 扫描结果 */
export interface ScanPageResult {
	components: ComponentTask[];
	wireCount: number;
	netLabelCount: number;
	noConnectCount: number;
}
