from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import fitz


ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\控制")
OUT = Path(r"C:\AI\projects\card-workspace\analysis_control")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def safe_name(path: Path) -> str:
    rel = path.relative_to(ROOT).with_suffix("")
    return "__".join(rel.parts) + ".txt"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    text_dir = OUT / "text"
    text_dir.mkdir(exist_ok=True)

    files = sorted(p for p in ROOT.rglob("*") if p.is_file())
    hashes: dict[str, list[str]] = defaultdict(list)
    rows: list[dict[str, object]] = []

    for path in files:
        digest = sha256(path)
        hashes[digest].append(str(path))
        row: dict[str, object] = {
            "school_group": path.parent.name,
            "filename": path.name,
            "extension": path.suffix.lower(),
            "bytes": path.stat().st_size,
            "sha256": digest,
            "pages": 1 if path.suffix.lower() in {".jpg", ".jpeg", ".png"} else "",
            "text_chars": 0,
        }
        if path.suffix.lower() == ".pdf":
            try:
                doc = fitz.open(path)
                row["pages"] = len(doc)
                chunks = []
                for i, page in enumerate(doc):
                    chunks.append(f"\n===== PAGE {i + 1} =====\n{page.get_text('text', sort=True)}")
                text = "".join(chunks)
                row["text_chars"] = len(re.sub(r"\s+", "", text))
                (text_dir / safe_name(path)).write_text(text, encoding="utf-8")
            except Exception as exc:
                row["error"] = repr(exc)
        rows.append(row)

    with (OUT / "inventory.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=sorted({k for r in rows for k in r}))
        writer.writeheader()
        writer.writerows(rows)
    (OUT / "duplicates.json").write_text(
        json.dumps({h: p for h, p in hashes.items() if len(p) > 1}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        "files": len(rows),
        "pdfs": sum(r["extension"] == ".pdf" for r in rows),
        "images": sum(r["extension"] in {".jpg", ".jpeg", ".png"} for r in rows),
        "unique_hashes": len(hashes),
        "duplicate_copies": sum(len(v) - 1 for v in hashes.values()),
        "pdf_pages": sum(int(r["pages"]) for r in rows if r["extension"] == ".pdf" and r["pages"] != ""),
        "pdfs_with_low_text": sum(r["extension"] == ".pdf" and int(r["text_chars"]) < 100 for r in rows),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
