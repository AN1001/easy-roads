#!/bin/bash
# Samples system load while a profile runs, so frame drops can be matched to what the
# rest of the machine was doing.
#   gpu.txt: every second, wall-clock seconds + GPU utilisation % (at its current clock)
#   top.txt: every 5 seconds, the busiest processes by CPU
#
# Usage: bench/sample-system.sh <seconds> <output-folder>

secs=${1:-200}
out=${2:-.}
end=$(( $(date +%s) + secs ))

while [ "$(date +%s)" -lt "$end" ]; do
  util=$(ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '"Device Utilization % at cur p-state"=[0-9]*' | head -1 | cut -d= -f2)
  echo "$(date +%s) $util"
  sleep 1
done > "$out/gpu.txt" &

# At least 1 sample: top treats -l 0 as "forever", so the script would never finish.
top -l $(( secs < 5 ? 1 : secs / 5 )) -s 5 -o cpu -n 8 -stats pid,command,cpu > "$out/top.txt"
wait
