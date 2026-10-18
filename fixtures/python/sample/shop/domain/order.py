import dataclasses

__all__ = ["Order"]


@dataclasses.dataclass
class Order:
    id: str


def new_order(order_id):
    return Order(order_id)


def _private():
    return None
