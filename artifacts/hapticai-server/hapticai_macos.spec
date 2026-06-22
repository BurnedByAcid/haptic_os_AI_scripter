# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for HapticAI (Beta) — macOS
Bundles web_app.py + all FunGen source into a .app bundle
"""

import sys
from pathlib import Path

ROOT = Path(SPECPATH)

block_cipher = None

a = Analysis(
    [str(ROOT / '_launcher.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / 'templates'), 'templates'),
        (str(ROOT / 'static'), 'static'),
        (str(ROOT / 'config'), 'config'),
        (str(ROOT / 'common'), 'common'),
        (str(ROOT / 'application'), 'application'),
        (str(ROOT / 'detection'), 'detection'),
        (str(ROOT / 'funscript'), 'funscript'),
        (str(ROOT / 'tracker'), 'tracker'),
        (str(ROOT / 'video'), 'video'),
        (str(ROOT / 'assets'), 'assets'),
    ],
    hiddenimports=[
        'web_app',
        'flask',
        'flask_socketio',
        'engineio',
        'socketio',
        'eventlet',
        'cv2',
        'numpy',
        'PIL',
        'scipy',
        'sklearn',
        'ultralytics',
        'torch',
        'torchvision',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['imgui', 'glfw', 'moderngl', 'OpenGL', 'tkinter'],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='HapticAI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='HapticAI',
)

app = BUNDLE(
    coll,
    name='HapticAI.app',
    icon=None,
    bundle_identifier='ai.haptic.fungen',
    info_plist={
        'CFBundleShortVersionString': '0.5.4',
        'CFBundleVersion': '0.5.4',
        'NSHighResolutionCapable': True,
        'LSBackgroundOnly': True,
    },
)
