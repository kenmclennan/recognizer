import os.path

from shop.ports.store import Store


class MemoryStore(Store):
    def save(self, order):
        return os.path.join("memory", order.id)
