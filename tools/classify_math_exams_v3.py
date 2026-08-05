from __future__ import annotations

import re

import classify_math_exams as core


def add(code: str, subject: str, chapter: str, patterns: list[str]) -> None:
    core.CHAPTERS[code] = {
        "subject": subject, "chapter": chapter, "patterns": patterns,
        "compiled": [re.compile(p, re.I) for p in patterns],
    }


# Formula-heavy ODE questions often expose only the generic phrase in OCR.
core.CHAPTERS["EM02"]["compiled"].extend([
    re.compile(r"differential\s+equation", re.I),
    re.compile(r"system\s+of\s+differential", re.I),
    re.compile(r"initial\s+value\s+problem", re.I),
])

add("OT01", "總覽外", "機率統計", [
    r"probability", r"random\s+variable", r"probability\s+density", r"probability\s+mass",
    r"cumulative\s+distribution", r"expected\s+value", r"expectation", r"variance", r"covariance",
    r"moment\s+generating", r"characteristic\s+function", r"binomial\s+distribution",
    r"poisson\s+(?:distribution|process)", r"normal\s+distribution", r"gaussian",
    r"exponential\s+distribution", r"uniform\s+distribution", r"conditional\s+probability",
    r"bayes(?:'|ian)?", r"markov", r"random\s+process", r"stochastic",
])
add("OT02", "總覽外", "微積分與一般級數", [
    r"improper\s+integral", r"double\s+integral", r"triple\s+integral", r"multiple\s+integral",
    r"partial\s+derivative", r"jacobian", r"critical\s+point", r"local\s+(?:maximum|minimum)",
    r"taylor\s+series", r"maclaurin", r"series\s+converge", r"radius\s+of\s+convergence",
    r"ratio\s+test", r"root\s+test", r"fundamental\s+theorem\s+of\s+calculus",
])
add("OT99", "總覽外", "未能可靠映射", [])

_original_counts = core.chapter_counts


def counts_with_unknown(text: str):
    counts = _original_counts(text)
    if not counts and len(text.strip()) >= 50:
        counts["OT99"] = 1
    return counts


core.chapter_counts = counts_with_unknown

if __name__ == "__main__":
    core.main()
