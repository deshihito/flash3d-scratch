#!/usr/bin/env python3
"""Driver: run TACT-AIM-distilled's transpile.py against an arbitrary sb3.

Usage: transpile_driver.py <transpile.py> <sb3> <outdir>
Writes generated TS into <outdir>/gen and docs into <outdir>/docs.
Does not modify the distilled repository (read-only import).
"""
import importlib.util
import sys
from pathlib import Path

transpile_path, sb3, outdir = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
spec = importlib.util.spec_from_file_location("distilled_transpile", transpile_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.SB3 = sb3
mod.GEN = outdir / "gen"
mod.DOCS = outdir / "docs"
mod.ROOT = outdir  # no src/distilled under here -> generated files reference "./"
mod.main()
print(f"transpiled {sb3} -> {mod.GEN}")
