from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path


BASE = Path(r"C:\AI\projects\card-workspace\analysis_math")
EXAM_ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\工數")

CHAPTERS: dict[str, dict[str, object]] = {
    "EM01": {"subject": "工程數學", "chapter": "CH1 一階 ODE", "patterns": [
        r"first[ -]?order", r"separable", r"exact\s+(?:equation|differential)", r"bernoulli", r"integrating\s+factor",
        r"riccati", r"clairaut", r"isocline", r"orthogonal\s+trajector",
    ]},
    "EM02": {"subject": "工程數學", "chapter": "CH2 高階 ODE", "patterns": [
        r"higher[ -]?order", r"second[ -]?order\s+(?:differential|ode)", r"ordinary\s+differential", r"\bode\b",
        r"wronskian", r"variation\s+of\s+parameters", r"undetermined\s+coefficient", r"cauchy[ -]?euler",
        r"euler[ -]?cauchy", r"characteristic\s+(?:root|equation)", r"fundamental\s+solution",
    ]},
    "EM03": {"subject": "工程數學", "chapter": "CH3 Laplace 轉換", "patterns": [
        r"laplace\s+transform", r"inverse\s+laplace", r"convolution", r"initial\s+value\s+theorem",
        r"final\s+value\s+theorem", r"unit\s+step", r"heaviside", r"dirac", r"impulse\s+function",
    ]},
    "EM04": {"subject": "工程數學", "chapter": "CH4 ODE 冪級數解", "patterns": [
        r"frobenius", r"power[ -]?series\s+(?:solution|method)", r"ordinary\s+point", r"regular\s+singular",
        r"indicial\s+equation", r"radius\s+of\s+convergence",
    ]},
    "EM05": {"subject": "工程數學", "chapter": "CH5 Bessel 方程式", "patterns": [
        r"bessel", r"fourier[ -]?bessel", r"cylindrical\s+(?:function|coordinate)",
    ]},
    "EM06": {"subject": "工程數學", "chapter": "CH6 Legendre 方程式", "patterns": [
        r"legendre", r"rodrigues", r"spherical\s+harmonic",
    ]},
    "EM07": {"subject": "工程數學", "chapter": "CH7 邊界值與廣義 Fourier", "patterns": [
        r"sturm[ -]?liouville", r"boundary[ -]?value", r"eigenfunction", r"orthogonal\s+(?:functions?|set)",
        r"generalized\s+fourier", r"self[ -]?adjoint\s+(?:operator|problem)",
    ]},
    "EM08": {"subject": "工程數學", "chapter": "CH8 Fourier 分析", "patterns": [
        r"fourier\s+(?:series|transform|integral|coefficient)", r"inverse\s+fourier", r"parseval", r"half[ -]?range",
        r"cosine\s+transform", r"sine\s+transform", r"frequency\s+spectrum",
    ]},
    "EM09": {"subject": "工程數學", "chapter": "CH9 偏微分方程", "patterns": [
        r"partial\s+differential", r"\bpde\b", r"heat\s+equation", r"wave\s+equation", r"poisson(?:'s)?\s+equation",
        r"laplace(?:'s)?\s+equation", r"separation\s+of\s+variables", r"initial[ -]?boundary", r"d[' ]alembert",
    ]},
    "EM10": {"subject": "工程數學", "chapter": "CH10 向量分析", "patterns": [
        r"gradient", r"divergence", r"\bcurl\b", r"green(?:'s)?\s+theorem", r"gauss(?:'s)?\s+(?:theorem|divergence)",
        r"stokes(?:'s)?\s+theorem", r"line\s+integral", r"surface\s+integral", r"vector\s+field", r"conservative\s+field",
    ]},
    "EM11": {"subject": "工程數學", "chapter": "CH11 復變分析", "patterns": [
        r"cauchy[ -]?riemann", r"analytic\s+function", r"complex\s+(?:analysis|integral|function)", r"contour\s+integral",
        r"residue", r"laurent", r"singularit", r"conformal", r"cauchy(?:'s)?\s+(?:integral|theorem)", r"argument\s+principle",
    ]},
    "LA01": {"subject": "線性代數", "chapter": "矩陣", "patterns": [
        r"determinant", r"\brank\b", r"row[ -]?(?:reduce|operation|echelon)", r"inverse\s+(?:of\s+)?(?:a\s+)?matrix",
        r"adjugate", r"cofactor", r"trace\s+of", r"linear\s+system", r"system\s+of\s+linear\s+equations",
        r"characteristic\s+polynomial", r"cayley[ -]?hamilton", r"quadratic\s+form", r"positive\s+definite",
    ]},
    "LA02": {"subject": "線性代數", "chapter": "向量空間", "patterns": [
        r"vector\s+space", r"subspace", r"linear(?:ly)?\s+independent", r"linear(?:ly)?\s+dependent", r"\bspan\b",
        r"\bbasis\b", r"\bdimension\b", r"column\s+space", r"row\s+space", r"null\s+space", r"direct\s+sum",
    ]},
    "LA03": {"subject": "線性代數", "chapter": "線性變換", "patterns": [
        r"linear\s+(?:transformation|mapping|operator)", r"kernel", r"\bimage\b", r"rank[ -]?nullity", r"isomorph",
        r"eigenvalue", r"eigenvector", r"eigenspace", r"diagonaliz", r"similar(?:ity| matrices)", r"jordan",
        r"minimal\s+polynomial", r"invariant\s+subspace", r"change\s+of\s+basis", r"matrix\s+representation",
    ]},
    "LA04": {"subject": "線性代數", "chapter": "內積空間", "patterns": [
        r"inner\s+product", r"orthogonal", r"orthonormal", r"gram[ -]?schmidt", r"least\s+squares?", r"projection",
        r"cauchy[ -]?schwarz", r"unitary", r"hermitian", r"symmetric\s+matrix", r"normal\s+matrix", r"spectral\s+theorem",
    ]},
    "LA05": {"subject": "線性代數", "chapter": "線代附錄", "patterns": [
        r"singular\s+value", r"\bsvd\b", r"pseudoinverse", r"moore[ -]?penrose", r"\bqr\s+(?:factor|decom)",
        r"\blu\s+(?:factor|decom)", r"householder", r"givens\s+rotation", r"condition\s+number", r"numerical\s+linear",
    ]},
}

for info in CHAPTERS.values():
    info["compiled"] = [re.compile(p, re.I) for p in info["patterns"]]

SCORE_RE = re.compile(r"(?:[\(（]\s*)?(\d{1,3}(?:\.\d+)?)\s*(%|％|points?|pts?|分)(?:\s*[\)）])?", re.I)
TOP_Q_RE = re.compile(r"(?im)(?=^\s*(?:problem|question|prob\.?|q\.?)?\s*(?:[1-9]|1\d|20)\s*[\.\):、])")
YEAR_RE = re.compile(r"^(\d{2,3})")


def score_matches(text: str) -> list[tuple[float, int]]:
    found = []
    for m in SCORE_RE.finditer(text):
        value = float(m.group(1))
        if 0 < value <= 100:
            found.append((value, m.start()))
    return found


def chapter_counts(text: str) -> Counter[str]:
    out: Counter[str] = Counter()
    for code, info in CHAPTERS.items():
        n = sum(len(p.findall(text)) for p in info["compiled"])
        if n:
            out[code] = n
    return out


def question_weight(chunk: str) -> float | None:
    matches = score_matches(chunk)
    if not matches:
        return None
    values = [v for v, _ in matches]
    first_near_header = matches[0][1] < 160
    if len(values) > 1 and first_near_header and 0.85 * values[0] <= sum(values[1:]) <= 1.15 * values[0]:
        return values[0]
    if first_near_header and len(values) > 1 and sum(values[1:]) <= values[0] * 1.15:
        return values[0]
    return min(sum(values), 100.0)


def difficulty(text: str, chapters: set[str], question_count: int) -> str:
    hard = len(re.findall(r"prove|show\s+that|derive|frobenius|sturm|residue|laurent|jordan|singular\s+value|spectral\s+theorem|boundary[ -]?value", text, re.I))
    breadth = len(chapters)
    mixed = bool(any(c.startswith("EM") for c in chapters) and any(c.startswith("LA") for c in chapters))
    if hard >= 7 or (hard >= 4 and breadth >= 7) or (mixed and breadth >= 9):
        return "難"
    if hard >= 3 or breadth >= 7 or question_count >= 10 or (mixed and breadth >= 6):
        return "中偏難"
    if hard >= 1 or breadth >= 4 or question_count >= 6:
        return "中等"
    return "基礎～中等"


def main() -> None:
    manifest = list(csv.DictReader((BASE / "render_manifest.csv").open(encoding="utf-8-sig")))
    dup_map = json.loads((BASE / "duplicates.json").read_text(encoding="utf-8"))
    docs: dict[str, dict[str, object]] = {}
    for row in manifest:
        digest = row["hash"]
        entry = docs.setdefault(digest, {"source": Path(row["source"]), "ocr": []})
        image = Path(row["image"])
        shard = image.parent.name
        ocr_path = BASE / "ocr" / shard / (image.stem + ".txt")
        if ocr_path.exists():
            entry["ocr"].append(ocr_path.read_text(encoding="utf-8-sig", errors="replace"))

    detail_rows = []
    chapter_incidence: Counter[str] = Counter()
    weighted_all: Counter[str] = Counter()
    weighted_explicit: Counter[str] = Counter()
    explicit_docs = 0
    schools: dict[str, Counter[str]] = defaultdict(Counter)
    difficulty_counts: Counter[str] = Counter()

    for digest, entry in docs.items():
        source: Path = entry["source"]
        ocr_text = "\n".join(entry["ocr"])
        embedded_path = BASE / "embedded_text" / f"{digest[:20]}.txt"
        embedded = embedded_path.read_text(encoding="utf-8", errors="replace") if embedded_path.exists() else ""
        text = ocr_text + "\n" + embedded
        chunks = [c.strip() for c in TOP_Q_RE.split(text) if len(c.strip()) > 20]
        if len(chunks) <= 1:
            chunks = [t for t in re.split(r"\n\s*\n", text) if len(t.strip()) > 40] or [text]

        doc_counts = chapter_counts(text)
        present = set(doc_counts)
        for code in present:
            chapter_incidence[code] += 1

        allocated: Counter[str] = Counter()
        explicit_total = 0.0
        scored_chunks = 0
        for chunk in chunks:
            counts = chapter_counts(chunk)
            weight = question_weight(chunk)
            if not counts or weight is None:
                continue
            scored_chunks += 1
            explicit_total += weight
            strength = {code: math.sqrt(n) for code, n in counts.items()}
            denom = sum(strength.values())
            for code, value in strength.items():
                allocated[code] += weight * value / denom
        usable_explicit = 65 <= explicit_total <= 135 and bool(allocated)
        if usable_explicit:
            explicit_docs += 1
            scale = 100 / sum(allocated.values())
            normalized = Counter({code: value * scale for code, value in allocated.items()})
            weighted_explicit.update(normalized)
        elif doc_counts:
            strengths = {code: math.sqrt(min(n, 12)) for code, n in doc_counts.items()}
            denom = sum(strengths.values())
            normalized = Counter({code: 100 * value / denom for code, value in strengths.items()})
        else:
            normalized = Counter()
        weighted_all.update(normalized)

        rel = source.relative_to(EXAM_ROOT)
        school = "台聯大" if "台聯大" in source.name else rel.parts[0]
        year_m = YEAR_RE.match(source.name)
        year = year_m.group(1) if year_m else "?"
        for code in present:
            schools[school][code] += 1
        diff = difficulty(text, present, len(chunks))
        difficulty_counts[diff] += 1
        em_share = sum(v for c, v in normalized.items() if c.startswith("EM"))
        la_share = sum(v for c, v in normalized.items() if c.startswith("LA"))
        detail_rows.append({
            "school_or_exam": school, "year": year, "filename": source.name,
            "engineering_math_share_pct": round(em_share, 1), "linear_algebra_share_pct": round(la_share, 1),
            "difficulty": diff, "explicit_score_total_detected": round(explicit_total, 1),
            "explicit_score_usable": usable_explicit,
            "chapters": "、".join(CHAPTERS[c]["chapter"] for c in sorted(present)),
            "chapter_weights_pct": "；".join(f"{CHAPTERS[c]['chapter']}={v:.1f}%" for c, v in normalized.most_common()),
            "source": str(source), "duplicate_locations": len(dup_map.get(digest, [str(source)])),
        })

    n_docs = len(docs)
    detail_rows.sort(key=lambda r: (str(r["school_or_exam"]), int(r["year"]) if str(r["year"]).isdigit() else -1, str(r["filename"])))
    with (BASE / "逐卷分析.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=detail_rows[0].keys()); writer.writeheader(); writer.writerows(detail_rows)

    chapter_rows = []
    for code, info in CHAPTERS.items():
        chapter_rows.append({
            "code": code, "subject": info["subject"], "chapter": info["chapter"],
            "paper_incidence_pct": round(100 * chapter_incidence[code] / n_docs, 1),
            "estimated_score_share_all_pct": round(100 * weighted_all[code] / sum(weighted_all.values()), 1),
            "explicit_score_subset_pct": round(100 * weighted_explicit[code] / sum(weighted_explicit.values()), 1) if weighted_explicit else 0,
        })
    with (BASE / "章節占比.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=chapter_rows[0].keys()); writer.writeheader(); writer.writerows(chapter_rows)

    subject_score = Counter()
    for code, value in weighted_all.items():
        subject_score[str(CHAPTERS[code]["subject"])] += value
    school_counts = Counter(r["school_or_exam"] for r in detail_rows)
    summary = {
        "unique_documents": n_docs,
        "rendered_pages": len(manifest),
        "documents_with_usable_explicit_scores": explicit_docs,
        "subject_estimated_score_share_pct": {k: round(100 * v / sum(subject_score.values()), 1) for k, v in subject_score.items()},
        "difficulty_counts": dict(difficulty_counts),
        "chapters": chapter_rows,
        "papers_by_school_or_exam": dict(school_counts),
        "chapter_incidence_by_school_pct": {
            school: {CHAPTERS[c]["chapter"]: round(100 * n / school_counts[school], 1) for c, n in counts.most_common()}
            for school, counts in schools.items()
        },
    }
    (BASE / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
