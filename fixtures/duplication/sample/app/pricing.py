def total_with_tax(items, rate):
    total = 0
    for item in items:
        if item.price > 0:
            total += item.price * item.quantity
    tax = round_money(total * rate)
    return total + tax


def sum_with_levy(lines, percent):
    amount = 0
    for line in lines:
        if line.cost > 0:
            amount += line.cost * line.count
    levy = round_money(amount * percent)
    return amount + levy


def describe(items):
    names = [item.name for item in items]
    return ", ".join(names)
