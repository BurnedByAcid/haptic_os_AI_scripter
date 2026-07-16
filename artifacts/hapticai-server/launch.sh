#!/bin/bash
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
echo "Activating HapticAI environment..."
source "/Users/k00gar/miniconda3/bin/activate" HapticAI
echo "Starting HapticAI..."
python main.py "$@"
