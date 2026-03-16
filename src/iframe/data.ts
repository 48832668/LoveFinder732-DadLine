/**
 * 数据加载模块
 */

import { triggerCompleteAnimation } from './animation';
import { addDebugLog, clearDebugLogs } from './logger';
import { render, renderEmptyState } from './renderer';
import { scanSchematicPage } from './scanner';
import { completedPrimitiveIds, edaApi, memoryBuffer } from './state';
import { showToast } from './utils';

/**
 * 刷新当前图页数据（不跳转页面）
 */
export async function refreshCurrentPageOnly(): Promise<void> {
	addDebugLog('info', '刷新当前图页...');

	try {
		const currentDoc = await edaApi.dmt_SelectControl.getCurrentDocumentInfo();
		if (!currentDoc || currentDoc.documentType !== 1) {
			addDebugLog('warning', '当前文档不是原理图');
			return;
		}

		const currentPage = await edaApi.dmt_Schematic.getCurrentSchematicPageInfo();
		if (!currentPage) {
			addDebugLog('warning', '无法获取当前图页');
			return;
		}

		const pageUuid = currentPage.uuid;
		const pageName = currentPage.name || '未知';

		addDebugLog('info', `当前图页: ${pageName}`);

		const scanResult = await scanSchematicPage(pageUuid, pageName);

		addDebugLog('info', `找到 ${scanResult.wireCount} 条导线`);
		addDebugLog('success', `导线坐标映射完成`);
		addDebugLog('info', `找到 ${scanResult.netLabelCount} 个网络标签`);
		addDebugLog('info', `找到 ${scanResult.noConnectCount} 个非连接标识`);
		addDebugLog('info', `找到 ${scanResult.components.length} 个元件`);

		const currentPagePrimitiveIds = new Set<string>();
		let updatedCount = 0;
		let newConnectedPins = 0;
		let newTotalPins = 0;

		for (const comp of scanResult.components) {
			currentPagePrimitiveIds.add(comp.primitiveId);

			const totalPins = comp.totalPins;
			const connectedCount = comp.connectedPins;
			const isNowCompleted = comp.completed;

			const wasCompleted = completedPrimitiveIds.has(comp.primitiveId);
			const isNewlyCompleted = isNowCompleted && !wasCompleted;

			const existingIndex = memoryBuffer.components.findIndex(
				c => c.primitiveId === comp.primitiveId && c.schematicPageUuid === pageUuid,
			);

			if (existingIndex >= 0) {
				memoryBuffer.components[existingIndex] = comp;
				updatedCount++;

				if (isNewlyCompleted) {
					triggerCompleteAnimation(comp.primitiveId, pageUuid);
				}
			}
			else {
				memoryBuffer.components.push(comp);

				if (isNewlyCompleted) {
					triggerCompleteAnimation(comp.primitiveId, pageUuid);
				}
			}

			if (isNowCompleted) {
				completedPrimitiveIds.set(comp.primitiveId, pageUuid);
			}
			else {
				completedPrimitiveIds.delete(comp.primitiveId);
			}

			newConnectedPins += connectedCount;
			newTotalPins += totalPins;
		}

		// 移除当前页中已删除的元件
		const beforeCount = memoryBuffer.components.length;
		const deletedFromCurrentPage: string[] = [];
		memoryBuffer.components = memoryBuffer.components.filter((c) => {
			if (c.schematicPageUuid === pageUuid) {
				const exists = currentPagePrimitiveIds.has(c.primitiveId);
				if (!exists) {
					deletedFromCurrentPage.push(c.primitiveId);
				}
				return exists;
			}
			return true;
		});
		const removedCount = beforeCount - memoryBuffer.components.length;
		if (removedCount > 0) {
			addDebugLog('info', `移除了 ${removedCount} 个已删除的元件`);
		}

		for (const id of deletedFromCurrentPage) {
			completedPrimitiveIds.delete(id);
		}

		// 更新总进度
		let otherPagesPins = 0;
		let otherPagesConnected = 0;
		for (const comp of memoryBuffer.components) {
			if (comp.schematicPageUuid !== pageUuid) {
				otherPagesPins += comp.totalPins;
				otherPagesConnected += comp.connectedPins;
			}
		}

		memoryBuffer.totalPins = otherPagesPins + newTotalPins;
		memoryBuffer.connectedPins = otherPagesConnected + newConnectedPins;
		memoryBuffer.totalProgress = memoryBuffer.totalPins > 0
			? Math.round((memoryBuffer.connectedPins / memoryBuffer.totalPins) * 100)
			: 0;
		memoryBuffer.cachedAt = Date.now();

		render();
		addDebugLog('success', `当前图页刷新完成: ${updatedCount} 个元件已更新, 总进度: ${memoryBuffer.totalProgress}%`);
	}
	catch (e: any) {
		addDebugLog('error', '刷新当前图页失败', e);
	}
}

/**
 * 刷新所有图页数据
 */
export async function refreshData(): Promise<void> {
	clearDebugLogs();
	addDebugLog('info', '开始扫描原理图...');

	try {
		const currentDoc = await edaApi.dmt_SelectControl.getCurrentDocumentInfo();
		if (!currentDoc || currentDoc.documentType !== 1) {
			addDebugLog('warning', '当前文档不是原理图');
			showToast('请先打开原理图文档', 'warning');
			renderEmptyState('请先打开原理图文档');
			return;
		}
		addDebugLog('info', '当前文档类型', currentDoc.documentType);

		const allPages = (await edaApi.dmt_Schematic.getCurrentSchematicAllSchematicPagesInfo()) || [];
		if (allPages.length === 0) {
			addDebugLog('warning', '未找到图页');
			showToast('未找到图页', 'warning');
			renderEmptyState('未找到图页');
			return;
		}
		addDebugLog('success', `找到 ${allPages.length} 个图页`);

		const currentPage = await edaApi.dmt_Schematic.getCurrentSchematicPageInfo();
		const currentPageUuid = currentPage?.uuid;

		// 重置缓冲区
		memoryBuffer.pages = [];
		memoryBuffer.components = [];
		memoryBuffer.currentPageUuid = currentPageUuid;
		memoryBuffer.totalPins = 0;
		memoryBuffer.connectedPins = 0;
		completedPrimitiveIds.clear();

		// 构建页面列表
		for (let i = 0; i < allPages.length; i++) {
			const page = allPages[i];
			memoryBuffer.pages.push({
				uuid: page.uuid,
				name: page.name,
				index: i,
			});
		}

		// 遍历所有图页
		for (const page of memoryBuffer.pages) {
			addDebugLog('info', `扫描图页: ${page.name}`);

			const scanResult = await scanSchematicPage(page.uuid, page.name);

			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.wireCount} 条导线`);
			addDebugLog('success', `导线坐标映射完成`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.netLabelCount} 个网络标签`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.noConnectCount} 个非连接标识`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.components.length} 个元件`);

			for (const comp of scanResult.components) {
				memoryBuffer.components.push(comp);
				memoryBuffer.totalPins += comp.totalPins;
				memoryBuffer.connectedPins += comp.connectedPins;

				if (comp.completed) {
					completedPrimitiveIds.set(comp.primitiveId, page.uuid);
				}
			}
		}

		// 恢复原当前图页
		if (currentPageUuid) {
			try {
				await edaApi.dmt_EditorControl.openDocument(currentPageUuid);
			}
			catch {}
		}

		// 计算总进度
		memoryBuffer.totalProgress = memoryBuffer.totalPins > 0
			? Math.round((memoryBuffer.connectedPins / memoryBuffer.totalPins) * 100)
			: 0;
		memoryBuffer.cachedAt = Date.now();

		render();

		const completedCount = completedPrimitiveIds.size;
		const totalCount = memoryBuffer.components.length + completedCount;
		addDebugLog('success', `扫描完成: ${completedCount}/${totalCount} 元件已完成, ${memoryBuffer.connectedPins}/${memoryBuffer.totalPins} 引脚已连接`);
		showToast(`扫描完成！${completedCount}/${totalCount} 个元件已完成`, 'success');
	}
	catch (e: any) {
		addDebugLog('error', '扫描失败', e);
		showToast(`扫描失败: ${e.message || e}`, 'error');
		renderEmptyState(`扫描失败: ${e.message || e}`);
	}
}
