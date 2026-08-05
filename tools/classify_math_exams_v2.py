from __future__ import annotations

import re

import classify_math_exams as core


core.CHAPTERS["OT01"] = {
    "subject": "總覽外",
    "chapter": "機率統計",
    "patterns": [
        r"probability", r"random\s+variable", r"probability\s+density", r"probability\s+mass",
        r"cumulative\s+distribution", r"expected\s+value", r"expectation", r"variance", r"covariance",
        r"moment\s+generating", r"characteristic\s+function", r"binomial\s+distribution",
        r"poisson\s+(?:distribution|process)", r"normal\s+distribution", r"gaussian",
        r"exponential\s+distribution", r"uniform\s+distribution", r"conditional\s+probability",
        r"bayes(?:'|ian)?", r"markov", r"random\s+process", r"stochastic",
    ],
}
core.CHAPTERS["OT01"]["compiled"] = [re.compile(p, re.I) for p in core.CHAPTERS["OT01"]["patterns"]]

if __name__ == "__main__":
    core.main()
