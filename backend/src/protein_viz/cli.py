"""Developer commands: inspect source integrity and export the frontend API contract."""

import argparse
import json
from pathlib import Path

from protein_viz.core.config import Settings
from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.services.datasets import summarize


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate-data", help="Read and validate source tables")
    validate.add_argument("--data-dir", type=Path)
    export = commands.add_parser("export-openapi", help="Export HTTP types without loading data")
    export.add_argument("--output", type=Path, default=Path("docs/openapi.json"))
    args = parser.parse_args()
    if args.command == "validate-data":
        repository = CsvRepository(args.data_dir or Settings.from_env().data_dir)
        print(summarize(repository).model_dump_json(indent=2))
    else:
        from protein_viz.main import create_app

        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(create_app().openapi(), indent=2), encoding="utf-8")
        print(f"OpenAPI written to {args.output.resolve()}")


if __name__ == "__main__":
    main()
