/**
 * EDA API 封装模块
 */

import { addDebugLog } from './logger';
import { edaApi } from './state';

/**
 * 选中元件
 */
export async function selectComponent(primitiveId: string, pageUuid: string): Promise<void> {
	addDebugLog('info', `选中元件: ${primitiveId}`);

	try {
		const currentPage = await edaApi.dmt_Schematic.getCurrentSchematicPageInfo();
		const currentPageUuid = currentPage?.uuid;

		// 如果不是当前图页，先切换图页
		if (currentPageUuid !== pageUuid) {
			addDebugLog('info', `切换到图页: ${pageUuid}`);
			await edaApi.dmt_EditorControl.openDocument(pageUuid);
			await new Promise(r => setTimeout(r, 300));
		}

		// 清除当前选中并选中新元件
		await edaApi.sch_SelectControl.clearSelected();
		await edaApi.sch_SelectControl.doSelectPrimitives([primitiveId]);

		addDebugLog('success', '元件已选中');
	}
	catch (e) {
		addDebugLog('error', '选中元件失败', e);
	}
}
