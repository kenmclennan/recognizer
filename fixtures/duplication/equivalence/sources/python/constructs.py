class Store:
    def get(self, key):
        found = self.items.get(key)

        if found is None:
            raise KeyError(key)

        return found

    def get(self, key, default):
        found = self.items.get(key)

        if found is None:
            return default

        return found

    class Inner:
        def size(self):
            return len(self.items)


def helper(values):
    return [value * 2 for value in values]
