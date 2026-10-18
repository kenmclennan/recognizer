from shop.domain.order import Order, new_order
from shop.ports import store


def place(order_id):
    from ..domain import order

    return new_order(order_id), Order, store, order
