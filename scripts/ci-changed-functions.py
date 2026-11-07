#!/usr/bin/env python3
"""Prints the edge functions to redeploy for a push: functions whose own files changed, plus every function that imports (directly, or through
other _shared files) a _shared file that changed. Usage: ci-changed-functions.py <before> <after>"""
import os, re, subprocess, sys

before, after = sys.argv[1], sys.argv[2]
root = "supabase/functions"
out = subprocess.run(["git", "diff", "--name-only", "--diff-filter=AM", before, after, "--", root], capture_output=True, text=True, check=True).stdout.split()
imp = re.compile(r"""from\s+["']([^"']*_shared/[^"']+|\./[^"']+|\.\./[^"']+)["']|import\s+["']([^"']+)["']""")

def imports(path):
    """Resolved local paths this file imports."""
    try: text = open(path, encoding="utf-8").read()
    except OSError: return set()
    found = set()
    for m in imp.finditer(text):
        spec = m.group(1) or m.group(2)
        if spec and spec.startswith("."): found.add(os.path.normpath(os.path.join(os.path.dirname(path), spec)))
    return found

functions = sorted(d for d in os.listdir(root) if not d.startswith("_") and os.path.isfile(f"{root}/{d}/index.ts"))
graph = {}
for d in functions + ["_shared"]:
    for dp, _, files in os.walk(f"{root}/{d}"):
        for f in files:
            if f.endswith((".ts", ".tsx", ".js")): graph[os.path.join(dp, f)] = imports(os.path.join(dp, f))

changed = {os.path.normpath(p) for p in out}
# A file is affected if it changed or imports an affected file (fixed point).
affected = set(changed)
while True:
    new = {p for p, deps in graph.items() if p not in affected and deps & affected}
    if not new: break
    affected |= new
names = set()
for p in affected:
    parts = p.split("/")
    if len(parts) > 3 and not parts[2].startswith("_") and parts[2] in functions: names.add(parts[2])
print("\n".join(sorted(names)))
