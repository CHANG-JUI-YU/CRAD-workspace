from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


BASE = Path(r"C:\AI\projects\card-workspace\analysis_control")

CATEGORIES: dict[str, list[str]] = {
    "系統建模與表示": [
        r"transfer\s*function", r"block\s*diagram", r"signal\s*flow", r"mason", r"model(?:ing|ling)?",
        r"mechanical\s+system", r"electrical\s+system", r"lineariz", r"differential\s+equation",
    ],
    "時域響應與穩態誤差": [
        r"step\s*response", r"impulse\s*response", r"time\s*response", r"transient", r"steady[\s-]*state\s*error",
        r"overshoot", r"settling\s*time", r"rise\s*time", r"peak\s*time", r"error\s*constant", r"system\s*type",
        r"second[\s-]*order", r"damping\s*ratio", r"dominant\s*pole",
    ],
    "穩定度與Routh": [
        r"routh", r"hurwitz", r"bibo", r"stabilit", r"stable", r"unstable", r"characteristic\s+equation",
        r"right[\s-]*half", r"imaginary\s+axis",
    ],
    "根軌跡": [r"root\s*locus", r"root[-\s]*loci", r"breakaway", r"departure\s*angle", r"arrival\s*angle"],
    "頻率響應與裕度": [
        r"bode", r"nyquist", r"nichols", r"polar\s*plot", r"frequency\s*response", r"gain\s*margin",
        r"phase\s*margin", r"bandwidth", r"resonant\s*(?:peak|frequency)", r"minimum\s*phase",
    ],
    "控制器與補償設計": [
        r"controller", r"compensator", r"compensation", r"lead", r"lag", r"pid", r"proportional", r"integral\s+control",
        r"derivative\s+control", r"pole\s*placement", r"design", r"servo", r"regulator", r"disturbance\s+rejection",
    ],
    "狀態空間與狀態轉移": [
        r"state[\s-]*space", r"state\s+equation", r"state\s+transition", r"transition\s+matrix", r"matrix\s+exponential",
        r"canonical\s+form", r"eigenvalue", r"eigenvector", r"similarity\s+transform", r"realization",
    ],
    "可控可觀與估測器": [
        r"controllab", r"observab", r"observer", r"state\s*feedback", r"state\s+feedback", r"kalman", r"detectab",
        r"stabilizab", r"output\s+feedback",
    ],
    "非線性控制": [
        r"lyapunov", r"phase\s*plane", r"phase\s*portrait", r"describing\s*function", r"limit\s*cycle",
        r"nonlinear", r"saturation", r"dead[\s-]*zone", r"relay", r"linearization",
    ],
    "離散時間與數位控制": [
        r"z[\s-]*transform", r"z\s*plane", r"jury", r"discrete[\s-]*time", r"sampled[\s-]*data", r"sampling\s+(?:period|time|rate)",
        r"digital\s+control", r"pulse\s+transfer",
    ],
    "靈敏度與強健性": [
        r"sensitivity", r"robust", r"model\s+uncertainty", r"uncertaint", r"complementary\s+sensitivity",
    ],
}

COMPILED = {k: [re.compile(p, re.I) for p in ps] for k, ps in CATEGORIES.items()}
SCORE_RE = re.compile(r"[\(（]\s*(\d{1,3})\s*(?:%|％|points?|pts?)\s*[\)）]", re.I)
YEAR_RE = re.compile(r"^(\d{2,3})")


def categories(text: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for cat, patterns in COMPILED.items():
        counts[cat] = sum(len(p.findall(text)) for p in patterns)
    return +counts


def exam_key(source: Path) -> tuple[str, str, str]:
    year_match = YEAR_RE.match(source.name)
    year = year_match.group(1) if year_match else "?"
    label = source.parent.name
    if "台聯大" in source.name:
        label = "台聯大"
    # Multiple JPG pages for the same NTU exam become one paper.
    return label, year, source.suffix.lower() == ".pdf" and source.stem or re.sub(r"\d+$", "", source.stem)


def main() -> None:
    manifest = list(csv.DictReader((BASE / "render_manifest.csv").open(encoding="utf-8-sig")))
    docs: dict[tuple[str, str, str], dict[str, object]] = {}
    for row in manifest:
        source = Path(row["source"])
        key = exam_key(source)
        entry = docs.setdefault(key, {"label": key[0], "year": key[1], "sources": set(), "texts": []})
        entry["sources"].add(str(source))
        ocr_path = BASE / "ocr" / (Path(row["image"]).stem + ".txt")
        text = ocr_path.read_text(encoding="utf-8-sig", errors="replace") if ocr_path.exists() else ""
        entry["texts"].append(text)

    rows = []
    score_totals: Counter[str] = Counter()
    score_papers = 0
    incidence: Counter[str] = Counter()
    incidence_by_school: dict[str, Counter[str]] = defaultdict(Counter)
    paper_count_by_school: Counter[str] = Counter()
    advanced_words = re.compile(r"proof|prove|derive|design|lyapunov|nonlinear|observer|robust|uncertaint|state[\s-]*feedback", re.I)

    for entry in docs.values():
        text = "\n".join(entry["texts"])
        cat_counts = categories(text)
        present = {cat for cat, n in cat_counts.items() if n}
        for cat in present:
            incidence[cat] += 1
            incidence_by_school[str(entry["label"])][cat] += 1
        paper_count_by_school[str(entry["label"])] += 1

        attributed: Counter[str] = Counter()
        scores = list(SCORE_RE.finditer(text))
        previous_end = 0
        for match in scores:
            value = int(match.group(1))
            if not 1 <= value <= 100:
                continue
            start = max(previous_end, match.start() - 900)
            chunk = text[start:match.start()]
            local = categories(chunk)
            # Prefer the strongest one or two nearby subjects, since a subpart can combine methods.
            chosen = [cat for cat, _ in local.most_common(2)]
            if chosen:
                for cat in chosen:
                    attributed[cat] += value / len(chosen)
            previous_end = match.end()
        score_sum = sum(int(m.group(1)) for m in scores if 1 <= int(m.group(1)) <= 100)
        usable_scores = 70 <= score_sum <= 130
        if usable_scores and attributed:
            score_papers += 1
            scale = 100 / sum(attributed.values())
            for cat, value in attributed.items():
                score_totals[cat] += value * scale

        advanced = len(advanced_words.findall(text))
        breadth = len(present)
        if advanced >= 5 or (advanced >= 3 and breadth >= 7):
            difficulty = "難"
        elif advanced >= 2 or breadth >= 6:
            difficulty = "中偏難"
        elif breadth >= 4:
            difficulty = "中等"
        else:
            difficulty = "基礎～中等"
        rows.append({
            "school": entry["label"], "year": entry["year"], "difficulty": difficulty,
            "categories": "、".join(sorted(present)), "explicit_score_sum": score_sum,
            "score_usable": usable_scores, "advanced_markers": advanced, "category_breadth": breadth,
            "source": " | ".join(sorted(entry["sources"])),
        })

    rows.sort(key=lambda r: (str(r["school"]), int(r["year"]) if str(r["year"]).isdigit() else -1))
    with (BASE / "exam_classification.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader(); writer.writerows(rows)

    payload = {
        "exam_papers": len(rows),
        "papers_with_usable_explicit_scores": score_papers,
        "topic_incidence_pct": {k: round(v / len(rows) * 100, 1) for k, v in incidence.most_common()},
        "explicit_score_share_pct": {k: round(v / (score_papers * 100) * 100, 1) for k, v in score_totals.most_common()},
        "papers_by_school": dict(paper_count_by_school),
        "topic_incidence_by_school_pct": {
            school: {cat: round(n / paper_count_by_school[school] * 100, 1) for cat, n in counts.most_common()}
            for school, counts in incidence_by_school.items()
        },
        "difficulty_counts": dict(Counter(r["difficulty"] for r in rows)),
    }
    (BASE / "summary.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
