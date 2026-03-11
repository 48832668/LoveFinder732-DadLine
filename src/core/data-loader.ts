/**
 * 数据加载模块
 *
 * 提供从 EDA API 加载元件数据到缓冲区的功能
 * 支持不同范围的刷新：当前图页、所有图页、选中元件等
 */

import type { ComponentInfo, ComponentPinInfo, PageInfo } from './component-buffer';
import { componentBuffer } from './component-buffer';

/**
 * 尝试调用对象的方法
 */
function readMethod<T>(target: unknown, methodName: string): T | undefined {
	if (!target || typeof target !== 'object')
		return undefined;
	const method = (target as Record<string, unknown>)[methodName];
	if (typeof method !== 'function')
		return undefined;
	try {
		return (method as () => T).call(target);
	}
	catch {
		return undefined;
	}
}

/**
 * 尝试读取对象的字段
 */
function readField<T>(target: unknown, fieldNames: string[]): T | undefined {
	if (!target || typeof target !== 'object')
		return undefined;
	for (const fieldName of fieldNames) {
		if (fieldName in (target as Record<string, unknown>)) {
			return (target as Record<string, T | undefined>)[fieldName];
		}
	}
	return undefined;
}

/**
 * 读取状态属性（优先方法，其次字段）
 */
function readState<T>(target: unknown, methodName: string, fieldNames: string[]): T | undefined {
	return readMethod<T>(target, methodName) ?? readField<T>(target, fieldNames);
}

/**
 * 读取元件位号
 */
function readDesignator(target: unknown): string | undefined {
	return readState<string>(target, 'getState_Designator', ['designator']);
}

/**
 * 读取元件名称（型号）
 */
function readName(target: unknown): string | undefined {
	// 优先使用 manufacturerId（元件型号）
	if (target && typeof target === 'object' && 'manufacturerId' in target) {
		const manufacturerId = (target as Record<string, unknown>).manufacturerId;
		if (typeof manufacturerId === 'string') {
			return manufacturerId;
		}
	}
	return readState<string>(target, 'getState_Name', ['name']);
}

/**
 * 读取元件 ID
 */
function readPrimitiveId(target: unknown): string | undefined {
	return readState<string>(target, 'getState_PrimitiveId', ['primitiveId']);
}

/**
 * 读取元件类型
 */
function readComponentType(target: unknown): string | undefined {
	return readState<string>(target, 'getState_ComponentType', ['componentType']);
}

/**
 * 解析元件信息
 */
function parseComponent(comp: unknown, pageUuid: string): ComponentInfo {
	return {
		primitiveId: readPrimitiveId(comp) || '',
		designator: readDesignator(comp) || '',
		name: readName(comp) || '',
		componentType: readComponentType(comp) || '',
		schematicPageUuid: pageUuid,
		uniqueId: readState<string>(comp, 'getState_UniqueId', ['uniqueId']),
		footprint: readState<{ libraryUuid: string; uuid: string }>(comp, 'getState_Footprint', ['footprint']),
		symbol: readState<{ libraryUuid: string; uuid: string }>(comp, 'getState_Symbol', ['symbol']),
		otherProperty: readState<Record<string, string | number | boolean>>(comp, 'getState_OtherProperty', ['otherProperty']),
		cachedAt: Date.now(),
	};
}

/**
 * 解析引脚信息
 */
function parsePin(pin: unknown): ComponentPinInfo {
	return {
		primitiveId: readState<string>(pin, 'getState_PrimitiveId', ['primitiveId']) || '',
		pinNumber: readState<string>(pin, 'getState_PinNumber', ['pinNumber']) || '',
		pinName: readState<string>(pin, 'getState_PinName', ['pinName']) || '',
		net: readState<string>(pin, 'getState_Net', ['net']),
		noConnected: readState<boolean>(pin, 'getState_NoConnected', ['noConnected']),
	};
}

/**
 * 数据加载器类
 */
export class DataLoader {
	/**
	 * 检查当前文档是否为原理图
	 */
	public static async checkSchematicDocument(): Promise<boolean> {
		try {
			const currentDoc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
			return currentDoc?.documentType === 1;
		}
		catch {
			return false;
		}
	}

	/**
	 * 获取当前图页信息
	 */
	public static async getCurrentPageInfo(): Promise<{ uuid: string; name: string } | null> {
		try {
			const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
			if (page?.uuid && page?.name) {
				return { uuid: page.uuid, name: page.name };
			}
		}
		catch {
			// 忽略错误
		}
		return null;
	}

	/**
	 * 获取所有图页信息
	 */
	public static async getAllPageInfos(): Promise<Array<{ uuid: string; name: string }>> {
		try {
			const pages = await eda.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo();
			return (pages || []).map((p, index) => ({
				uuid: p.uuid,
				name: p.name,
				index,
			}));
		}
		catch {
			return [];
		}
	}

	/**
	 * 刷新当前图页的元件数据
	 */
	public static async refreshCurrentPage(): Promise<number> {
		const isSchematic = await this.checkSchematicDocument();
		if (!isSchematic) {
			throw new Error('当前文档不是原理图');
		}

		const currentPage = await this.getCurrentPageInfo();
		if (!currentPage) {
			throw new Error('无法获取当前图页信息');
		}

		// 直接获取当前图页的所有元件对象
		const comps = await eda.sch_PrimitiveComponent.getAll();

		// 清除该图页的旧数据
		const oldComponents = componentBuffer.getPageComponents(currentPage.uuid);
		oldComponents.forEach((comp) => {
			componentBuffer.removeComponent(comp.primitiveId);
		});

		// 加载新数据
		const components: ComponentInfo[] = [];
		for (const comp of comps || []) {
			try {
				const info = parseComponent(comp, currentPage.uuid);

				// 加载引脚信息
				try {
					const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(info.primitiveId);
					if (pins && pins.length > 0) {
						info.pins = pins.map(parsePin);
					}
				}
				catch {
					// 忽略引脚加载错误
				}

				components.push(info);
			}
			catch (e) {
				console.warn('[DataLoader] 加载元件失败:', e);
			}
		}

		// 批量添加到缓冲区
		componentBuffer.addComponents(components);

		// 更新图页信息
		componentBuffer.setPage({
			uuid: currentPage.uuid,
			name: currentPage.name,
			index: 0,
			componentCount: components.length,
			cachedAt: Date.now(),
		});

		componentBuffer.setCurrentPage(currentPage.uuid);
		componentBuffer.setLastRefreshTime();

		return components.length;
	}

	/**
	 * 刷新所有图页的元件数据
	 */
	public static async refreshAllPages(): Promise<{ totalPages: number; totalComponents: number }> {
		const isSchematic = await this.checkSchematicDocument();
		if (!isSchematic) {
			throw new Error('当前文档不是原理图');
		}

		// 获取所有图页
		const pages = await this.getAllPageInfos();
		if (pages.length === 0) {
			throw new Error('未找到图页');
		}

		// 获取当前图页 UUID（用于恢复）
		const currentPage = await this.getCurrentPageInfo();
		const originalPageUuid = currentPage?.uuid;

		// 清空缓冲区
		componentBuffer.clear();

		// 设置图页信息
		componentBuffer.setPages(pages.map((p, index) => ({
			uuid: p.uuid,
			name: p.name,
			index,
			componentCount: 0,
			cachedAt: Date.now(),
		})));

		let totalComponents = 0;

		// 遍历所有图页
		for (const page of pages) {
			try {
				// 切换到该图页
				await eda.dmt_EditorControl.openDocument(page.uuid);
				await new Promise(r => setTimeout(r, 100));

				// 直接获取该图页的所有元件对象
				const comps = await eda.sch_PrimitiveComponent.getAll();

				const components: ComponentInfo[] = [];
				for (const comp of comps || []) {
					try {
						const info = parseComponent(comp, page.uuid);

						// 加载引脚信息
						try {
							const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(info.primitiveId);
							if (pins && pins.length > 0) {
								info.pins = pins.map(parsePin);
							}
						}
						catch {
							// 忽略引脚加载错误
						}

						components.push(info);
					}
					catch (e) {
						console.warn(`[DataLoader] 图页 ${page.name} 加载元件失败:`, e);
					}
				}

				// 批量添加到缓冲区
				componentBuffer.addComponents(components);
				totalComponents += components.length;
			}
			catch (e) {
				console.warn(`[DataLoader] 加载图页 ${page.name} 失败:`, e);
			}
		}

		// 恢复到原来的图页
		if (originalPageUuid) {
			try {
				await eda.dmt_EditorControl.openDocument(originalPageUuid);
			}
			catch {
				// 忽略恢复错误
			}
		}

		componentBuffer.setCurrentPage(originalPageUuid || null);
		componentBuffer.setLastRefreshTime();

		return {
			totalPages: pages.length,
			totalComponents,
		};
	}

	/**
	 * 刷新选中的元件
	 */
	public static async refreshSelectedComponents(): Promise<number> {
		const isSchematic = await this.checkSchematicDocument();
		if (!isSchematic) {
			throw new Error('当前文档不是原理图');
		}

		// 获取选中的元件
		let selectedPrimitives: ISCH_Primitive[];
		try {
			selectedPrimitives = await eda.sch_SelectControl.refactorGetAllSelectedPrimitives();
		}
		catch {
			selectedPrimitives = eda.sch_SelectControl.getAllSelectedPrimitives();
		}

		// 过滤出元件类型
		const componentPrimitives = selectedPrimitives.filter(p =>
			readState<string>(p, 'getState_PrimitiveType', ['primitiveType']) === ESCH_PrimitiveType.COMPONENT
			&& readState<string>(p, 'getState_ComponentType', ['componentType']) === ESCH_PrimitiveComponentType.COMPONENT,
		);

		if (componentPrimitives.length === 0) {
			return 0;
		}

		// 获取当前图页
		const currentPage = await this.getCurrentPageInfo();
		if (!currentPage) {
			throw new Error('无法获取当前图页信息');
		}

		// 更新选中的元件
		let updatedCount = 0;
		for (const primitive of componentPrimitives) {
			const primitiveId = readState<string>(primitive, 'getState_PrimitiveId', ['primitiveId']);
			if (!primitiveId)
				continue;

			try {
				const comp = await eda.sch_PrimitiveComponent.get(primitiveId);
				if (comp) {
					const info = parseComponent(comp, currentPage.uuid);

					// 加载引脚信息
					try {
						const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
						if (pins && pins.length > 0) {
							info.pins = pins.map(parsePin);
						}
					}
					catch {
						// 忽略引脚加载错误
					}

					componentBuffer.addComponent(info);
					updatedCount++;
				}
			}
			catch (e) {
				console.warn('[DataLoader] 更新选中元件失败:', primitiveId, e);
			}
		}

		componentBuffer.setLastRefreshTime();
		return updatedCount;
	}

	/**
	 * 从缓冲区获取数据（带缓存检查）
	 * 如果缓存有效则直接返回，否则重新加载
	 */
	public static async getDataWithCache(): Promise<{
		pages: PageInfo[];
		components: ComponentInfo[];
		fromCache: boolean;
	}> {
		// 检查缓存是否有效
		if (componentBuffer.isCacheValid() && componentBuffer.getTotalCount() > 0) {
			return {
				pages: componentBuffer.getPages(),
				components: componentBuffer.getAllComponents(),
				fromCache: true,
			};
		}

		// 缓存无效，重新加载
		await this.refreshAllPages();

		return {
			pages: componentBuffer.getPages(),
			components: componentBuffer.getAllComponents(),
			fromCache: false,
		};
	}
}

export const dataLoader = DataLoader;
