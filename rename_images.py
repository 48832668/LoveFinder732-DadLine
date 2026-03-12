#!/usr/bin/env python3
"""
重命名README中的图片文件，将长数字文件名改为00X顺序格式
"""

import os
import re
import shutil

# 项目根目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
README_PATH = os.path.join(BASE_DIR, 'README.md')
IMAGES_DIR = os.path.join(BASE_DIR, 'images', 'README')

def main():
    # 读取README内容
    with open(README_PATH, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 查找所有图片引用: ![xxx](images/README/xxx.png)
    # 匹配任意文件名（不只是数字）
    pattern = r'!\[([^\]]*)\]\(images/README/([^)]+)\.png\)'
    matches = re.findall(pattern, content)
    
    if not matches:
        print("未找到需要重命名的图片引用")
        return
    
    print(f"找到 {len(matches)} 个图片引用")
    
    # 创建映射: 旧文件名 -> 新文件名
    rename_map = {}
    for i, (alt_text, filename) in enumerate(matches, 1):
        new_name = f"{i:03d}"  # 001, 002, 003...
        rename_map[filename] = new_name
        print(f"  {filename}.png -> {new_name}.png")
    
    # 重命名文件（不删除任何现有文件）
    for old_name, new_name in rename_map.items():
        old_path = os.path.join(IMAGES_DIR, f"{old_name}.png")
        new_path = os.path.join(IMAGES_DIR, f"{new_name}.png")
        
        if not os.path.exists(old_path):
            print(f"警告: 源文件不存在 {old_path}")
            continue
        
        if old_path == new_path:
            print(f"跳过: {old_name}.png 已是目标名称")
            continue
        
        if os.path.exists(new_path):
            print(f"警告: 目标文件已存在 {new_path}，跳过")
            continue
        
        shutil.move(old_path, new_path)
        print(f"已重命名: {old_name}.png -> {new_name}.png")
    
    # 更新README中的引用（alt文本和文件路径）
    for old_name, new_name in rename_map.items():
        content = re.sub(
            rf'!\[{re.escape(old_name)}\]\(images/README/{re.escape(old_name)}\.png\)',
            f'![{new_name}](images/README/{new_name}.png)',
            content
        )
    
    # 写回README
    with open(README_PATH, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("\n完成！README.md 中的图片引用已更新")

if __name__ == '__main__':
    main()