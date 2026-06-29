"""
Common exceptions and error handling.

Provides standardized exception types for better error handling
across all HapticAI modules.
"""


class HapticAIException(Exception):
    """Base exception for all HapticAI errors."""
    pass


class ConnectionError(HapticAIException):
    """Failed to connect to external service (XBVR, Stash, device, etc.)."""
    pass


class DeviceError(HapticAIException):
    """Device operation failed."""
    pass


class VideoSourceError(HapticAIException):
    """Video source operation failed."""
    pass


class TranscodingError(HapticAIException):
    """Video transcoding failed."""
    pass


class SyncError(HapticAIException):
    """Synchronization error."""
    pass
