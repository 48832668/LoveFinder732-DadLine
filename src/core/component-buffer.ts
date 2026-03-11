/**
 * 元件数据缓冲区管理模块
 *
 * 提供元件数据的统一存储和管理，支持不同范围的刷新操作
 * 为后续功能（如进度跟踪、连接状态等）提供数据基础
 */

/**
 * 元件信息接口
 */
export interface ComponentInfo {
	/** 元件唯一标识 */
	primitiveId: string;
	/** 位号 */
	designator: string;
	/** 元件名称 */
	name: string;
	/** 元件类型 */
	componentType: string;
	/** 所属图页 UUID */
	schematicPageUuid: string;
	/** 唯一 ID */
	uniqueId?: string;
	/** 封装信息 */
	footprint?: { libraryUuid: string; uuid: string };
	/** 符号信息 */
	symbol?: { libraryUuid: string; uuid: string };
	/** 其他属性 */
	otherProperty?: Record<string, string | number | boolean>;
	/** 引脚信息 */
	pins?: ComponentPinInfo[];
	/** 缓存时间戳 */
	cachedAt: number;
}

/**
 * 元件引脚信息接口
 */
export interface ComponentPinInfo {
	/** 引脚 ID */
	primitiveId: string;
	/** 引脚编号 */
	pinNumber: string;
	/** 引脚名称 */
	pinName: string;
	/** 连接的网络 */
	net?: string;
	/** 是否未连接 */
	noConnected?: boolean;
}

/**
 * 图页信息接口
 */
export interface PageInfo {
	/** 图页 UUID */
	uuid: string;
	/** 图页名称 */
	name: string;
	/** 图页索引 */
	index: number;
	/** 元件数量 */
	componentCount: number;
	/** 缓存时间戳 */
	cachedAt: number;
}

/**
 * 缓冲区数据变更事件类型
 */
export type BufferChangeEventType
	= | 'full-refresh' // 全量刷新
		| 'page-refresh' // 单页刷新
		| 'component-add' // 元件添加
		| 'component-update' // 元件更新
		| 'component-remove'; // 元件移除

/**
 * 缓冲区数据变更事件
 */
export interface BufferChangeEvent {
	/** 事件类型 */
	type: BufferChangeEventType;
	/** 相关的图页 UUID（可选） */
	pageUuid?: string;
	/** 相关的元件 ID（可选） */
	componentIds?: string[];
	/** 时间戳 */
	timestamp: number;
}

/**
 * 事件监听器类型
 */
type BufferChangeListener = (event: BufferChangeEvent) => void;

/**
 * 元件数据缓冲区类
 *
 * 单例模式，提供全局唯一的元件数据存储
 */
export class ComponentBuffer {
	private static instance: ComponentBuffer;

	/** 元件数据存储：primitiveId -> ComponentInfo */
	private components: Map<string, ComponentInfo> = new Map();

	/** 图页元件索引：pageUuid -> Set<primitiveId> */
	private pageIndex: Map<string, Set<string>> = new Map();

	/** 图页信息存储：pageUuid -> PageInfo */
	private pages: Map<string, PageInfo> = new Map();

	/** 位号索引：designator -> primitiveId */
	private designatorIndex: Map<string, string> = new Map();

	/** 事件监听器列表 */
	private listeners: BufferChangeListener[] = [];

	/** 缓存有效期（毫秒），默认 30 秒 */
	private cacheTTL = 30000;

	/** 最后刷新时间 */
	private lastRefreshTime = 0;

	/** 当前图页 UUID */
	private currentPageUuid: string | null = null;

	private constructor() {}

	/**
	 * 获取单例实例
	 */
	public static getInstance(): ComponentBuffer {
		if (!ComponentBuffer.instance) {
			ComponentBuffer.instance = new ComponentBuffer();
		}
		return ComponentBuffer.instance;
	}

	/**
	 * 添加事件监听器
	 */
	public addListener(listener: BufferChangeListener): void {
		this.listeners.push(listener);
	}

	/**
	 * 移除事件监听器
	 */
	public removeListener(listener: BufferChangeListener): void {
		const index = this.listeners.indexOf(listener);
		if (index > -1) {
			this.listeners.splice(index, 1);
		}
	}

	/**
	 * 触发事件
	 */
	private emit(event: BufferChangeEvent): void {
		this.listeners.forEach((listener) => {
			try {
				listener(event);
			}
			catch (e) {
				console.error('[ComponentBuffer] 事件监听器执行失败:', e);
			}
		});
	}

	/**
	 * 设置当前图页
	 */
	public setCurrentPage(pageUuid: string | null): void {
		this.currentPageUuid = pageUuid;
	}

	/**
	 * 获取当前图页 UUID
	 */
	public getCurrentPage(): string | null {
		return this.currentPageUuid;
	}

	/**
	 * 清空缓冲区
	 */
	public clear(): void {
		this.components.clear();
		this.pageIndex.clear();
		this.pages.clear();
		this.designatorIndex.clear();
		this.lastRefreshTime = 0;

		this.emit({
			type: 'full-refresh',
			timestamp: Date.now(),
		});
	}

	/**
	 * 批量设置图页信息
	 */
	public setPages(pages: PageInfo[]): void {
		this.pages.clear();
		pages.forEach((page) => {
			this.pages.set(page.uuid, page);
		});
	}

	/**
	 * 添加或更新图页信息
	 */
	public setPage(page: PageInfo): void {
		this.pages.set(page.uuid, page);
	}

	/**
	 * 获取所有图页信息
	 */
	public getPages(): PageInfo[] {
		return Array.from(this.pages.values()).sort((a, b) => a.index - b.index);
	}

	/**
	 * 获取图页信息
	 */
	public getPage(pageUuid: string): PageInfo | undefined {
		return this.pages.get(pageUuid);
	}

	/**
	 * 添加元件到缓冲区
	 */
	public addComponent(component: ComponentInfo): void {
		const existing = this.components.get(component.primitiveId);

		// 如果已存在且属于不同图页，需要从旧图页索引中移除
		if (existing && existing.schematicPageUuid !== component.schematicPageUuid) {
			this.removeFromPageIndex(component.primitiveId, existing.schematicPageUuid);
		}

		// 存储元件
		this.components.set(component.primitiveId, {
			...component,
			cachedAt: Date.now(),
		});

		// 更新图页索引
		this.addToPageIndex(component.primitiveId, component.schematicPageUuid);

		// 更新位号索引
		if (component.designator) {
			this.designatorIndex.set(component.designator, component.primitiveId);
		}

		// 更新图页元件计数
		this.updatePageComponentCount(component.schematicPageUuid);

		this.emit({
			type: existing ? 'component-update' : 'component-add',
			componentIds: [component.primitiveId],
			pageUuid: component.schematicPageUuid,
			timestamp: Date.now(),
		});
	}

	/**
	 * 批量添加元件
	 */
	public addComponents(components: ComponentInfo[]): void {
		components.forEach((comp) => {
			this.components.set(comp.primitiveId, {
				...comp,
				cachedAt: Date.now(),
			});
			this.addToPageIndex(comp.primitiveId, comp.schematicPageUuid);
			if (comp.designator) {
				this.designatorIndex.set(comp.designator, comp.primitiveId);
			}
		});

		// 更新所有相关图页的元件计数
		const affectedPages = new Set(components.map(c => c.schematicPageUuid));
		affectedPages.forEach(pageUuid => this.updatePageComponentCount(pageUuid));

		this.emit({
			type: 'page-refresh',
			componentIds: components.map(c => c.primitiveId),
			timestamp: Date.now(),
		});
	}

	/**
	 * 从缓冲区移除元件
	 */
	public removeComponent(primitiveId: string): void {
		const component = this.components.get(primitiveId);
		if (!component)
			return;

		this.components.delete(primitiveId);
		this.removeFromPageIndex(primitiveId, component.schematicPageUuid);

		if (component.designator) {
			this.designatorIndex.delete(component.designator);
		}

		this.updatePageComponentCount(component.schematicPageUuid);

		this.emit({
			type: 'component-remove',
			componentIds: [primitiveId],
			pageUuid: component.schematicPageUuid,
			timestamp: Date.now(),
		});
	}

	/**
	 * 获取元件信息
	 */
	public getComponent(primitiveId: string): ComponentInfo | undefined {
		return this.components.get(primitiveId);
	}

	/**
	 * 通过位号获取元件
	 */
	public getComponentByDesignator(designator: string): ComponentInfo | undefined {
		const primitiveId = this.designatorIndex.get(designator);
		return primitiveId ? this.components.get(primitiveId) : undefined;
	}

	/**
	 * 获取所有元件
	 */
	public getAllComponents(): ComponentInfo[] {
		return Array.from(this.components.values());
	}

	/**
	 * 获取图页内的所有元件
	 */
	public getPageComponents(pageUuid: string): ComponentInfo[] {
		const ids = this.pageIndex.get(pageUuid);
		if (!ids)
			return [];

		return Array.from(ids)
			.map(id => this.components.get(id))
			.filter((comp): comp is ComponentInfo => comp !== undefined);
	}

	/**
	 * 获取元件总数
	 */
	public getTotalCount(): number {
		return this.components.size;
	}

	/**
	 * 获取图页元件数量
	 */
	public getPageComponentCount(pageUuid: string): number {
		const ids = this.pageIndex.get(pageUuid);
		return ids ? ids.size : 0;
	}

	/**
	 * 检查缓存是否有效
	 */
	public isCacheValid(): boolean {
		if (this.lastRefreshTime === 0)
			return false;
		return Date.now() - this.lastRefreshTime < this.cacheTTL;
	}

	/**
	 * 设置最后刷新时间
	 */
	public setLastRefreshTime(time: number = Date.now()): void {
		this.lastRefreshTime = time;
	}

	/**
	 * 获取最后刷新时间
	 */
	public getLastRefreshTime(): number {
		return this.lastRefreshTime;
	}

	/**
	 * 搜索元件
	 */
	public searchComponents(query: string): ComponentInfo[] {
		const lowerQuery = query.toLowerCase();
		return this.getAllComponents().filter(comp =>
			comp.designator.toLowerCase().includes(lowerQuery)
			|| comp.name.toLowerCase().includes(lowerQuery),
		);
	}

	/**
	 * 获取统计信息
	 */
	public getStatistics(): {
		totalComponents: number;
		totalPages: number;
		pageStats: Array<{ name: string; uuid: string; count: number }>;
	} {
		const pageStats = this.getPages().map(page => ({
			name: page.name,
			uuid: page.uuid,
			count: this.getPageComponentCount(page.uuid),
		}));

		return {
			totalComponents: this.components.size,
			totalPages: this.pages.size,
			pageStats,
		};
	}

	// ==================== 私有方法 ====================

	/**
	 * 添加到图页索引
	 */
	private addToPageIndex(primitiveId: string, pageUuid: string): void {
		if (!this.pageIndex.has(pageUuid)) {
			this.pageIndex.set(pageUuid, new Set());
		}
		this.pageIndex.get(pageUuid)!.add(primitiveId);
	}

	/**
	 * 从图页索引移除
	 */
	private removeFromPageIndex(primitiveId: string, pageUuid: string): void {
		const ids = this.pageIndex.get(pageUuid);
		if (ids) {
			ids.delete(primitiveId);
		}
	}

	/**
	 * 更新图页元件计数
	 */
	private updatePageComponentCount(pageUuid: string): void {
		const page = this.pages.get(pageUuid);
		if (page) {
			page.componentCount = this.getPageComponentCount(pageUuid);
			page.cachedAt = Date.now();
		}
	}
}

// 导出单例实例
export const componentBuffer = ComponentBuffer.getInstance();
