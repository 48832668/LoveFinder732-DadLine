/**
 * DadLine - 工程进度可视化插件
 * 任务清单 + 激励式界面
 */

// ==================== 数据结构 ====================

interface PinInfo {
	number: string;
	name: string;
	x: number;
	y: number;
	net: string | null;
	connected: boolean;
	detectMethod: string; // 调试：检测方法
	noConnect: boolean; // 是否有非连接标识
}

interface ComponentTask {
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

interface PageData {
	uuid: string;
	name: string;
	index: number;
}

interface BufferData {
	pages: PageData[];
	components: ComponentTask[];
	currentPageUuid: string | null;
	totalPins: number;
	connectedPins: number;
	totalProgress: number;
	cachedAt: number;
}

// 内存缓冲区
const memoryBuffer: BufferData = {
	pages: [],
	components: [],
	currentPageUuid: null,
	totalPins: 0,
	connectedPins: 0,
	totalProgress: 0,
	cachedAt: 0,
};

// 调试日志
interface DebugLog {
	time: string;
	level: 'info' | 'success' | 'warning' | 'error';
	message: string;
	details?: any;
}
const debugLogs: DebugLog[] = [];

// EDA API
const edaApi = (window as any).eda || (window.parent as any)?.eda || (window.top as any)?.eda;

// 状态
let searchText = '';
let debugExpanded = false;
let autoRefreshEnabled = false;
let autoRefreshInterval: number | null = null;
const completedPrimitiveIds: Map<string, string> = new Map(); // primitiveId -> pageUuid，记录已完成的元件

// ==================== DOM 元素 ====================

const $ = (id: string) => document.getElementById(id);

// ==================== 调试日志 ====================

function addDebugLog(level: DebugLog['level'], message: string, details?: any): void {
	const log: DebugLog = {
		time: new Date().toLocaleTimeString(),
		level,
		message,
		details,
	};
	debugLogs.push(log);
	// 不再输出到 console，由定时器统一输出
	renderDebugPanel();
}

// 每秒输出缓冲池信息到 console
let consoleLogInterval: number | null = null;

function startConsoleLog(): void {
	if (consoleLogInterval)
		return;

	consoleLogInterval = window.setInterval(() => {
		if (memoryBuffer.components.length === 0) {
			// eslint-disable-next-line no-console
			console.log('[DadLine] 缓冲池为空');
			return;
		}

		// eslint-disable-next-line no-console
		console.log('===== DadLine 缓冲池 =====');
		for (const comp of memoryBuffer.components) {
			const status = completedPrimitiveIds.has(comp.primitiveId) ? '✅' : `${comp.progress}%`;
			// eslint-disable-next-line no-console
			console.log(`${comp.pageName} | ${comp.connectedPins}/${comp.totalPins}引脚 | ${comp.designator} | ${comp.name || '-'} | ${status}`);
		}
		// eslint-disable-next-line no-console
		console.log(`总计: ${completedPrimitiveIds.size}/${memoryBuffer.components.length} 元件完成, ${memoryBuffer.connectedPins}/${memoryBuffer.totalPins} 引脚连接`);
	}, 1000);
}

function renderDebugPanel(): void {
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

// ==================== 工具函数 ====================

// ==================== 图页扫描核心函数 ====================

interface ScanPageResult {
	components: ComponentTask[];
	wireCount: number;
	netLabelCount: number;
	noConnectCount: number;
}

/**
 * 扫描单个图页，返回元件和连接信息
 * 这是两个刷新函数共用的底层函数
 */
async function scanSchematicPage(pageUuid: string, pageName: string): Promise<ScanPageResult> {
	const result: ScanPageResult = {
		components: [],
		wireCount: 0,
		netLabelCount: 0,
		noConnectCount: 0,
	};

	try {
		await edaApi.dmt_EditorControl.openDocument(pageUuid);
		await new Promise(r => setTimeout(r, 100));

		// ===== 1. 获取导线并建立坐标映射 =====
		const wires = (await edaApi.sch_PrimitiveWire.getAll()) || [];
		result.wireCount = wires.length;

		const wireCoordMap = new Map<string, { net: string | null; primitiveId: string }>();
		for (const wire of wires) {
			try {
				const line = wire.line ?? wire.getState_Line?.();
				const net = wire.net ?? wire.getState_Net?.() ?? null;
				const primitiveId = wire.primitiveId ?? wire.getState_PrimitiveId?.() ?? '';

				if (!line || !Array.isArray(line))
					continue;

				if (typeof line[0] === 'number') {
					for (let i = 0; i < line.length; i += 2) {
						const key = `${line[i]},${line[i + 1]}`;
						if (!wireCoordMap.has(key)) {
							wireCoordMap.set(key, { net, primitiveId });
						}
					}
				}
				else {
					for (const pt of line) {
						if (Array.isArray(pt) && pt.length >= 2) {
							const key = `${pt[0]},${pt[1]}`;
							if (!wireCoordMap.has(key)) {
								wireCoordMap.set(key, { net, primitiveId });
							}
						}
					}
				}
			}
			catch {}
		}

		// ===== 2. 获取网络标签并建立坐标映射 =====
		let netLabels: any[] = [];
		try {
			netLabels = (await edaApi.sch_PrimitiveComponent.getAll(
				(window as any).ESCH_PrimitiveComponentType?.NET_LABEL,
			)) || [];
		}
		catch {}
		result.netLabelCount = netLabels.length;

		const netLabelCoordMap = new Map<string, string>();
		for (const label of netLabels) {
			try {
				const x = label.x ?? label.getState_X?.();
				const y = label.y ?? label.getState_Y?.();
				const netName = label.name ?? label.getState_Name?.();

				if (x !== undefined && y !== undefined && netName) {
					const key = `${x},${y}`;
					netLabelCoordMap.set(key, netName);
				}
			}
			catch {}
		}

		// ===== 3. 获取非连接标识（备用，主要通过引脚 noConnected 属性检测）=====
		let noConnectFlags: any[] = [];
		try {
			noConnectFlags = (await edaApi.sch_PrimitiveComponent.getAll(
				(window as any).ESCH_PrimitiveComponentType?.NON_ELECTRICAL_FLAG,
			)) || [];
		}
		catch {}
		result.noConnectCount = noConnectFlags.length;

		const noConnectCoordMap = new Set<string>();
		for (const flag of noConnectFlags) {
			try {
				const x = flag.x ?? flag.getState_X?.();
				const y = flag.y ?? flag.getState_Y?.();

				if (x !== undefined && y !== undefined) {
					const key = `${x},${y}`;
					noConnectCoordMap.add(key);
				}
			}
			catch {}
		}

		// ===== 4. 获取元件并检测引脚连接状态 =====
		const comps = await edaApi.sch_PrimitiveComponent.getAll();

		for (const comp of comps || []) {
			try {
				const designator = comp.getState_Designator?.() || comp.designator || '';
				if (!designator)
					continue;

				const compName = comp.manufacturerId || comp.getState_Name?.() || comp.name || '';
				const primitiveId = comp.primitiveId || comp.getState_PrimitiveId?.() || '';

				const pins = await edaApi.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
				if (!pins || pins.length === 0)
					continue;

				const pinList: PinInfo[] = [];
				let connectedCount = 0;

				for (const pin of pins) {
					const pinX = pin.getState_X?.() ?? pin.x;
					const pinY = pin.getState_Y?.() ?? pin.y;
					const pinName = pin.getState_PinName?.() || pin.pinName || '';
					const pinNumber = pin.getState_PinNumber?.() || pin.pinNumber || '';

					if (pinX === undefined || pinY === undefined)
						continue;

					const key = `${pinX},${pinY}`;

					let net: string | null = null;
					let connected = false;
					let detectMethod = 'none';
					let noConnect = false;

					// 方式0：检查引脚的 noConnected 属性（非连接标识）
					const pinNoConnected = pin.noConnected ?? pin.getState_NoConnected?.();
					if (pinNoConnected === true || pinNoConnected === 'true' || pinNoConnected === 1) {
						noConnect = true;
						detectMethod = 'pin_noConnected_prop';
						connected = true;
					}

					// 方式1：检查非连接标识坐标（备用）
					if (!connected && noConnectCoordMap.has(key)) {
						noConnect = true;
						detectMethod = 'no_connect_flag';
						connected = true;
					}

					// 方式2：检查网络标签
					if (!connected && netLabelCoordMap.has(key)) {
						net = netLabelCoordMap.get(key) || null;
						connected = true;
						detectMethod = 'netlabel_coord';
					}

					// 方式3：检查导线
					if (!connected && wireCoordMap.has(key)) {
						const wireInfo = wireCoordMap.get(key);
						net = wireInfo?.net || null;
						connected = true;
						detectMethod = 'wire_coord';
					}

					// 方式4：尝试直接读取引脚属性
					if (!connected) {
						try {
							const pinNet = pin.net ?? pin.getState_Net?.();
							if (pinNet) {
								net = pinNet;
								connected = true;
								detectMethod = 'pin_net_prop';
							}
						}
						catch {}
					}

					// 方式5：检查元件的net属性
					if (!connected) {
						try {
							const compNet = comp.net ?? comp.getState_Net?.();
							if (compNet) {
								net = compNet;
								connected = true;
								detectMethod = 'comp_net_prop';
							}
						}
						catch {}
					}

					if (connected)
						connectedCount++;

					pinList.push({
						number: pinNumber,
						name: pinName,
						x: pinX,
						y: pinY,
						net,
						connected,
						detectMethod,
						noConnect,
					});
				}

				const totalPins = pinList.length;
				const progress = totalPins > 0 ? Math.round((connectedCount / totalPins) * 100) : 0;

				result.components.push({
					primitiveId,
					designator,
					name: compName,
					schematicPageUuid: pageUuid,
					pageName,
					pins: pinList,
					totalPins,
					connectedPins: connectedCount,
					progress,
					completed: progress === 100,
				});
			}
			catch {}
		}
	}
	catch (e) {
		addDebugLog('error', `扫描图页 ${pageName} 失败`, e);
	}

	return result;
}

// ==================== 其他工具函数 ====================

function showToast(msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
	if (edaApi?.sys_Message) {
		const t = {
			success: (window as any).ESYS_ToastMessageType?.SUCCESS,
			error: (window as any).ESYS_ToastMessageType?.ERROR,
			warning: (window as any).ESYS_ToastMessageType?.WARNING,
		}[type] || (window as any).ESYS_ToastMessageType?.INFO;
		try {
			edaApi.sys_Message.showToastMessage(msg, t, 3);
		}
		catch (e) {
			console.error('Toast failed:', e);
		}
	}
}

// ==================== 数据加载 ====================

/**
 * 刷新当前图页数据（不跳转页面）
 */
async function refreshCurrentPageOnly(): Promise<void> {
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

		// 使用共用的扫描函数
		const scanResult = await scanSchematicPage(pageUuid, pageName);

		addDebugLog('info', `找到 ${scanResult.wireCount} 条导线`);
		addDebugLog('success', `导线坐标映射完成`);
		addDebugLog('info', `找到 ${scanResult.netLabelCount} 个网络标签`);
		addDebugLog('info', `找到 ${scanResult.noConnectCount} 个非连接标识`);
		addDebugLog('info', `找到 ${scanResult.components.length} 个元件`);

		// 记录当前页所有元件ID（用于检测删除的元件）
		const currentPagePrimitiveIds = new Set<string>();

		// 更新当前图页的元件数据
		let updatedCount = 0;
		let newConnectedPins = 0;
		let newTotalPins = 0;

		for (const comp of scanResult.components) {
			currentPagePrimitiveIds.add(comp.primitiveId);

			const totalPins = comp.totalPins;
			const connectedCount = comp.connectedPins;
			const isNowCompleted = comp.completed;

			// 检测是否是新完成的元件
			const wasCompleted = completedPrimitiveIds.has(comp.primitiveId);
			const isNewlyCompleted = isNowCompleted && !wasCompleted;

			// 查找并更新现有元件
			const existingIndex = memoryBuffer.components.findIndex(
				c => c.primitiveId === comp.primitiveId && c.schematicPageUuid === pageUuid,
			);

			// 更新或添加元件（保留已完成元件的数据在缓存中）
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

			// 更新完成状态标记
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

		// 清理已完成记录中当前页已删除的元件
		for (const id of deletedFromCurrentPage) {
			completedPrimitiveIds.delete(id);
		}

		// 更新总进度（保留其他页面的数据）
		// 现在已完成元件的数据也保留在 memoryBuffer.components 中
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

async function refreshData(): Promise<void> {
	debugLogs.length = 0;
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
		completedPrimitiveIds.clear(); // 清除完成记录

		// 构建页面列表
		for (let i = 0; i < allPages.length; i++) {
			const page = allPages[i];
			memoryBuffer.pages.push({
				uuid: page.uuid,
				name: page.name,
				index: i,
			});
		}

		// 遍历所有图页，使用共用的扫描函数
		for (const page of memoryBuffer.pages) {
			addDebugLog('info', `扫描图页: ${page.name}`);

			const scanResult = await scanSchematicPage(page.uuid, page.name);

			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.wireCount} 条导线`);
			addDebugLog('success', `导线坐标映射完成`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.netLabelCount} 个网络标签`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.noConnectCount} 个非连接标识`);
			addDebugLog('info', `图页 ${page.name}: 找到 ${scanResult.components.length} 个元件`);

			// 处理扫描结果
			for (const comp of scanResult.components) {
				// 所有元件都添加到缓存中（保留数据用于切换图页时统计）
				memoryBuffer.components.push(comp);
				memoryBuffer.totalPins += comp.totalPins;
				memoryBuffer.connectedPins += comp.connectedPins;

				// 已完成的元件记录到完成列表
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

// ==================== 渲染 ====================

function render(): void {
	renderHeader();
	renderTaskList();
}

function renderHeader(): void {
	const { totalProgress, totalPins, connectedPins, components } = memoryBuffer;
	const completedCount = completedPrimitiveIds.size;
	const totalCount = components.length;

	// 更新进度数字
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
		const circumference = 2 * Math.PI * 32; // r=32
		const offset = circumference - (totalProgress / 100) * circumference;
		progressCircle.style.strokeDasharray = `${circumference}`;
		progressCircle.style.strokeDashoffset = `${offset}`;
	}

	// 更新背景渐变
	const progressHeader = $('progressHeader');
	if (progressHeader) {
		// 移除所有进度class
		progressHeader.classList.remove('progress-0', 'progress-10', 'progress-30', 'progress-50', 'progress-70', 'progress-90', 'progress-100');
		// 添加对应的进度class
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

function renderTaskList(): void {
	const container = $('taskListContainer');
	if (!container)
		return;

	// 过滤掉已完成的元件（已在动画中移除）
	let filtered = memoryBuffer.components.filter(c => !completedPrimitiveIds.has(c.primitiveId));

	// 搜索过滤
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
		// 判断是搜索无结果还是全部完成
		let emptyMessage = '暂无元件数据';
		let emptyIcon = '📋';

		if (searchText) {
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

function renderTaskItem(comp: ComponentTask): string {
	const statusIcon = comp.completed ? '✅' : (comp.progress > 0 ? '🔧' : '⏳');
	const statusClass = comp.completed ? 'task-completed' : (comp.progress > 0 ? 'task-progress' : 'task-pending');
	const completedClass = comp.completed ? 'completed-animate' : '';

	// 引脚排序：未连接的排在前面，方便用户查找
	const sortedPins = [...comp.pins].sort((a, b) => {
		// 已连接的排在后面
		if (a.connected !== b.connected) {
			return a.connected ? 1 : -1;
		}
		// 同状态按引脚号排序
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

function getProgressClass(progress: number): string {
	if (progress >= 100)
		return 'progress-complete';
	if (progress >= 70)
		return 'progress-high';
	if (progress >= 30)
		return 'progress-medium';
	return 'progress-low';
}

function getMotivationText(progress: number, completed: number, total: number): string {
	// 根据进度百分比细化激励标语
	if (progress >= 100)
		return '🎉 完美！原理图全部完成！';
	if (progress >= 95)
		return '🏆 就差一点点了！';
	if (progress >= 90)
		return '🚀 冲刺阶段，加油！';
	if (progress >= 80)
		return '💪 进入最后阶段！';
	if (progress >= 70)
		return '🔥 进展神速！';
	if (progress >= 60)
		return '⭐ 超过六成了！';
	if (progress >= 50)
		return '📈 半程里程碑达成！';
	if (progress >= 40)
		return '🎯 稳步推进中！';
	if (progress >= 30)
		return '🌟 势头不错！';
	if (progress >= 20)
		return '🔨 渐入佳境！';
	if (progress >= 10)
		return '🌱 良好的开始！';
	if (progress >= 5)
		return '▶️ 刚刚起步！';
	if (total === 0)
		return '📋 等待加载元件...';
	return '🎯 开始连接元件吧！';
}

function renderEmptyState(message: string): void {
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

	// 重置背景
	const progressHeader = $('progressHeader');
	if (progressHeader) {
		progressHeader.classList.remove('progress-0', 'progress-10', 'progress-30', 'progress-50', 'progress-70', 'progress-90', 'progress-100');
		progressHeader.classList.add('progress-0');
	}
}

// ==================== 事件处理 ====================

function toggleAutoRefresh(): void {
	autoRefreshEnabled = !autoRefreshEnabled;

	const btn = $('autoRefreshBtn');
	if (btn) {
		btn.textContent = autoRefreshEnabled ? '⏸️' : '▶️';
		btn.title = autoRefreshEnabled ? '暂停自动刷新' : '开启自动刷新';
		btn.classList.toggle('active', autoRefreshEnabled);
	}

	if (autoRefreshEnabled) {
		addDebugLog('info', '自动刷新已开启 (1秒间隔)');
		autoRefreshInterval = window.setInterval(() => {
			refreshCurrentPageOnly();
		}, 1000);
	}
	else {
		addDebugLog('info', '自动刷新已关闭');
		if (autoRefreshInterval) {
			clearInterval(autoRefreshInterval);
			autoRefreshInterval = null;
		}
	}
}

function initEvents(): void {
	// 刷新按钮 - 点击时停止自动刷新
	const refreshBtn = $('refreshBtn');
	if (refreshBtn) {
		refreshBtn.onclick = () => {
			// 停止自动刷新
			if (autoRefreshEnabled) {
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
			searchText = (e.target as HTMLInputElement).value;
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
			debugExpanded = !debugExpanded;
			const content = $('debugContent');
			const icon = $('debugToggleIcon');
			if (content) {
				content.style.display = debugExpanded ? 'block' : 'none';
			}
			if (icon) {
				icon.textContent = debugExpanded ? '▼' : '▶';
			}
		};
	}
}

// ==================== 元件选择 ====================

async function selectComponent(primitiveId: string, pageUuid: string): Promise<void> {
	addDebugLog('info', `选中元件: ${primitiveId}`);

	try {
		// 获取当前图页
		const currentPage = await edaApi.dmt_Schematic.getCurrentSchematicPageInfo();
		const currentPageUuid = currentPage?.uuid;

		// 如果不是当前图页，先切换图页
		if (currentPageUuid !== pageUuid) {
			addDebugLog('info', `切换到图页: ${pageUuid}`);
			await edaApi.dmt_EditorControl.openDocument(pageUuid);
			await new Promise(r => setTimeout(r, 300)); // 等待图页切换完成
		}

		// 清除当前选中
		await edaApi.sch_SelectControl.clearSelected();

		// 使用图元ID选中元件
		await edaApi.sch_SelectControl.doSelectPrimitives([primitiveId]);

		addDebugLog('success', '元件已选中');
	}
	catch (e) {
		addDebugLog('error', '选中元件失败', e);
	}
}

// ==================== 完成动画 ====================

function triggerCompleteAnimation(primitiveId: string, pageUuid: string): void {
	// 记录为已完成
	completedPrimitiveIds.set(primitiveId, pageUuid);

	// 找到对应的DOM元素并添加动画类
	setTimeout(() => {
		const taskItem = document.querySelector(`[data-primitive-id="${primitiveId}"]`) as HTMLElement;
		if (taskItem) {
			taskItem.classList.add('completed-animate');

			// 动画结束后重新渲染（不从缓冲区移除，保留数据用于统计）
			setTimeout(() => {
				render();
				addDebugLog('success', `元件已完成: ${primitiveId}`);
			}, 800); // 动画持续时间
		}
		else {
			// 如果没有DOM元素（比如元件不在当前图页），直接渲染
			render();
		}
	}, 100);
}

// ==================== 初始化 ====================

async function init(): Promise<void> {
	initEvents();
	startConsoleLog(); // 启动每秒console输出
	await refreshData();
}

init();
