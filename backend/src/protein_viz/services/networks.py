from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.schemas.domain import Neighborhood
from protein_viz.services.proteins import ProteinService


class NetworkService:
    def __init__(self, repository: CsvRepository):
        self.repository = repository

    def neighborhood(self, protein_id: str, score_cutoff: float, max_nodes: int) -> Neighborhood:
        center = ProteinService(self.repository).get(protein_id)
        scores: dict[str, float] = {}
        for edge in self.repository.adjacency.get(protein_id, []):
            if edge.score < score_cutoff:
                continue
            neighbor = edge.target if edge.source == protein_id else edge.source
            if neighbor != protein_id:
                scores[neighbor] = max(edge.score, scores.get(neighbor, 0))
        ranked = sorted(scores, key=lambda key: (-scores[key], key))
        selected = [protein_id, *ranked[: max_nodes - 1]]
        node_ids = set(selected)
        edges = [
            edge
            for edge in self.repository.edges
            if edge.source in node_ids and edge.target in node_ids and edge.score >= score_cutoff
        ]
        return Neighborhood(
            protein_id=protein_id,
            nodes=[center, *[self.repository.proteins[key] for key in selected[1:]]],
            edges=edges,
            total_neighbors=len(scores),
            truncated=len(ranked) > max_nodes - 1,
        )
