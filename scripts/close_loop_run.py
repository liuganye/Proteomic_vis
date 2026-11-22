#!/usr/bin/env python3
"""Console shim: python scripts/close_loop_run.py --analysis ... --viz ..."""

from close_loop_run.run import main

if __name__ == "__main__":
    raise SystemExit(main())
