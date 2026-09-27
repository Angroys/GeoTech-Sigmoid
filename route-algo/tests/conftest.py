import pytest


@pytest.fixture(autouse=True)
def no_default_roads(monkeypatch, tmp_path):
    """Keep tests hermetic: never pick up the machine's extracted roads file."""
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(tmp_path / "no-roads.geojson"))
