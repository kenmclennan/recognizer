def inferred(document, source=None):
    return [
        (e["from"], e["to"], e["line"], e["names"], e["inferred"])
        for e in document["edges"]
        if "inferred" in e and (source is None or e["from"] == source)
    ]


STORE = (
    "from typing import Protocol\n"
    "class Store(Protocol):\n"
    "    def save(self, item): ...\n"
    "class MemoryStore(Store):\n"
    "    def save(self, item): ...\n"
    "class SpecialStore(MemoryStore): ...\n"
)


def test_single_abstract_match_lists_its_direct_implementations(run):
    document = run(
        {"ports.py": STORE, "use.py": "def place(order, store):\n    store.save(order)\n"}
    )

    assert inferred(document, "use.py") == [
        (
            "use.py",
            "ports.py",
            1,
            ["save"],
            {
                "parameter": "store",
                "methods": ["save"],
                "class": "Store",
                "implementations": ["MemoryStore"],
            },
        )
    ]


def test_abstract_class_is_preferred_over_concrete(run):
    document = run(
        {
            "ports.py": STORE,
            "other.py": "class Other:\n    def save(self): ...\n",
            "use.py": "def place(store):\n    store.save()\n",
        }
    )

    assert [e[1] for e in inferred(document, "use.py")] == ["ports.py"]
    assert inferred(document, "use.py")[0][4]["class"] == "Store"


def test_inherited_methods_count(run):
    document = run(
        {
            "base.py": "class Base:\n    def save(self): ...\n",
            "child.py": "from base import Base\nclass Child(Base):\n    def load(self): ...\n",
            "use.py": "def go(x):\n    x.save()\n    x.load()\n",
        }
    )

    assert [e[4]["class"] for e in inferred(document, "use.py")] == ["Child"]


def test_four_concrete_matches_emit_four_edges_and_five_emit_none(run):
    classes = {f"c{i}.py": f"class C{i}:\n    def save(self): ...\n" for i in range(5)}
    use = {"use.py": "def go(x):\n    x.save()\n"}

    four = run({**{k: v for k, v in classes.items() if k != "c4.py"}, **use})

    assert len(inferred(four, "use.py")) == 4


def test_five_concrete_matches_emit_nothing(run):
    classes = {f"c{i}.py": f"class C{i}:\n    def save(self): ...\n" for i in range(5)}
    document = run({**classes, "use.py": "def go(x):\n    x.save()\n"})

    assert inferred(document) == []


def test_all_generic_methods_emit_nothing(run):
    document = run(
        {
            "a.py": "class A:\n    def get(self): ...\n",
            "use.py": "def go(x):\n    x.get()\n",
        }
    )

    assert inferred(document) == []


def test_generic_plus_specific_still_matches_on_both(run):
    document = run(
        {
            "a.py": "class A:\n    def get(self): ...\n    def save(self): ...\n",
            "b.py": "class B:\n    def save(self): ...\n",
            "use.py": "def go(x):\n    x.get()\n    x.save()\n",
        }
    )

    assert [e[4]["class"] for e in inferred(document, "use.py")] == ["A"]
    assert inferred(document, "use.py")[0][3] == ["get", "save"]


def test_parameter_stored_on_the_instance_counts_calls_in_other_methods(run):
    document = run(
        {
            "ports.py": STORE,
            "use.py": (
                "class Service:\n"
                "    def __init__(self, store):\n"
                "        self._store = store\n"
                "    def run(self, item):\n"
                "        self._store.save(item)\n"
            ),
        }
    )

    assert inferred(document, "use.py")[0][2:4] == (2, ["save"])


def test_typed_parameter_is_skipped(run):
    document = run({"ports.py": STORE, "use.py": "def go(store: object):\n    store.save()\n"})

    assert inferred(document) == []


def test_default_value_does_not_count_as_a_declaration(run):
    document = run({"ports.py": STORE, "use.py": "def go(store=None):\n    store.save()\n"})

    assert len(inferred(document)) == 1


def test_receiver_and_variadics_are_not_parameters(run):
    document = run(
        {
            "ports.py": STORE,
            "use.py": (
                "class S:\n"
                "    def go(self, *rest, **named):\n"
                "        self.save()\n"
                "        rest.save()\n"
                "        named.save()\n"
            ),
        }
    )

    assert inferred(document) == []


def test_edge_duplicating_an_import_edge_to_the_same_module_is_dropped(run):
    document = run(
        {
            "ports.py": STORE,
            "use.py": "from ports import Store\ndef go(store):\n    store.save()\n",
        }
    )

    assert inferred(document) == []


def test_no_method_calls_emit_nothing(run):
    document = run({"ports.py": STORE, "use.py": "def go(store):\n    return store\n"})

    assert inferred(document) == []


def test_foreign_base_contributes_no_methods(run):
    document = run(
        {
            "a.py": "import collections\nclass A(collections.OrderedDict): ...\n",
            "use.py": "def go(x):\n    x.save()\n",
        }
    )

    assert inferred(document) == []


def test_edge_into_the_importers_own_module_is_dropped(run):
    document = run({"a.py": STORE + "def go(store):\n    store.save()\n"})

    assert inferred(document) == []


def test_output_order_is_stable_for_one_line_with_several_edges(run):
    files = {
        "a.py": "class A:\n    def save(self): ...\n",
        "b.py": "class B:\n    def save(self): ...\n",
        "use.py": "def go(x):\n    x.save()\n",
    }

    assert [e[1] for e in inferred(run(files), "use.py")] == ["a.py", "b.py"]
