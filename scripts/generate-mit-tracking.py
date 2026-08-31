#!/usr/bin/env python3
"""Regenerate MIT_LICENSE_TRACKING.md from the current working tree.

Preserves checked boxes from the existing file so work-in-progress state is not lost.
"""

import subprocess
import re
import sys

MERGE_BASE = "6b0ff80"
OUTPUT = "MIT_LICENSE_TRACKING.md"


def count_lines(path, ref=None):
    if ref:
        try:
            return len(subprocess.check_output(["git", "show", f"{ref}:{path}"], text=True).split("\n"))
        except subprocess.CalledProcessError:
            return 0
    with open(path) as f:
        return len(f.read().split("\n"))


def gather_entries():
    raw = subprocess.check_output(
        ["git", "diff", "--raw", "--find-renames=10%", MERGE_BASE, "--", "src/"],
        text=True,
    )
    numstat = {}
    for line in subprocess.check_output(
        ["git", "diff", "--numstat", MERGE_BASE, "--", "src/"], text=True
    ).strip().split("\n"):
        if not line.strip():
            continue
        added, deleted, path = line.split("\t")
        numstat[path] = (int(added), int(deleted))

    entries = []
    for line in raw.strip().split("\n"):
        parts = line.split("\t")
        status = parts[0].split()[-1]
        if status.startswith("R"):
            sim = int(status[1:]) / 100.0
            src_path, dst_path = parts[1], parts[2]
            up_lines = count_lines(src_path, MERGE_BASE)
            cur_lines = count_lines(dst_path)
            retained = min(up_lines * sim, cur_lines)
            entries.append((dst_path, "rename", sim, cur_lines, up_lines, retained))
        elif status == "A":
            dst_path = parts[1]
            cur_lines = count_lines(dst_path)
            entries.append((dst_path, "new", 0, cur_lines, 0, 0))
        elif status == "M":
            dst_path = parts[1]
            up_lines = count_lines(dst_path, MERGE_BASE)
            cur_lines = count_lines(dst_path)
            added, deleted = numstat.get(dst_path, (0, 0))
            retained = min(max(0, up_lines - deleted), cur_lines)
            entries.append((dst_path, "modify", retained / cur_lines if cur_lines else 0, cur_lines, up_lines, retained))
        elif status == "D":
            src_path = parts[1]
            up_lines = count_lines(src_path, MERGE_BASE)
            entries.append((src_path, "delete", 0, 0, up_lines, 0))
    return entries


def load_checked(existing_path):
    checked = set()
    if not existing_path.exists():
        return checked
    pattern = re.compile(r"^- \[(x)\] `([^`]+)`")
    with open(existing_path) as f:
        for line in f:
            m = pattern.match(line.strip())
            if m:
                checked.add(m.group(2))
    return checked


def main():
    from pathlib import Path

    entries = gather_entries()
    total_cur = sum(x[3] for x in entries if x[1] != "delete")
    total_ret = sum(x[5] for x in entries)
    entries_sorted = sorted([e for e in entries if e[1] != "delete"], key=lambda x: -x[5])
    checked = load_checked(Path(OUTPUT))

    def item(file, retained, pct):
        mark = "x" if file in checked else " "
        return f"- [{mark}] `{file}` — {retained:.0f} upstream lines ({pct:.1f}% of file)"

    lines = [
        "# MIT-licensed upstream code tracking",
        "",
        "This document tracks which files in `src/` still contain code derived from the",
        "original MIT-licensed Paged.js project, so the remaining upstream code can be",
        "replaced incrementally.",
        "",
        "## Methodology",
        "",
        "- Upstream merge-base (last common commit with pagedjs/pagedjs): `6b0ff80`",
        '  ("Merge pull request #315 from wamuir/bugfix-marginalia").',
        "- Each current source file is compared against its counterpart at the merge-base.",
        "- For files Git detects as renames (e.g. `R081`), the percentage is Git's estimate",
        "  of how much of the upstream file is unchanged in the current file.",
        "- Retained upstream lines = `upstream_lines × similarity`, capped at current file size.",
        "- New files count as 0% upstream.",
        "- This is a heuristic, not a legal audit.",
        "",
        "## Progress summary",
        "",
        f"- Current `src/` lines: **{total_cur:,}**",
        f"- Estimated upstream-derived lines remaining: **{total_ret:,.0f}**",
        f"- Share of current source under upstream MIT origin: **{total_ret/total_cur*100:.1f}%**",
        "",
        "## File-by-file breakdown",
        "",
        "| File | Status | Current lines | Upstream lines | Retained upstream lines | % of file |",
        "|------|--------|--------------:|---------------:|------------------------:|----------:|",
    ]

    for dst, kind, sim, cur, up, retained in entries_sorted:
        pct = retained / cur * 100 if cur else 0
        if kind == "new":
            status = "new"
        elif kind == "modify":
            status = "modified"
        else:
            status = f"rename {int(sim * 100)}%"
        lines.append(f"| `{dst}` | {status} | {cur} | {int(up)} | {retained:.0f} | {pct:.1f}% |")

    lines += [
        "",
        "## Work checklist",
        "",
        "Tick a box when a file has been fully rewritten or otherwise no longer",
        "contains upstream-derived code. Update the summary numbers afterward.",
        "",
        "### High impact (> 500 upstream-derived lines or > 60% of file)",
        "",
    ]
    for dst, kind, sim, cur, up, retained in entries_sorted:
        pct = retained / cur * 100 if cur else 0
        if retained > 500 or pct > 60:
            lines.append(item(dst, retained, pct))

    lines += ["", "### Medium impact (100–500 upstream-derived lines or 30–60% of file)", ""]
    for dst, kind, sim, cur, up, retained in entries_sorted:
        pct = retained / cur * 100 if cur else 0
        if 100 <= retained <= 500 or 30 <= pct <= 60:
            lines.append(item(dst, retained, pct))

    lines += ["", "### Low impact (< 100 upstream-derived lines and < 30% of file)", ""]
    for dst, kind, sim, cur, up, retained in entries_sorted:
        pct = retained / cur * 100 if cur else 0
        if retained < 100 and pct < 30 and kind != "new":
            lines.append(item(dst, retained, pct))

    lines += ["", "### Already clean (new files, no upstream-derived code)", ""]
    for dst, kind, sim, cur, up, retained in entries_sorted:
        if kind == "new":
            lines.append(f"- [x] `{dst}` — {cur} lines")

    lines += [
        "",
        "## Regenerating this document",
        "",
        "Run the helper script from the repository root:",
        "",
        "```bash",
        "python3 scripts/generate-mit-tracking.py",
        "```",
        "",
        "This will refresh the numbers while preserving any checkmarks you have added.",
    ]

    with open(OUTPUT, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Updated {OUTPUT}")


if __name__ == "__main__":
    main()
