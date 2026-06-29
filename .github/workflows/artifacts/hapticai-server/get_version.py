import re
import pathlib
import sys

text = pathlib.Path("config/constants.py").read_text(encoding="utf-8")
m = re.search(r'APP_VERSION\s*=\s*["\']([^"\']+)["\']', text)
print(m.group(1) if m else "0.0.0", end="")
