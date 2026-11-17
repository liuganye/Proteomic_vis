# `close_loop_run` — Automation 2 smoke CLI

One command, two YAML configs:

```bash
PYTHONPATH=. python -m close_loop_run \
  --analysis configs/pair-01-maxlfq-hela-ecoli/analysis.yaml \
  --viz configs/pair-01-maxlfq-hela-ecoli/viz.yaml \
  [--outdir runs/...] \
  [--copy-to /path/to/media/small-test-runs/<pair-id>]
```

Implements the nan-state smoke analysis path (ingest → NaN-freq → Perseus impute → abundance → Welch SE → Welch+BH) and headless QC/volcano exports. Example pair configs live under `configs/`. Install deps from `close_loop_run/requirements.txt`.
