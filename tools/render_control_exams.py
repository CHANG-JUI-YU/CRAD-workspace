from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

import fitz
from PIL import Image, ImageOps


ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\控制")
OUT = Path(r"C:\AI\projects\card-workspace\analysis_control")
RENDERED = OUT / "rendered"


def digest(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    return h[:16]


def clean(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]+", "_", value).strip("_")


def main() -> None:
    RENDERED.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    manifest = []
    for path in sorted(p for p in ROOT.rglob("*") if p.is_file()):
        full_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if full_hash in seen:
            continue
        seen.add(full_hash)
        stem = f"{clean(path.parent.name)}__{clean(path.stem)}__{full_hash[:10]}"
        if path.suffix.lower() == ".pdf":
            doc = fitz.open(path)
            for page_no, page in enumerate(doc, 1):
                pix = page.get_pixmap(matrix=fitz.Matrix(2.3, 2.3), colorspace=fitz.csGRAY, alpha=False)
                output = RENDERED / f"{stem}__p{page_no:02d}.png"
                pix.save(output)
                manifest.append({"image": str(output), "source": str(path), "page": page_no, "hash": full_hash})
        elif path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
            output = RENDERED / f"{stem}__p01.png"
            with Image.open(path) as im:
                ImageOps.grayscale(im).save(output, optimize=True)
            manifest.append({"image": str(output), "source": str(path), "page": 1, "hash": full_hash})
    with (OUT / "render_manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["image", "source", "page", "hash"])
        writer.writeheader()
        writer.writerows(manifest)
    print(json.dumps({"unique_documents": len(seen), "rendered_pages": len(manifest)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
