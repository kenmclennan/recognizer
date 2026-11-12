class Order:
    def __init__(self, lines):
        self.lines = lines

    def total(self):
        return sum(price * count for price, count in self.lines)
