from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageOps


ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\工數")
OUT = Path(r"C:\AI\projects\card-workspace\analysis_math")


def main() -> None:
    rendered = OUT / "rendered"
    extracted = OUT / "embedded_text"
    for i in range(4):
        (rendered / str(i)).mkdir(parents=True, exist_ok=True)
    extracted.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    manifest: list[dict[str, object]] = []
    duplicates: dict[str, list[str]] = {}
    hash_paths: dict[str, list[str]] = {}

    files = sorted(p for p in ROOT.rglob("*") if p.is_file())
    for path in files:
        full_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        hash_paths.setdefault(full_hash, []).append(str(path))
        if full_hash in seen:
            continue
        seen.add(full_hash)
        shard = str(int(full_hash[:2], 16) % 4)
        if path.suffix.lower() == ".pdf":
            doc = fitz.open(path)
            embedded_parts = []
            for page_no, page in enumerate(doc, 1):
                embedded_parts.append(f"\n===== PAGE {page_no} =====\n{page.get_text('text', sort=True)}")
                pix = page.get_pixmap(matrix=fitz.Matrix(2.05, 2.05), colorspace=fitz.csGRAY, alpha=False)
                image_path = rendered / shard / f"{full_hash[:20]}__p{page_no:03d}.png"
                pix.save(image_path)
                manifest.append({
                    "image": str(image_path), "source": str(path), "page": page_no,
                    "hash": full_hash, "school_group": path.parent.name,
                })
            (extracted / f"{full_hash[:20]}.txt").write_text("".join(embedded_parts), encoding="utf-8")
        elif path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
            image_path = rendered / shard / f"{full_hash[:20]}__p001.png"
            with Image.open(path) as im:
                ImageOps.grayscale(im).save(image_path, optimize=True)
            manifest.append({
                "image": str(image_path), "source": str(path), "page": 1,
                "hash": full_hash, "school_group": path.parent.name,
            })

    duplicates = {h: paths for h, paths in hash_paths.items() if len(paths) > 1}
    with (OUT / "render_manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["image", "source", "page", "hash", "school_group"])
        writer.writeheader(); writer.writerows(manifest)
    (OUT / "duplicates.json").write_text(json.dumps(duplicates, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "raw_files": len(files), "unique_documents": len(seen), "rendered_pages": len(manifest),
        "duplicate_copies": sum(len(v) - 1 for v in hash_paths.values()),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
