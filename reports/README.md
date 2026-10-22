# 图表与报告

- `figures/`：从原 `plots/` 移来的 PNG 快照，图片内容未修改。
- `figures/plot_manifest.csv`：`png` 相对于 `reports/figures/`；`csv_source` 是数据来源描述，其中的文件路径相对于仓库根目录。
- `ga3_structure_3d_renders.csv`：图片及 PDB 文件路径全部相对于仓库根目录；蛋白质 ID、PDB ID 与行顺序保留。
- `generated/`：notebook 重新运行生成的 CSV 和图表，被 Git 忽略。复查通过后再有选择地提交正式输出。

已提交图表是历史快照，不能用来证明当前版本已经完成重新分析。名字包含 `illustrative` 的图属于示意结果。
