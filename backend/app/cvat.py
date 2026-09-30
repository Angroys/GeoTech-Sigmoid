"""CVAT for images 1.1 import/export.

Parses a CVAT ``annotations.xml`` (from a directory OR a .zip) into label
definitions + per-image shape records, and serialises a store back to a CVAT
1.1 ``annotations.xml`` with identical structure so an import -> export cycle
round-trips label names, attribute name/value pairs, points, image names and
width/height.

Shape mapping (store shape_type <-> CVAT element)
    polygon  <-> <polygon  points="x,y;...">
    polyline <-> <polyline points="x,y;...">
    box      <-> <box xtl= ytl= xbr= ybr=>   (points stored as
                 [[xtl, ytl], [xbr, ybr]])
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from lxml import etree

from . import config

# Default label definitions matching the real example (used when no meta has
# been captured yet). Preserved verbatim on export.
DEFAULT_LABELS: list[dict[str, Any]] = [
    {
        "name": "vineyard",
        "type": "polygon",
        "attributes": [
            {"name": "vineyard_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
        ],
    },
    {
        "name": "waste",
        "type": "rectangle",
        "attributes": [
            {"name": "vineyard_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
        ],
    },
    {
        "name": "row",
        "type": "polyline",
        "attributes": [
            {"name": "vineyard_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
            {"name": "row_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
            {"name": "row_structure", "mutable": "False", "input_type": "select",
             "default_value": "regular", "values": "regular\ndisrupted\nunassessable"},
        ],
    },
    {
        "name": "interrow_area",
        "type": "polygon",
        "attributes": [
            {"name": "vineyard_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
            {"name": "interrow_cover", "mutable": "False", "input_type": "select",
             "default_value": "bare_soil",
             "values": "bare_soil\nvegetation\nmixed\nunassessable"},
        ],
    },
    {
        "name": "dead_vine",
        "type": "polygon",
        "attributes": [
            {"name": "vineyard_id", "mutable": "False", "input_type": "text",
             "default_value": "", "values": ""},
        ],
    },
]

DEFAULT_TASK_NAME = "Vineyard AI Field Challenge"

# CVAT element name -> store shape_type
_ELEM_TO_SHAPE = {"polygon": "polygon", "polyline": "polyline", "box": "box"}

_META_STORE = config.BACKEND_ROOT / "data" / "cvat_meta.json"


# --------------------------------------------------------------- helpers ----
def _parse_points(text: str) -> list[list[float]]:
    pts: list[list[float]] = []
    for pair in text.strip().split(";"):
        if not pair:
            continue
        x, y = pair.split(",")
        pts.append([float(x), float(y)])
    return pts


def _points_to_str(points: list[list[float]]) -> str:
    return ";".join(f"{x},{y}" for x, y in points)


def _fmt(v: float) -> str:
    """Format a coordinate: integers stay integer-like, floats keep decimals."""
    if v == int(v):
        return str(float(v))
    return repr(v)


def read_annotations_xml(source: str | Path) -> bytes:
    """Return the raw annotations.xml bytes from a dir or zip path."""
    src = Path(source)
    if src.is_dir():
        return (src / "annotations.xml").read_bytes()
    if src.suffix == ".zip" or zipfile.is_zipfile(str(src)):
        with zipfile.ZipFile(str(src)) as zf:
            name = next(
                (n for n in zf.namelist() if n.endswith("annotations.xml")), None
            )
            if name is None:
                raise FileNotFoundError("no annotations.xml inside zip")
            return zf.read(name)
    if src.name == "annotations.xml" and src.is_file():
        return src.read_bytes()
    raise FileNotFoundError(f"cannot locate annotations.xml at {source}")


# ---------------------------------------------------------------- parse ----
def parse_labels(root: etree._Element) -> list[dict[str, Any]]:
    labels: list[dict[str, Any]] = []
    for label_el in root.findall(".//meta//labels/label"):
        name = label_el.findtext("name", default="")
        ltype = label_el.findtext("type", default="")
        attrs: list[dict[str, Any]] = []
        for attr_el in label_el.findall("attributes/attribute"):
            attrs.append(
                {
                    "name": attr_el.findtext("name", default=""),
                    "mutable": attr_el.findtext("mutable", default="False"),
                    "input_type": attr_el.findtext("input_type", default="text"),
                    "default_value": attr_el.findtext("default_value", default="") or "",
                    "values": attr_el.findtext("values", default="") or "",
                }
            )
        labels.append({"name": name, "type": ltype, "attributes": attrs})
    return labels


def parse_cvat(source: str | Path) -> dict[str, Any]:
    """Parse a CVAT export (dir or zip) into a structured dict."""
    xml_bytes = read_annotations_xml(source)
    root = etree.fromstring(xml_bytes)

    version = root.findtext("version", default="1.1")
    task_name = root.findtext(".//meta//task/name", default=DEFAULT_TASK_NAME)
    labels = parse_labels(root)

    images: list[dict[str, Any]] = []
    for img_el in root.findall("image"):
        shapes: list[dict[str, Any]] = []
        for shape_el in img_el:
            tag = etree.QName(shape_el).localname
            shape_type = _ELEM_TO_SHAPE.get(tag)
            if shape_type is None:
                continue
            if shape_type == "box":
                points = [
                    [float(shape_el.get("xtl")), float(shape_el.get("ytl"))],
                    [float(shape_el.get("xbr")), float(shape_el.get("ybr"))],
                ]
            else:
                points = _parse_points(shape_el.get("points", ""))
            attributes: dict[str, Any] = {}
            for attr_el in shape_el.findall("attribute"):
                attributes[attr_el.get("name")] = attr_el.text or ""
            shapes.append(
                {
                    "label": shape_el.get("label", ""),
                    "shape_type": shape_type,
                    "points": points,
                    "attributes": attributes,
                    "source": shape_el.get("source", "manual"),
                    "occluded": int(shape_el.get("occluded", "0")),
                    "z_order": int(shape_el.get("z_order", "0")),
                }
            )
        images.append(
            {
                "id": int(img_el.get("id", str(len(images)))),
                "name": img_el.get("name", ""),
                "width": int(img_el.get("width", "0")),
                "height": int(img_el.get("height", "0")),
                "shapes": shapes,
            }
        )

    return {"version": version, "task_name": task_name, "labels": labels, "images": images}


# ---------------------------------------------------------- meta storage ----
def save_meta(labels: list[dict[str, Any]], task_name: str) -> None:
    _META_STORE.parent.mkdir(parents=True, exist_ok=True)
    _META_STORE.write_text(json.dumps({"labels": labels, "task_name": task_name}))


def load_meta() -> dict[str, Any]:
    if _META_STORE.exists():
        try:
            return json.loads(_META_STORE.read_text())
        except (ValueError, OSError):
            pass
    return {"labels": DEFAULT_LABELS, "task_name": DEFAULT_TASK_NAME}


# ----------------------------------------------------------- serialize ----
def _build_meta(parent: etree._Element, labels: list[dict[str, Any]], task_name: str) -> None:
    meta = etree.SubElement(parent, "meta")
    task = etree.SubElement(meta, "task")
    etree.SubElement(task, "name").text = task_name
    labels_el = etree.SubElement(task, "labels")
    for label in labels:
        label_el = etree.SubElement(labels_el, "label")
        etree.SubElement(label_el, "name").text = label["name"]
        etree.SubElement(label_el, "type").text = label["type"]
        attrs_el = etree.SubElement(label_el, "attributes")
        for attr in label["attributes"]:
            attr_el = etree.SubElement(attrs_el, "attribute")
            etree.SubElement(attr_el, "name").text = attr["name"]
            etree.SubElement(attr_el, "mutable").text = attr.get("mutable", "False")
            etree.SubElement(attr_el, "input_type").text = attr.get("input_type", "text")
            etree.SubElement(attr_el, "default_value").text = attr.get("default_value", "")
            etree.SubElement(attr_el, "values").text = attr.get("values", "")


def _append_shape(img_el: etree._Element, shape: dict[str, Any]) -> None:
    shape_type = shape["shape_type"]
    common = {
        "label": shape["label"],
        "source": shape.get("source", "manual"),
        "occluded": str(shape.get("occluded", 0)),
    }
    if shape_type == "box":
        (xtl, ytl), (xbr, ybr) = shape["points"]
        el = etree.SubElement(img_el, "box", **common)
        el.set("xtl", _fmt(xtl))
        el.set("ytl", _fmt(ytl))
        el.set("xbr", _fmt(xbr))
        el.set("ybr", _fmt(ybr))
    else:
        el = etree.SubElement(img_el, shape_type, **common)
        el.set("points", _points_to_str(shape["points"]))
    el.set("z_order", str(shape.get("z_order", 0)))
    for name, value in shape["attributes"].items():
        attr_el = etree.SubElement(el, "attribute", name=name)
        attr_el.text = "" if value is None else str(value)


def serialize_cvat(
    images: list[dict[str, Any]],
    labels: list[dict[str, Any]] | None = None,
    task_name: str | None = None,
    version: str = "1.1",
) -> bytes:
    """Serialise images + labels back to a CVAT 1.1 annotations.xml (bytes).

    ``images`` is a list of {id, name, width, height, shapes:[...]}.
    """
    meta = load_meta()
    labels = labels if labels is not None else meta["labels"]
    task_name = task_name if task_name is not None else meta["task_name"]

    root = etree.Element("annotations")
    etree.SubElement(root, "version").text = version
    _build_meta(root, labels, task_name)

    for idx, img in enumerate(images):
        img_el = etree.SubElement(
            root,
            "image",
            id=str(img.get("id", idx)),
            name=img["name"],
            width=str(img["width"]),
            height=str(img["height"]),
        )
        for shape in img["shapes"]:
            _append_shape(img_el, shape)

    return etree.tostring(
        root, pretty_print=True, xml_declaration=True, encoding="utf-8"
    )
