# 数据目录

这些文件来自整理前仓库的既有快照。移动目录不代表重新计算或独立验证了结果。

## 输入与正式快照

- `raw/combined_protein.tsv`：FragPipe 蛋白质结果表。
- `raw/experiment_annotation.tsv`：样本注释。分组及重复类型需要结合实验设计确认，不能只凭文件名推断。
- `processed/maxlfq_wide.csv`、`maxlfq_long.csv`：已有 MaxLFQ 导出，两种形状用于不同的分析读取需求。
- `processed/ga2_human_vs_qc_limma.csv`、`ga2_human_vs_qc_summary.csv`：已有 Human vs QC 统计结果及摘要。当前 notebook 读取这些结果，并不重新拟合 limma；完整生成脚本与参数需要后续补齐。
- `processed/proteins_with_sequences.csv`：蛋白质序列。
- `processed/ppi_string_edges.csv`、`ppi_string_id_map.csv`：STRING 关联网络与 ID 映射。导出网络覆盖不完整，关联分数不能直接解释为物理结合强度。
- `processed/structure_pdb_index.csv`：PDB 引用索引。存在引用不代表本地有对应结构文件。
- `processed/spatial_mapping.csv`：定位注释，不是空间坐标。

## 外部数据、示例与占位文件

- `external/pdb_files/`：已有的四个 PDB 结构文件。
- `external/cache/`：已有数据库查询缓存，保留以便追溯来源；本次未发起任何外部数据库更新。
- `examples/ga2_illustrative_volcano_data.csv`：历史示意数据，其生成来源尚需核实，不能默认当作正式差异结果。
- `examples/ga3_structure_examples.txt`、`ga4_random_sequence_pick.txt`：历史示例选择记录。
- `placeholders/adjusted_pvalues_long.csv`、`adjusted_pvalues_wide.csv`：历史占位导出，不能凭文件名假定包含有效 adjusted p-values。

所有文件保留原始文件名，便于对照旧 notebook 和组内已有工作。占位与示意文件暂不删除，先明确其用途。

## 使用规则

`Protein ID` 是主要关联键；Gene 用作显示标签。鉴定置信度不能当作差异检验 p-value。原始 MaxLFQ 中的零值与缺失值处理应遵循分析协议，并在导出说明中写明。

前端用文件选择器上传 `raw/` 中的两个 TSV；不要把整个数据目录复制进前端 `public/`。前端当前使用的模拟数据单独保留，不与这里的快照混用。
