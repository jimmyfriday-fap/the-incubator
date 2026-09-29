from app.main import rates


def test_rates_empty() -> None:
    assert rates() == {}


def test_rates_is_dict() -> None:
    assert isinstance(rates(), dict)
