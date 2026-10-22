# 分析 notebook

`plan_g_protein_parameters.ipynb` 是既有 Plan G / GA.1–GA.6 技术说明与分析记录。`requirements.txt` 保留原来的依赖清单。

## 运行

在仓库根目录、独立 Python 环境中安装依赖并启动 Jupyter：

```sh
python -m pip install -r analysis/requirements.txt
python -m jupyter notebook analysis/plan_g_protein_parameters.ipynb
```

原依赖清单包含 `pymol-open-source`，是否可安装取决于平台。现有 notebook 的结构展示读取已提交 PNG，不需要现场重新渲染；PyMOL 重新渲染属于独立环境配置工作。

从仓库根目录或 `analysis/` 目录启动，按顺序运行单元。第一个代码单元会向上查找仓库根目录并定义：

- `RAW`：`data/raw/` 中的固定输入。
- `PROCESSED`：`data/processed/` 中的已有结果。
- `FIGURES`：`reports/figures/` 中的已有图表。
- `OUT` / `PLOTS`：`reports/generated/` 及其 `plots/` 子目录，用于本次运行生成的文件。

GA.1 新生成的 MaxLFQ CSV 从 `OUT` 重新读取；其他章节从 `PROCESSED` 读取既有快照。结构展示读取 `FIGURES` 中的历史渲染。新输出被 Git 忽略，不会覆盖原始输入、已有 CSV 或 PNG。

## 结果来源与验证范围

已保存的单元输出保持原样，可能包含原作者的 Linux 路径；它们是历史记录，不是目录调整后的新运行结果。代码中的数据路径已改为仓库相对定位。

本次目录调整不重新进行差异分析、下载注释或渲染 PDB。正式复现时仍需核实实验分组、输入版本及原有预处理方法。尤其是 limma 结果，当前 notebook 只加载结果表；不能声称完整统计流水线已经重现。

审核目录变更时，应检查 notebook JSON 和代码单元语法、输入文件及图片路径是否存在，并确认重新运行的输出都写入 `reports/generated/`。
