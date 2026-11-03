def straight(a):
    b = a + 1
    return b


def one_if(a):
    if a:
        return 1
    return 0


def if_elif(a):
    if a == 1:
        return "one"
    elif a == 2:
        return "two"
    return "many"


def loops(xs, a):
    total = 0
    for x in xs:
        total += x
    while a > 0:
        a -= 1
    if total:
        total += 1
    return total


def guarded(a, b):
    try:
        value = a / b
    except ZeroDivisionError:
        value = 0
    except TypeError:
        value = None
    if value is None:
        return -1
    return value if value > 0 else 0


def comprehensions(xs):
    a = [x for x in xs if x > 0]
    b = {y for y in xs}
    if not a:
        return b
    for z in b:
        a.append(z)
    return a


def matching(v, a):
    match v:
        case 1:
            r = "a"
        case 2:
            r = "b"
        case _:
            r = "c"
    if a:
        r += "!"
    while a > 1:
        a -= 1
    return r if r else ""


def booleans(a, b, c, d):
    if a and b or c and d:
        x = 1
    else:
        x = 2
    while a or b:
        a = False
        b = False
    return x if c else 0


def mixed(a, b, c, xs):
    if a:
        r = 1
    elif b:
        r = 2
    elif c:
        r = 3
    else:
        r = 4
    for x in xs:
        r += x
    while r > 100:
        r -= 100
    try:
        r = r // len(xs)
    except ZeroDivisionError:
        r = 0
    z = a or b
    y = a and b
    return r, z, y


def nested(rows, z):
    out = 0
    for row in rows:
        if row:
            for cell in row:
                if cell and z:
                    out += cell
    while out > 1000:
        out //= 2
    try:
        out += int(z)
    except ValueError:
        out = 0
    match out:
        case 0:
            return "zero"
        case 1:
            return "one"
    return out


def classify(n, a, b, c, d, xs):
    if n < 0:
        label = "neg"
    elif n == 0:
        label = "zero"
    elif n < 10:
        label = "small"
    elif n < 100:
        label = "medium"
    elif n < 1000:
        label = "large"
    else:
        label = "huge"
    if a or b or c or d:
        label += "+"
    for x in xs:
        label += str(x)
    return label


def sprawl(n, a, b, c, xs):
    if n < 0:
        label = 0
    elif n == 0:
        label = 1
    elif n < 10:
        label = 2
    elif n < 100:
        label = 3
    elif n < 1000:
        label = 4
    elif n < 10000:
        label = 5
    for x in xs:
        label += x
    ok = a and b and c
    try:
        label = label // n
    except ZeroDivisionError:
        label = 0
    return label if ok else -label
