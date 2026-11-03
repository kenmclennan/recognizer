def clamp(x, lo, hi):
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


def is_adult(age):
    return age >= 18


def total(price, qty):
    return price * qty


def both(a, b):
    return a and b


def invert(flag):
    return not flag


def default_enabled():
    return True


def untested(a, b):
    return a - b


def tiered(n, vip):
    if n > 10 and vip:
        return n * 2
    return n + 1
