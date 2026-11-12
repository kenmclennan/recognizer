from shop.domain.order import Order


def render(order: Order) -> str:
    return f"total {order.total()}"
