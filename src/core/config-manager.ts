/**
 * 配置管理模块
 *
 * 提供配置的存储、导入导出功能
 * 支持供电检查策略等配置项
 */

// 当前配置版本号
export const CONFIG_VERSION = '26.3.16';

/**
 * 供电检查策略配置
 */
export interface PowerCheckConfig {
	/** 是否启用供电检查 */
	enabled: boolean;
	/** 需要检查供电的位号前缀列表 */
	designatorPrefixes: string[];
	/** 自定义规则（正则表达式字符串） */
	customRules: string[];
}

/**
 * 插件配置接口
 */
export interface PluginConfig {
	/** 配置版本号 */
	version: string;
	/** 供电检查策略 */
	powerCheck: PowerCheckConfig;
	/** 最后更新时间 */
	lastUpdated: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: PluginConfig = {
	version: CONFIG_VERSION,
	powerCheck: {
		enabled: true,
		designatorPrefixes: ['U'],
		customRules: [],
	},
	lastUpdated: Date.now(),
};

/**
 * 配置管理器类
 */
export class ConfigManager {
	private static instance: ConfigManager;
	private config: PluginConfig;
	private listeners: Array<(config: PluginConfig) => void> = [];

	private constructor() {
		this.config = this.loadFromStorage();
	}

	/**
	 * 获取单例实例
	 */
	public static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	/**
	 * 从本地存储加载配置
	 */
	private loadFromStorage(): PluginConfig {
		try {
			const stored = localStorage.getItem('dadline-config');
			if (stored) {
				const parsed = JSON.parse(stored) as Partial<PluginConfig>;
				// 合并默认配置和存储的配置
				return this.mergeConfig(parsed);
			}
		}
		catch (e) {
			console.warn('[ConfigManager] 加载配置失败:', e);
		}
		return { ...DEFAULT_CONFIG };
	}

	/**
	 * 合并配置（处理版本升级）
	 */
	private mergeConfig(stored: Partial<PluginConfig>): PluginConfig {
		return {
			version: CONFIG_VERSION,
			powerCheck: {
				enabled: stored.powerCheck?.enabled ?? DEFAULT_CONFIG.powerCheck.enabled,
				designatorPrefixes: stored.powerCheck?.designatorPrefixes ?? [...DEFAULT_CONFIG.powerCheck.designatorPrefixes],
				customRules: stored.powerCheck?.customRules ?? [...DEFAULT_CONFIG.powerCheck.customRules],
			},
			lastUpdated: stored.lastUpdated ?? Date.now(),
		};
	}

	/**
	 * 保存配置到本地存储
	 */
	private saveToStorage(): void {
		try {
			this.config.lastUpdated = Date.now();
			localStorage.setItem('dadline-config', JSON.stringify(this.config));
		}
		catch (e) {
			console.warn('[ConfigManager] 保存配置失败:', e);
		}
	}

	/**
	 * 获取当前配置
	 */
	public getConfig(): PluginConfig {
		return { ...this.config };
	}

	/**
	 * 更新完整配置
	 */
	public setConfig(config: PluginConfig): void {
		this.config = { ...config, version: CONFIG_VERSION };
		this.saveToStorage();
		this.notifyListeners();
	}

	/**
	 * 更新供电检查配置
	 */
	public setPowerCheckConfig(powerCheck: PowerCheckConfig): void {
		this.config.powerCheck = { ...powerCheck };
		this.saveToStorage();
		this.notifyListeners();
	}

	/**
	 * 检查元件是否需要供电检查
	 */
	public shouldCheckPower(designator: string): boolean {
		if (!this.config.powerCheck.enabled) {
			return false;
		}

		// 检查位号前缀
		for (const prefix of this.config.powerCheck.designatorPrefixes) {
			if (designator.toUpperCase().startsWith(prefix.toUpperCase())) {
				return true;
			}
		}

		// 检查自定义规则
		for (const rule of this.config.powerCheck.customRules) {
			try {
				const regex = new RegExp(rule, 'i');
				if (regex.test(designator)) {
					return true;
				}
			}
			catch {
				// 忽略无效的正则表达式
			}
		}

		return false;
	}

	/**
	 * 导出配置为 JSON 字符串
	 */
	public exportConfig(): string {
		const exportData = {
			...this.config,
			version: CONFIG_VERSION,
			exportedAt: Date.now(),
		};
		return JSON.stringify(exportData, null, 2);
	}

	/**
	 * 导入配置
	 */
	public importConfig(jsonString: string): boolean {
		try {
			const imported = JSON.parse(jsonString) as Partial<PluginConfig>;

			// 验证基本结构
			if (!imported.powerCheck) {
				throw new Error('配置格式错误：缺少 powerCheck 字段');
			}

			// 合并配置
			this.config = this.mergeConfig(imported);
			this.saveToStorage();
			this.notifyListeners();
			return true;
		}
		catch (e) {
			console.error('[ConfigManager] 导入配置失败:', e);
			return false;
		}
	}

	/**
	 * 重置为默认配置
	 */
	public resetToDefault(): void {
		this.config = { ...DEFAULT_CONFIG };
		this.saveToStorage();
		this.notifyListeners();
	}

	/**
	 * 添加配置变更监听器
	 */
	public addListener(listener: (config: PluginConfig) => void): void {
		this.listeners.push(listener);
	}

	/**
	 * 移除配置变更监听器
	 */
	public removeListener(listener: (config: PluginConfig) => void): void {
		const index = this.listeners.indexOf(listener);
		if (index > -1) {
			this.listeners.splice(index, 1);
		}
	}

	/**
	 * 通知所有监听器
	 */
	private notifyListeners(): void {
		const configCopy = this.getConfig();
		this.listeners.forEach((listener) => {
			try {
				listener(configCopy);
			}
			catch (e) {
				console.error('[ConfigManager] 监听器执行失败:', e);
			}
		});
	}
}

// 导出单例实例
export const configManager = ConfigManager.getInstance();
