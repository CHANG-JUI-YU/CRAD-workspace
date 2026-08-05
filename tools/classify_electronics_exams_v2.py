from __future__ import annotations

import re

import classify_electronics_exams as app


EXTRA = {
    "EL04": [r"(?:bjt|transistor)[\s\S]{0,600}(?:dc\s+analysis|collector\s+current|base\s+current|collector\s+voltage)", r"(?:dc\s+analysis|collector\s+current|base\s+current)[\s\S]{0,600}(?:bjt|transistor)"],
    "EL06": [r"(?:mosfet|nmos|pmos)[\s\S]{0,600}(?:dc\s+analysis|drain\s+current|bias\s+point|operating\s+point)", r"(?:dc\s+analysis|drain\s+current|bias\s+point)[\s\S]{0,600}(?:mosfet|nmos|pmos)"],
    "EL07": [r"(?:bjt|transistor)[\s\S]{0,700}(?:voltage\s+gain|input\s+resistance|output\s+resistance|\brin\b|\brout\b)", r"(?:voltage\s+gain|input\s+resistance|output\s+resistance)[\s\S]{0,700}(?:bjt|transistor)"],
    "EL08": [r"(?:mosfet|nmos|pmos)[\s\S]{0,700}(?:voltage\s+gain|input\s+resistance|output\s+resistance|\brin\b|\brout\b)", r"(?:voltage\s+gain|input\s+resistance|output\s+resistance)[\s\S]{0,700}(?:mosfet|nmos|pmos)"],
}
for code, patterns in EXTRA.items():
    app.core.CHAPTERS[code]["patterns"].extend(patterns)
    app.core.CHAPTERS[code]["compiled"].extend(re.compile(p, re.I) for p in patterns)

if __name__ == "__main__":
    app.core.main()
    app.postprocess()
