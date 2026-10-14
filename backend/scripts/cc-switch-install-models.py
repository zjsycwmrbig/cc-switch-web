#!/usr/bin/env python3
"""导入或在线更新 CC Switch 的全部 Codex 模型目录；不修改路由和凭据。"""
import argparse
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request


def atomic_write(path, content):
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.chmod(name, path.stat().st_mode & 0o777 if path.exists() else 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", nargs="?", help="网页导出的 cc-switch-all-models.json")
    parser.add_argument("--url", help="CC Switch 网页地址，在线拉取全部供应商模型")
    parser.add_argument("--codex-home", default=os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    args = parser.parse_args()
    if bool(args.catalog) == bool(args.url):
        parser.error("指定一个目录文件，或使用 --url 在线更新")
    if args.url:
        key = os.environ.get("CC_SWITCH_WEB_ACCESS_KEY") or getpass.getpass("CC Switch 网页访问密钥：")
        request = urllib.request.Request(
            args.url.rstrip("/") + "/api/model-catalog/codex",
            headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
    else:
        data = json.loads(Path(args.catalog).expanduser().read_text(encoding="utf-8"))
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list) or not models:
        raise ValueError("文件必须包含非空 models 数组；请从模型匹配池导出")
    seen = set()
    for item in models:
        slug = item.get("slug") if isinstance(item, dict) else None
        if not isinstance(slug, str) or not slug.strip() or slug.lower() in seen:
            raise ValueError("模型条目存在空名称或重复名称")
        seen.add(slug.lower())
    folder = Path(args.codex_home).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    catalog_path = folder / "cc-switch-all-models.json"
    config_path = folder / "config.toml"
    original = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    # TOML 键在第一张表之前才是全局键。清理旧键后在文件开头写入。
    # 保留原文件的注释、路由、凭据、项目和插件配置。
    key_line = re.compile(r'^\s*(?:model_catalog_json|"model_catalog_json"|\x27model_catalog_json\x27)\s*=.*(?:\r?\n|$)', re.MULTILINE)
    remainder = key_line.sub("", original)
    updated = "model_catalog_json = " + json.dumps(str(catalog_path), ensure_ascii=False) + "\n" + remainder
    try:
        import tomllib
    except ImportError:
        tomllib = None
    if tomllib:
        before = tomllib.loads(original)
        after = tomllib.loads(updated)
        # 只改变目录指针；验证现有供应商路由及认证配置都完整保留。
        for key in ("model", "model_provider", "model_providers"):
            if before.get(key) != after.get(key):
                raise ValueError("配置校验失败：" + key + " 将发生变化")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backups = []
    for path in (config_path, catalog_path):
        if path.exists():
            backup = path.with_name(path.name + ".bak-" + stamp)
            shutil.copy2(path, backup)
            backups.append(str(backup))
    atomic_write(catalog_path, json.dumps({"models": models}, ensure_ascii=False, indent=2) + "\n")
    if original != updated:
        atomic_write(config_path, updated)
    # 把工具保存在配置目录，下次可直接运行 --url 更新。
    tool_path = folder / "cc-switch-sync-models.py"
    this_path = Path(__file__).resolve()
    if this_path != tool_path:
        atomic_write(tool_path, this_path.read_text(encoding="utf-8"))
    print("已写入 " + str(len(models)) + " 个模型：" + str(catalog_path))
    print("全局 model_catalog_json 已设置；路由、凭据和当前默认模型已保留。")
    if backups:
        print("备份：" + "，".join(backups))
    print("请重新打开 Codex；VS Code 远程窗口执行 Developer: Reload Window 后查看模型选择器。")
    if args.url:
        print("以后更新：python3 " + str(tool_path) + " --url " + args.url)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("导入失败：" + str(error), file=sys.stderr)
        sys.exit(1)
