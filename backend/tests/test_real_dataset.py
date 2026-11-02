import pytest
from fastapi.testclient import TestClient

from protein_viz.core.config import DEFAULT_DATA_DIR, Settings
from protein_viz.main import create_app


@pytest.mark.integration
@pytest.mark.skipif(
    not (DEFAULT_DATA_DIR / "raw" / "combined_protein.tsv").is_file(),
    reason="Original project dataset is not available in this checkout",
)
def test_real_dataset_connects_the_api_to_known_source_results():
    with TestClient(create_app(Settings(data_dir=DEFAULT_DATA_DIR))) as client:
        summary = client.get("/api/v1/dataset").json()
        assert summary["protein_count"] == 9369
        assert summary["sample_count"] == 45
        assert summary["local_structure_count"] == 4
        results = client.get(
            "/api/v1/contrasts/human-vs-qc/results", params={"significant_only": True}
        ).json()
        assert results["evaluated_count"] == 4375
        assert results["total"] == 33
        assert len(client.get("/api/v1/proteins/O00148/abundance").json()["points"]) == 45
        assert client.get("/api/v1/proteins/O00148").json()["structure_status"] == "local_available"
        assert client.get("/api/v1/structures/8IJU").status_code == 200
        assert len(client.get("/api/v1/qc/samples").json()["samples"]) == 45
