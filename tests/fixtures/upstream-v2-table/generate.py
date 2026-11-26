#!/usr/bin/env python3
"""Generate TableCenterNet reference outputs from upstream NDLOCR-Lite v2.0.0.

Usage (run from anywhere):
    <venv>/bin/python generate.py --upstream-src <ndlocr-lite>/src [--models <dir>] [image ...]

For each image this runs the upstream OCR (`ocr._run_ocr_on_image_array`)
followed by `tablecenternet.infer_tables_from_page` (default 'official'
decoder, center 0.2 / corner 0.3 / crop padding 8, as in
optional_features/table_structure.py) and writes `<stem>.json` next to this
script.  For every table it also writes the crop as PNG so the TypeScript
port can be tested on byte-identical pixels (independent of JPEG decoders),
together with the raw crop-local cells from `recognize_rgb`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEFAULT_IMAGES = [
    ROOT / "tests/fixtures/images/digidepo_3048008_0025.jpg",
    ROOT / "tests/fixtures/images/kumonoito.png",
]


def jsonable(value):
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def cell_record(cell):
    out = {k: v for k, v in cell.items() if not k.startswith("_")}
    if "_ocr_lines" in cell:
        out["ocr_texts"] = [str(line.get("text", "")) for line in cell["_ocr_lines"]]
    return jsonable(out)


def synthetic_ruled(tablecenternet) -> None:
    """A synthetic ruled table exercising `_ruled_table_cells` (incl. a merged header cell)
    and the OCR-line assignment / HTML / Markdown generation."""
    import cv2

    H, W = 330, 460
    img = np.full((H, W, 3), 255, dtype=np.uint8)
    xs = [20, 120, 220, 330, 440]
    ys = [20, 80, 140, 200, 260, 310]
    for x in xs:
        cv2.line(img, (x, ys[0]), (x, ys[-1]), (0, 0, 0), 2)
    for y in ys:
        cv2.line(img, (xs[0], y), (xs[-1], y), (0, 0, 0), 2)
    # merge row 0, cols 1-2 (erase the separator) and rows 2-3 in col 0
    cv2.rectangle(img, (xs[2] - 3, ys[0] + 3), (xs[2] + 3, ys[1] - 3), (255, 255, 255), -1)
    cv2.rectangle(img, (xs[0] + 3, ys[3] - 3), (xs[1] - 3, ys[3] + 3), (255, 255, 255), -1)
    rng = np.random.default_rng(0)
    lines = []
    cells = []
    for r in range(len(ys) - 1):
        for c in range(len(xs) - 1):
            if (r == 0 and c == 2) or (c == 0 and r == 3):
                continue
            c2 = c + 1 if (r == 0 and c == 1) else c
            r2 = r + 1 if (c == 0 and r == 2) else r
            jit = rng.normal(0, 1.5, size=(4, 2))
            x1, x2, y1, y2 = xs[c], xs[c2 + 1], ys[r], ys[r2 + 1]
            corners = (np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float64) + jit).tolist()
            cells.append({
                "score": 0.5, "corners": corners,
                "logic_axis_0based": [c, c2, r, r2], "logic_axis_1based": [c + 1, c2 + 1, r + 1, r2 + 1],
            })
            # fake "text" ink and an OCR line inside the cell
            tx, ty = (x1 + x2) // 2 - 20, (y1 + y2) // 2 - 8
            cv2.putText(img, f"{r}{c}A", (tx + 2, ty + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 40, 40), 1, cv2.LINE_AA)
            lines.append({"boundingBox": [[tx, ty], [tx, ty + 16], [tx + 40, ty], [tx + 40, ty + 16]],
                          "id": len(lines), "isVertical": "false", "text": f"r{r}c{c}<&>"})
    # a duplicate (IoU>0.5, smaller) OCR line that must be suppressed
    lines.append({"boundingBox": [[262, 102], [262, 116], [298, 102], [298, 116]], "id": len(lines),
                  "isVertical": "false", "text": "dup"})
    bbox = [xs[0] - 2, ys[0] - 2, xs[-1] + 2, ys[-1] + 2]
    Image.fromarray(img).save(HERE / "synthetic_ruled.png")
    ruled = tablecenternet._ruled_table_cells(img, cells, bbox)
    final = ruled if ruled is not None else cells
    html_out = tablecenternet.cells_to_html(final, lines, table_bbox=bbox)
    # model-topology path (no ruling replacement) with a missing cell to exercise recovery
    model_cells = [dict(c) for c in cells if c["logic_axis_0based"][:3:2] != [3, 4]]
    model_html = tablecenternet.cells_to_html(model_cells, lines, table_bbox=bbox)
    doc = {
        "bbox": bbox,
        "cells": jsonable(cells),
        "lines": [{
            "x": l["boundingBox"][0][0], "y": l["boundingBox"][0][1],
            "width": l["boundingBox"][2][0] - l["boundingBox"][0][0],
            "height": l["boundingBox"][1][1] - l["boundingBox"][0][1], "text": l["text"],
        } for l in lines],
        "ruled_cells": None if ruled is None else [cell_record(c) for c in ruled],
        "html": html_out,
        "markdown": tablecenternet.cells_to_markdown(final),
        "model_cells_out": [cell_record(c) for c in model_cells],
        "model_html": model_html,
        "model_markdown": tablecenternet.cells_to_markdown(model_cells),
    }
    (HERE / "synthetic_ruled.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print("synthetic_ruled", "ruled" if ruled is not None else "model", len(final), len(model_cells))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--upstream-src", required=True)
    ap.add_argument("--models", default=None, help="model dir (default: <upstream-src>/model)")
    ap.add_argument("images", nargs="*")
    a = ap.parse_args()

    src = Path(a.upstream_src).resolve()
    sys.path.insert(0, str(src))
    import ocr  # noqa: E402
    import tablecenternet  # noqa: E402

    synthetic_ruled(tablecenternet)

    models = Path(a.models) if a.models else src / "model"
    args = SimpleNamespace(
        det_weights=str(models / "deim-s-1024x1024-261124.onnx"),
        det_classes=str(src / "config" / "ndl.yaml"),
        det_score_threshold=0.2,
        det_conf_threshold=0.25,
        det_iou_threshold=0.2,
        det_overlap_threshold=0.9,
        rec_weights=str(models / "parseq-ndl-24x768-100-tiny-153epoch-261124.onnx"),
        rec_classes=str(src / "config" / "NDLmoji.yaml"),
        device="cpu",
    )
    detector = ocr.get_detector(args)
    rec100 = ocr.get_recognizer(args)
    rec30 = ocr.get_recognizer(args, str(models / "parseq-ndl-24x256-30-tiny-499epoch-261124.onnx"))
    rec50 = ocr.get_recognizer(args, str(models / "parseq-ndl-24x384-50-tiny-278epoch-261124.onnx"))
    table_rec = tablecenternet.TableCenterNetRecognizer(
        model_path=models / "tablecenternet_s_800_v3.onnx", decoder="official",
        center_thresh=0.2, corner_thresh=0.3,
    ).load()

    images = [Path(p) for p in a.images] or DEFAULT_IMAGES
    for path in images:
        with Image.open(path) as pil:
            img = np.asarray(pil.convert("RGB"))
        page = ocr._run_ocr_on_image_array(detector, rec30, rec50, rec100, path.name, img, str(HERE))
        _, tables = tablecenternet.infer_tables_from_page(img, page, table_rec, crop_padding=8)

        out_tables = []
        for t in tables:
            x1, y1, x2, y2 = t["crop_bbox"]
            crop = np.ascontiguousarray(img[y1:y2, x1:x2])
            crop_name = f"{path.stem}_table{t['table_index']}_crop.png"
            Image.fromarray(crop).save(HERE / crop_name)
            raw_local = table_rec.recognize_rgb(crop)
            # checksums of intermediate images (bit-exactness of the cv2 ports)
            import cv2
            import hashlib
            ch, cw = crop.shape[:2]
            center = np.array([cw / 2.0, ch / 2.0], dtype=np.float32)
            trans = tablecenternet.get_affine_transform(center, float(max(ch, cw)), [800, 800])
            warped = cv2.warpAffine(np.ascontiguousarray(crop[:, :, ::-1]), trans, (800, 800), flags=cv2.INTER_LINEAR)
            gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
            binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 10)
            opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 16)))
            opened_h = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (21, 1)))
            md5 = lambda arr: hashlib.md5(np.ascontiguousarray(arr).tobytes()).hexdigest()
            checksums = {"warped_bgr": md5(warped), "gray": md5(gray), "binary": md5(binary),
                         "open_v16": md5(opened), "open_h21": md5(opened_h)}
            rows, cols = tablecenternet.table_grid_shape(t["cells"])
            out_tables.append({
                "table_index": t["table_index"],
                "layout_bbox": jsonable(t["layout_bbox"]),
                "crop_bbox": jsonable(t["crop_bbox"]),
                "layout_confidence": t.get("layout_confidence"),
                "structure_source": t.get("structure_source", "model"),
                "detected_cell_count": t.get("detected_cell_count"),
                "recovered_cell_count": t.get("recovered_cell_count"),
                "grid_shape": [rows, cols],
                "crop_png": crop_name,
                "checksums": checksums,
                "raw_local_cells": [cell_record(c) for c in raw_local],
                "cells": [cell_record(c) for c in t["cells"]],
                "html": t["html"],
                "markdown": tablecenternet.cells_to_markdown(list(t["cells"])),
                "error": t.get("error"),
            })

        lines = []
        for line in page["json_lines"]:
            bb = np.asarray(line["boundingBox"], dtype=np.float64).reshape(-1, 2)
            lines.append({
                "x": float(bb[:, 0].min()), "y": float(bb[:, 1].min()),
                "width": float(bb[:, 0].max() - bb[:, 0].min()),
                "height": float(bb[:, 1].max() - bb[:, 1].min()),
                "text": line["text"],
            })
        doc = {
            "image": path.name,
            "width": int(img.shape[1]),
            "height": int(img.shape[0]),
            "regions": jsonable(tablecenternet.extract_table_regions(page["page_xml"])),
            "lines": lines,
            "tables": out_tables,
            "html_document": tablecenternet.build_tables_html_document(path.name, tables),
        }
        (HERE / f"{path.stem}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        print(path.name, [(t["table_index"], t["grid_shape"], len(t["cells"])) for t in out_tables])


if __name__ == "__main__":
    main()
