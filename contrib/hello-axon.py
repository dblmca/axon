#!/usr/bin/env python3
import subprocess
from datetime import datetime

hostname = subprocess.run(["hostname"], capture_output=True, text=True).stdout.strip()
now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
lines = [
    "Welcome to Axon!",
    f"Date/Time: {now}",
    f"Hostname:  {hostname}",
]
max_len = max(len(l) for l in lines)
border = "+" + "-" * (max_len + 2) + "+"
print(border)
for l in lines:
    print(f"| {l.ljust(max_len)} |")
print(border)