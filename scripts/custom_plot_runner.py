#!/usr/bin/env python3
"""Constrained runner for QC custom-plot Python snippets.

Reads one JSON object from stdin:
  { "source": str, "samples": list[dict], "inputs": dict }

Prints one JSON object to stdout:
  { "ok": true, "chartSpec": {...} } | { "ok": false, "error": str }

Safety (defense in depth, not a full OS sandbox):
- AST reject of Import / ImportFrom / dangerous names
- Restricted builtins (no open/eval/exec/__import__)
- Only math + statistics + Counter/defaultdict exposed
"""

from __future__ import annotations

import ast
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from typing import Any

MAX_SOURCE = 12_000
MAX_SAMPLES = 500
ALLOWED_CHART_TYPES = frozenset({"bar", "scatter", "histogram", "line"})

DENIED_NAMES = frozenset(
    {
        "open",
        "eval",
        "exec",
        "compile",
        "input",
        "__import__",
        "breakpoint",
        "memoryview",
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "classmethod",
        "staticmethod",
        "property",
        "type",
        "help",
        "exit",
        "quit",
        "copyright",
        "credits",
        "license",
    }
)


class UnsafeScriptError(ValueError):
    pass


def _reject_ast(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise UnsafeScriptError("import statements are not allowed")
        if isinstance(node, ast.Name) and node.id in DENIED_NAMES:
            raise UnsafeScriptError(f"use of '{node.id}' is not allowed")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                raise UnsafeScriptError("dunder attribute access is not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise UnsafeScriptError("dunder names are not allowed")
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in DENIED_NAMES:
                raise UnsafeScriptError(f"call to '{func.id}' is not allowed")


def _safe_builtins() -> dict[str, Any]:
    allowed = [
        "abs",
        "all",
        "any",
        "bool",
        "dict",
        "enumerate",
        "filter",
        "float",
        "int",
        "isinstance",
        "len",
        "list",
        "map",
        "max",
        "min",
        "pow",
        "print",
        "range",
        "reversed",
        "round",
        "set",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
    ]
    out: dict[str, Any] = {name: getattr(__builtins__, name) for name in allowed}
    out["True"] = True
    out["False"] = False
    out["None"] = None
    return out


def _normalize_chart(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise UnsafeScriptError("chart must be a dict")
    chart_type = raw.get("type")
    if chart_type not in ALLOWED_CHART_TYPES:
        raise UnsafeScriptError(
            f"chart.type must be one of {sorted(ALLOWED_CHART_TYPES)}"
        )
    data = raw.get("data")
    if not isinstance(data, list):
        raise UnsafeScriptError("chart.data must be a list")
    if len(data) > 2000:
        raise UnsafeScriptError("chart.data exceeds 2000 rows")
    x_key = raw.get("xKey") or raw.get("x_key")
    y_key = raw.get("yKey") or raw.get("y_key")
    if not isinstance(x_key, str) or not x_key:
        raise UnsafeScriptError("chart.xKey is required")
    if not isinstance(y_key, str) or not y_key:
        raise UnsafeScriptError("chart.yKey is required")
    out: dict[str, Any] = {
        "type": chart_type,
        "data": data,
        "xKey": x_key,
        "yKey": y_key,
    }
    for key, alt in (
        ("title", None),
        ("seriesKey", "series_key"),
        ("xLabel", "x_label"),
        ("yLabel", "y_label"),
    ):
        val = raw.get(key)
        if val is None and alt:
            val = raw.get(alt)
        if isinstance(val, str) and val:
            out[key] = val
    return out


def run(payload: dict[str, Any]) -> dict[str, Any]:
    source = payload.get("source")
    if not isinstance(source, str) or not source.strip():
        raise UnsafeScriptError("source must be a non-empty string")
    if len(source) > MAX_SOURCE:
        raise UnsafeScriptError(f"source exceeds {MAX_SOURCE} characters")

    samples = payload.get("samples")
    if not isinstance(samples, list):
        raise UnsafeScriptError("samples must be a list")
    if len(samples) > MAX_SAMPLES:
        raise UnsafeScriptError(f"samples exceeds {MAX_SAMPLES} rows")

    inputs = payload.get("inputs") or {}
    if not isinstance(inputs, dict):
        raise UnsafeScriptError("inputs must be an object")

    tree = ast.parse(source, mode="exec")
    _reject_ast(tree)

    emitted: dict[str, Any] = {}

    def emit(chart: Any) -> None:
        emitted["chart"] = chart

    env: dict[str, Any] = {
        "__builtins__": _safe_builtins(),
        "samples": samples,
        "inputs": inputs,
        "math": math,
        "statistics": statistics,
        "Counter": Counter,
        "defaultdict": defaultdict,
        "emit": emit,
        "chart": None,
    }
    exec(compile(tree, "<custom-plot>", "exec"), env, env)  # noqa: S102 — intentional sandbox
    chart = emitted.get("chart", env.get("chart"))
    if chart is None:
        raise UnsafeScriptError("script must assign `chart = {...}` or call emit(...)")
    return {"ok": True, "chartSpec": _normalize_chart(chart)}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise UnsafeScriptError("payload must be a JSON object")
        result = run(payload)
        json.dump(result, sys.stdout, allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:  # noqa: BLE001 — surface to API as error string
        json.dump({"ok": False, "error": str(exc)}, sys.stdout, allow_nan=False)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
