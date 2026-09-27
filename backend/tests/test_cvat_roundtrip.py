"""Import the real CVAT example, re-export, and assert structural fidelity."""
from __future__ import annotations

import math

import pytest

from app import cvat


def _index(images):
    return {img["name"]: img for img in images}


@pytest.fixture(scope="module")
def parsed_and_roundtripped():
    example = (
        __import__("pathlib").Path(__file__).resolve().parent.parent.parent.parent.parent
        / "data" / "marcaj-data" / "assets_for_participants"
        / "05_examples" / "siret3_examples_cvat"
    )
    if not (example / "annotations.xml").exists():
        pytest.skip(f"CVAT example not found at {example}")
    original = cvat.parse_cvat(example)
    xml_bytes = cvat.serialize_cvat(
        original["images"], labels=original["labels"], task_name=original["task_name"]
    )
    # Re-parse the exported bytes (write to nowhere; parse from the raw XML).
    import tempfile
    from pathlib import Path

    tmp = Path(tempfile.mkdtemp())
    (tmp / "annotations.xml").write_bytes(xml_bytes)
    reexported = cvat.parse_cvat(tmp)
    return original, reexported


def test_image_names_preserved(parsed_and_roundtripped):
    original, reexported = parsed_and_roundtripped
    assert [i["name"] for i in original["images"]] == [i["name"] for i in reexported["images"]]


def test_image_dimensions_preserved(parsed_and_roundtripped):
    original, reexported = parsed_and_roundtripped
    o, r = _index(original["images"]), _index(reexported["images"])
    for name in o:
        assert (o[name]["width"], o[name]["height"]) == (r[name]["width"], r[name]["height"])


def test_label_set_preserved(parsed_and_roundtripped):
    original, reexported = parsed_and_roundtripped
    o_labels = {lb["name"]: lb for lb in original["labels"]}
    r_labels = {lb["name"]: lb for lb in reexported["labels"]}
    assert set(o_labels) == set(r_labels)
    for name, lb in o_labels.items():
        assert lb["type"] == r_labels[name]["type"]
        o_attrs = {a["name"]: a for a in lb["attributes"]}
        r_attrs = {a["name"]: a for a in r_labels[name]["attributes"]}
        assert set(o_attrs) == set(r_attrs)
        for an, ad in o_attrs.items():
            assert ad["input_type"] == r_attrs[an]["input_type"]
            assert ad["default_value"] == r_attrs[an]["default_value"]


def test_shape_counts_preserved(parsed_and_roundtripped):
    original, reexported = parsed_and_roundtripped
    o, r = _index(original["images"]), _index(reexported["images"])
    for name in o:
        assert len(o[name]["shapes"]) == len(r[name]["shapes"])


def test_shapes_preserved(parsed_and_roundtripped):
    original, reexported = parsed_and_roundtripped
    o, r = _index(original["images"]), _index(reexported["images"])
    for name in o:
        for os_, rs in zip(o[name]["shapes"], r[name]["shapes"]):
            assert os_["label"] == rs["label"]
            assert os_["shape_type"] == rs["shape_type"]
            assert os_["attributes"] == rs["attributes"]
            assert len(os_["points"]) == len(rs["points"])
            for (ox, oy), (rx, ry) in zip(os_["points"], rs["points"]):
                assert math.isclose(ox, rx, abs_tol=1e-6)
                assert math.isclose(oy, ry, abs_tol=1e-6)
