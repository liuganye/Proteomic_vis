import pytest


def test_dataset_preserves_counts_and_reports_conflicts(client):
    assert client.get("/health").json()["status"] == "ok"
    dataset = client.get("/api/v1/dataset").json()
    assert dataset["protein_count"] == 4
    assert dataset["network_edge_count"] == 3
    assert any("Excluded 1" in warning for warning in dataset["warnings"])


def test_gene_search_does_not_merge_different_organisms(client):
    result = client.get("/api/v1/proteins", params={"q": "same"}).json()
    assert {row["protein_id"] for row in result["items"]} == {"P1", "Y1"}
    page = client.get("/api/v1/proteins", params={"q": "same", "limit": 1, "offset": 1}).json()
    assert page["total"] == 2
    assert len(page["items"]) == 1


def test_unreviewed_group_is_not_a_corrected_original_condition(client):
    sample = client.get("/api/v1/samples").json()[0]
    assert sample["original_condition"] == "Condition"
    assert sample["display_group"] == "Condition_A"
    assert sample["group_review_status"] == "unreviewed"
    assert sample["replicate_type"] is None


def test_abundance_joins_by_id_and_header_and_preserves_missingness(client):
    points = client.get("/api/v1/proteins/P1/abundance").json()["points"]
    assert [point["sample_id"] for point in points] == ["Condition_A_34", "Human_4", "QC_7"]
    assert [point["intensity"] for point in points] == [8, 16, None]
    assert [point["log2_intensity"] for point in points] == [3, 4, None]
    assert points[2]["observed"] is False


def test_local_reference_only_and_no_reference_are_distinct(client):
    first = client.get("/api/v1/proteins/P1").json()
    assert first["structure_status"] == "local_available"
    assert first["locations"] == ["Nucleus", "Cytoplasm"]
    assert first["structures"][1]["download_url"] is None
    assert client.get("/api/v1/proteins/P2").json()["structure_status"] == "reference_only"
    assert client.get("/api/v1/proteins/P3").json()["structure_status"] == "no_pdb_reference"
    assert client.get("/api/v1/structures/1abc").text.startswith("HEADER")
    assert client.get("/api/v1/structures/2DEF").status_code == 404


def test_adjusted_and_raw_significance_keep_the_original_test_background(client):
    url = "/api/v1/contrasts/human-vs-qc/results"
    adjusted = client.get(url, params={"significant_only": True}).json()
    assert [row["protein_id"] for row in adjusted["items"]] == ["P1"]
    raw = client.get(url, params={"significant_only": True, "p_value_mode": "raw"}).json()
    assert {row["protein_id"] for row in raw["items"]} == {"P1", "P3"}
    filtered = client.get(url, params={"organism": "unknown"}).json()
    assert filtered["total"] == 0
    assert filtered["evaluated_count"] == 3


def test_untested_protein_has_no_fabricated_statistic(client):
    assert client.get("/api/v1/proteins/Y1").status_code == 200
    rows = client.get("/api/v1/contrasts/human-vs-qc/results").json()["items"]
    assert "Y1" not in {row["protein_id"] for row in rows}


def test_neighborhood_is_ranked_bounded_and_species_scoped(client):
    graph = client.get("/api/v1/networks/P1/neighbors", params={"max_nodes": 2}).json()
    assert {node["protein_id"] for node in graph["nodes"]} == {"P1", "P2"}
    assert graph["total_neighbors"] == 2
    assert graph["truncated"] is True
    assert len(graph["edges"]) == 1
    isolated = client.get("/api/v1/networks/Y1/neighbors").json()
    assert isolated["edges"] == []
    assert len(isolated["nodes"]) == 1


def test_qc_denominators_follow_the_organism_filter(client):
    all_samples = client.get("/api/v1/qc/samples").json()["samples"]
    assert all_samples[0]["protein_count"] == 4
    assert all_samples[0]["detected_count"] == 4
    human = client.get("/api/v1/qc/samples", params={"organism": "Homo sapiens"}).json()
    assert human["samples"][2]["protein_count"] == 3
    assert human["samples"][2]["missing_fraction"] == 1
    assert client.get("/api/v1/qc/samples?organism=unknown").status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/proteins?limit=0",
        "/api/v1/proteins?offset=-1",
        "/api/v1/networks/P1/neighbors?max_nodes=151",
        "/api/v1/networks/P1/neighbors?score_cutoff=1.1",
        "/api/v1/networks/P1/neighbors?score_cutoff=nan",
        "/api/v1/contrasts/human-vs-qc/results?p_value_mode=wrong",
        "/api/v1/contrasts/human-vs-qc/results?abs_log2_fc_cutoff=nan",
        "/api/v1/structures/not-a-pdb",
    ],
)
def test_invalid_query_parameters_are_rejected(client, path):
    assert client.get(path).status_code == 422


def test_unknown_resources_are_structured_404s(client):
    response = client.get("/api/v1/proteins/unknown")
    assert response.status_code == 404
    assert response.json()["code"] == "protein_not_found"
    assert client.get("/api/v1/contrasts/a-vs-b/results").status_code == 404


def test_cors_accepts_the_configured_local_frontend(client):
    response = client.options(
        "/api/v1/proteins",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
