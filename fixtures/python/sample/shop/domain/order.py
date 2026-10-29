import dataclasses

__all__ = ["Order"]

MAX_ITEMS = 100


@dataclasses.dataclass
class Order:
    id: str
    items: int = 0
    _note: str = ""

    def total(self) -> int:
        return self._sum()

    def _sum(self) -> int:
        return self.items


def new_order(order_id) -> Order:
    return _build(order_id)


def _build(order_id: str) -> Order:
    return Order(order_id)


def _private():
    return None
