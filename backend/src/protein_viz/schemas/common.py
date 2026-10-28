from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class Model(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class Page(Model, Generic[T]):
    items: list[T]
    total: int
    offset: int
    limit: int


class ErrorResponse(Model):
    code: str
    message: str
