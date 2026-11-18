"""CLI: python -m close_loop_run --analysis analysis.yaml --viz viz.yaml"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

from close_loop_run.analysis.pipeline import run_analysis
from close_loop_run.config import deep_get, load_yaml
from close_loop_run.viz.pipeline import run_viz


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="close_loop_run",
        description="Automation 2: smoke nan-state analysis + headless viz from two YAML configs.",
    )
    p.add_argument("--analysis", required=True, help="Path to analysis.yaml")
    p.add_argument("--viz", required=True, help="Path to viz.yaml")
    p.add_argument(
        "--outdir",
        default=None,
        help="Override output directory (else meta.out_dir / viz.output_dir)",
    )
    p.add_argument(
        "--copy-to",
        default=None,
        help="Optional directory to mirror key figures/summaries after the run",
    )
    p.add_argument(
        "--skip-analysis",
        action="store_true",
        help="Only run viz using paths already listed in viz.yaml",
    )
    return p.parse_args(argv)


def _copy_file(src: Path | str | None, dest: Path) -> None:
    if not src:
        return
    src_p = Path(src)
    if not src_p.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_p, dest)


def _mirror_artifacts(run_dir: Path, dest: Path, analysis_res: dict[str, Any], viz_res: dict[str, Any]) -> None:
    """Copy key figures/text into dest (flat + light nested layout for Agent 3)."""
    dest.mkdir(parents=True, exist_ok=True)
    figures = dest / "figures"
    tables = dest / "tables"
    text = dest / "text"
    for d in (figures, tables, text):
        d.mkdir(parents=True, exist_ok=True)

    arts = viz_res.get("artifacts") or {}
    _copy_file(arts.get("de.volcano_adj_p"), figures / "volcano_adj_p.png")
    _copy_file(arts.get("qc.missingness"), figures / "missingness.png")
    _copy_file(arts.get("qc.intensity_hist"), figures / "intensity_hist.png")
    _copy_file(arts.get("qc.intensity_box"), figures / "intensity_box.png")

    _copy_file(arts.get("de.sig_table"), tables / "significant.tsv")
    _copy_file(analysis_res.get("significant_table"), tables / "significant_proteins.csv")
    _copy_file(analysis_res.get("contrast_table"), tables / "contrast_welch_bh.csv")
    _copy_file(arts.get("qc.missingness_csv"), tables / "missingness.csv")

    _copy_file(analysis_res.get("summary_path"), text / "analysis_summary.md")
    _copy_file(analysis_res.get("metrics_path"), text / "metrics.json")
    _copy_file(arts.get("report.index"), text / "report_index.md")
    _copy_file(arts.get("de.contrast_summary"), text / "contrast_summary.json")
    _copy_file(arts.get("qc.summary"), text / "qc_summary.json")
    _copy_file(arts.get("de.markers"), text / "markers.json")
    analysis_dir = Path(analysis_res.get("analysis_dir") or (run_dir / "analysis"))
    _copy_file(analysis_dir / "species_ratio_diagnostics.json", text / "species_ratio_diagnostics.json")
    _copy_file(analysis_dir / "group_load_diagnostics.json", text / "group_load_diagnostics.json")
    _copy_file(analysis_dir / "theme_direction_summary.json", text / "theme_direction_summary.json")
    _copy_file(analysis_dir / "fraction_changed_diagnostics.json", text / "fraction_changed_diagnostics.json")
    _copy_file(analysis_res.get("exploratory_table"), tables / "significant_exploratory.csv")
    _copy_file(analysis_res.get("protein_annotation"), tables / "protein_annotation.csv")
    _copy_file(arts.get("de.sig_table_adaptive"), tables / "significant_adaptive.tsv")
    _copy_file(run_dir / "run_result.json", dest / "run_result.json")



def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    analysis_cfg = load_yaml(args.analysis)
    viz_cfg = load_yaml(args.viz)

    out_dir = Path(
        args.outdir
        or deep_get(analysis_cfg, "meta", "out_dir")
        or viz_cfg.get("output_dir")
        or "runs/latest"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    analysis_res: dict[str, Any] | None = None
    if not args.skip_analysis:
        analysis_res = run_analysis(analysis_cfg, out_dir)
        # inject analysis outputs into viz when paths are missing/null
        viz_cfg.setdefault("inputs", {})
        for key, val in {
            "abundance_wide": analysis_res["abundance_wide"],
            "annotation": analysis_res["annotation"],
            "contrast_table": analysis_res["contrast_table"],
        }.items():
            if not viz_cfg["inputs"].get(key):
                viz_cfg["inputs"][key] = str(val)
        viz_cfg.setdefault("contrast", {})
        c = viz_cfg["contrast"]
        method = analysis_res["metrics"].get("test") or "welch_ttest_bh"
        quant = analysis_res["metrics"].get("quant")
        c["method"] = f"{method}" + (f"+{quant}" if quant else "")
        c.setdefault("group_a", analysis_res["metrics"].get("control_label", "control"))
        c.setdefault("group_b", analysis_res["metrics"].get("treatment_label", "treatment"))
        if not c.get("direction"):
            c["direction"] = f"{c['group_b']} - {c['group_a']}"



    viz_out = out_dir / "viz"
    viz_cfg["output_dir"] = str(viz_out)
    viz_res = run_viz(viz_cfg, analysis_result=analysis_res, out_dir=viz_out)

    combined = {
        "out_dir": str(out_dir),
        "analysis": {
            "metrics": (analysis_res or {}).get("metrics"),
            "contrast_table": str((analysis_res or {}).get("contrast_table", "")),
            "summary": str((analysis_res or {}).get("summary_path", "")),
        },
        "viz": {
            "artifacts": viz_res["artifacts"],
            "de_summary": viz_res["de_summary"],
            "qc_summary": viz_res["qc_summary"],
        },
    }
    (out_dir / "run_result.json").write_text(json.dumps(combined, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "out_dir": str(out_dir), "n_significant": viz_res["de_summary"]["n_significant"]}, indent=2))

    if args.copy_to and analysis_res is not None:
        _mirror_artifacts(out_dir, Path(args.copy_to), analysis_res, viz_res)
        print(f"mirrored artifacts → {args.copy_to}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
