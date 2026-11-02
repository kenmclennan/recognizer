def classify(order, region):
    if order and region:
        return "both"
    elif order:
        return "order"
    elif region:
        return "region"
    for item in order:
        if item.x or item.y:
            return "item"
    return "none"


def tidy(name):
    if name:
        return name.strip()
    return ""


def label(order):
    if order:
        return order.name
    return ""


def gate(user, mode):
    if user and mode:
        return True
    if mode:
        return False
    if user:
        return None
    return True
