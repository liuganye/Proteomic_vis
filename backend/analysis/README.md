# 离线分析模块

负责人：CS-A 和 Bio-D。此处放未来的可复现分析脚本，不在 HTTP 路由中拟合统计模型。

建议后续逐步加入：

- `review_samples.py`：根据人工审核表生成派生样本注释，保留原注释和依据。
- `differential_analysis.R`：核实实验设计后重建 limma + BH，输出方法、输入哈希、设计矩阵及结果。
- `prepare_dataset.py`：输出计划中的标准 JSON，供可选的纯静态前端使用。
- `pca.py`：记录物种范围、特征筛选、缺失处理和标准化方式。

以上是扩展位置，不代表这些分析已实现。当前后端读取已有结果；`protein-viz validate-data` 仅做输入契约校验，不验证生物学设计或重现原始 R 计算。
