def order_total(lines, shipping):
    total = 0
    for line in lines:
        if line.price > 0:
            total += line.price * line.quantity
    return total + shipping
