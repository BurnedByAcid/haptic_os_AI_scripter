"""
Common utilities shared across HapticAI modules.

Provides shared infrastructure for streamer and device_control modules.
"""

__version__ = "2.0.0"

from common.exceptions import HapticAIException

try:
    from common.http_client import HTTPClientManager
except ImportError:
    HTTPClientManager = None  # type: ignore[assignment,misc]

try:
    from common.temp_manager import TempManager
except ImportError:
    TempManager = None  # type: ignore[assignment,misc]

try:
    from common.result import Result
except ImportError:
    Result = None  # type: ignore[assignment,misc]

__all__ = [
    'HTTPClientManager',
    'TempManager',
    'Result',
    'HapticAIException',
]
