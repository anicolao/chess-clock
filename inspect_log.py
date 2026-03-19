import glob
import os

logs = glob.glob("/tmp/nix-shell.*/pytest-embedded/*/test_provisioning_flow/dut.log")
if not logs:
    print("No logs found.")
    exit(0)

latest_log = max(logs, key=os.path.getctime)
with open(latest_log, "r", encoding="utf-8", errors="replace") as f:
    lines = f.readlines()

print("--- LAST 50 LINES ---")
for line in lines[-50:]:
    print(line.strip())

print("--- ASSERTS ---")
for i, line in enumerate(lines):
    if "assert failed" in line or "Guru Meditation" in line:
        for j in range(max(0, i-2), min(len(lines), i+15)):
            print(lines[j].strip())
        print("---")
