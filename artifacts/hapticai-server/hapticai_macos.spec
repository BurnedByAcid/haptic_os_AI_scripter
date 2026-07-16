# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for HapticAI (Beta) — macOS
Bundles web_app.py + all HapticAI source into a .app bundle
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)

block_cipher = None

_sw_datas, _sw_binaries, _sw_hiddenimports = collect_all('simple_websocket')
_wp_datas, _wp_binaries, _wp_hiddenimports = collect_all('wsproto')

a = Analysis(
    [str(ROOT / '_launcher.py')],
    pathex=[str(ROOT)],
    binaries=[] + _sw_binaries + _wp_binaries,
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
    ] + _sw_datas + _wp_datas,
    hiddenimports=[
        'web_app',
        'flask',
        'flask_socketio',
        'engineio',
        'engineio.async_threading',
        'socketio',
        'socketio.async_threading',
        'eventlet',
        'cv2',
        'numpy',
        'PIL',
        'scipy',
        'sklearn',
        'ultralytics',
        'torch',
        'torchvision',
    ] + _sw_hiddenimports + _wp_hiddenimports,
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
    bundle_identifier='ai.haptic.hapticai',
    info_plist={
        'CFBundleShortVersionString': '0.5.4',
        'CFBundleVersion': '0.5.4',
        'NSHighResolutionCapable': True,
        'LSBackgroundOnly': True,
    },
)
