from shop.adapters.report import render
from shop.domain.order import Order


def test_total():
    assert Order([(2, 3)]).total() == 6


def test_render():
    assert render(Order([(1, 1)])) == "total 1"
