#!/usr/bin/env python3
"""Package a Linux Next.js standalone build; never include environment files."""
import os
import platform
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "apps/dashboard/"
if platform.system() != "Linux":
    raise SystemExit("Package in GitHub Actions/Linux: macOS native dependencies cannot run on Azure.")
source = ROOT / PREFIX / ".next/standalone"
if not source.is_dir():
    raise SystemExit("Run npm run build first.")
archive = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "azure-app.zip"
with tempfile.TemporaryDirectory(prefix="azure-runtime-") as temporary:
    stage = Path(temporary)
    shutil.copytree(source, stage, dirs_exist_ok=True, symlinks=False,
                    ignore=shutil.ignore_patterns(".env", ".env.*", "*.map"))
    app = stage / PREFIX
    shutil.copytree(ROOT / PREFIX / ".next/static", app / ".next/static", dirs_exist_ok=True)
    public = ROOT / PREFIX / "public"
    if public.is_dir():
        shutil.copytree(public, app / "public", dirs_exist_ok=True)
    # App Service's Node optimizer may omit nested node_modules directories.
    aliases = app / ".next/node_modules"
    if aliases.is_dir():
        for entry in list(aliases.iterdir()):
            packages = list(entry.iterdir()) if entry.name.startswith("@") else [entry]
            for package in packages:
                destination = stage / "node_modules" / package.relative_to(aliases)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    raise SystemExit("Standalone package alias collision; inspect the build.")
                shutil.move(str(package), destination)
        shutil.rmtree(aliases)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for file in stage.rglob("*"):
            if file.is_file() and not file.name.startswith(".env"):
                bundle.write(file, file.relative_to(stage))
print(archive)
