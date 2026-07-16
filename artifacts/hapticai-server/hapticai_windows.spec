# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for HapticAI (Beta) — Windows
Bundles web_app.py + all HapticAI source into a single-file .exe
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)

block_cipher = None

# collect_all bundles the full package tree (code + data + submodules),
# which is required for simple_websocket and wsproto so that
# python-engineio can import them at runtime inside the frozen bundle.
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
        'engineio.async_drivers',
        'engineio.async_drivers.threading',
        'socketio',
        'socketio.async_drivers',
        'socketio.async_drivers.threading',
        'lap',
        'pystray',
        'pystray._win32',
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
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name='HapticAI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / 'assets' / 'branding' / 'icon.ico'),
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
