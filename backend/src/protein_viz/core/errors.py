class ResourceNotFound(Exception):
    """A requested scientific resource is absent, rather than a valid empty result."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class DatasetError(ValueError):
    """Input files violate the dataset contract; fail startup with an actionable error."""
