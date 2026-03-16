/**
 * 动画效果模块
 */

import { addDebugLog } from './logger';
import { render } from './renderer';
import { completedPrimitiveIds } from './state';

/**
 * 触发元件完成动画
 */
export function triggerCompleteAnimation(primitiveId: string, pageUuid: string): void {
	completedPrimitiveIds.set(primitiveId, pageUuid);

	setTimeout(() => {
		const taskItem = document.querySelector(`[data-primitive-id="${primitiveId}"]`) as HTMLElement;
		if (taskItem) {
			taskItem.classList.add('completed-animate');

			setTimeout(() => {
				render();
				addDebugLog('success', `元件已完成: ${primitiveId}`);
			}, 800);
		}
		else {
			render();
		}
	}, 100);
}
