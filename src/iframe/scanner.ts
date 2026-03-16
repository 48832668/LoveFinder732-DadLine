/**
 * 图页扫描模块
 */

import type { PinInfo, ScanPageResult } from './types';
import { addDebugLog } from './logger';
import { edaApi } from './state';

/**
 * 扫描单个图页，返回元件和连接信息
 */
export async function scanSchematicPage(pageUuid: string, pageName: string): Promise<ScanPageResult> {
	const result: ScanPageResult = {
		components: [],
		wireCount: 0,
		netLabelCount: 0,
		noConnectCount: 0,
	};

	try {
		await edaApi.dmt_EditorControl.openDocument(pageUuid);
		await new Promise(r => setTimeout(r, 100));

		// 获取导线并建立坐标映射
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

		// 获取网络标签并建立坐标映射
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

		// 获取非连接标识
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

		// 获取元件并检测引脚连接状态
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

					// 检查引脚的 noConnected 属性
					const pinNoConnected = pin.noConnected ?? pin.getState_NoConnected?.();
					if (pinNoConnected === true || pinNoConnected === 'true' || pinNoConnected === 1) {
						noConnect = true;
						detectMethod = 'pin_noConnected_prop';
						connected = true;
					}

					// 检查非连接标识坐标
					if (!connected && noConnectCoordMap.has(key)) {
						noConnect = true;
						detectMethod = 'no_connect_flag';
						connected = true;
					}

					// 检查网络标签
					if (!connected && netLabelCoordMap.has(key)) {
						net = netLabelCoordMap.get(key) || null;
						connected = true;
						detectMethod = 'netlabel_coord';
					}

					// 检查导线
					if (!connected && wireCoordMap.has(key)) {
						const wireInfo = wireCoordMap.get(key);
						net = wireInfo?.net || null;
						connected = true;
						detectMethod = 'wire_coord';
					}

					// 尝试直接读取引脚属性
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

					// 检查元件的net属性
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
