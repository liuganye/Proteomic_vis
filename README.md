# Proteomic visualization

四人小组的蛋白质可视化项目。本仓库同时保存浏览器原型、分析 notebook 和一份固定数据快照。

## 从哪里开始

- 前端开发：进入 [`proteomics-viz/`](proteomics-viz/README.md)。保留原目录名，已有启动命令和部署根目录无需调整。
- 数据与统计：阅读 [`data/README.md`](data/README.md)，再进入 [`analysis/`](analysis/README.md)。
- 小组协作：阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)，按任务开分支并提交 PR。
- 图表与结构示例：见 [`reports/`](reports/README.md)。

## 启动前端

需要 Node.js 20.9 或更高版本及 npm。在仓库根目录运行：

```sh
cd proteomics-viz
npm ci
npm run dev
```

打开 <http://127.0.0.1:43147>。原型提供模拟数据，也可在页面中上传真实文件：

- `data/raw/combined_protein.tsv`
- `data/raw/experiment_annotation.tsv`

这些路径相对于仓库根目录。前端通过用户选择文件读取数据，不会自动读取服务器磁盘上的绝对路径。前端旧说明或页脚中的 `/data/ganye/...` 是原开发机器的历史位置。

当前前端是独立浏览器原型，支持 QC、火山图和结果表；本仓库此次整理没有接入后端。缺少统计结果时的前端近似模式仅供演示，不应当作 limma 的分析结果。数据快照中已有的 limma CSV 与该近似模式也不是同一来源。

## 目录用途

- `proteomics-viz/`：Next.js / TypeScript 前端及其小型模拟数据。
- `analysis/`：分析 notebook 和 Python 依赖清单。
- `data/raw/`：原始输入与样本注释，作为只读基线。
- `data/processed/`：已有预处理结果与注释快照。
- `data/external/`：已有 UniProt / STRING 缓存及 PDB 文件。
- `data/examples/`：示意结果与示例选择记录。
- `data/placeholders/`：历史占位表，不能作为有效差异统计结果。
- `reports/figures/`：已有图表快照；`reports/generated/`：重新运行产生的本地输出，不提交。
- `archives/`：保留的原说明和应用压缩包，仅作历史参考。

目录整理保留了原始数据、缓存、图表和应用源码。重新运行 notebook 时不会覆盖已提交的数据快照。如何复查路径调整见 [`analysis/README.md`](analysis/README.md)。
