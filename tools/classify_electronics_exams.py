from __future__ import annotations

import csv
import re
from pathlib import Path

import classify_math_exams as core


core.BASE = Path(r"C:\AI\projects\card-workspace\analysis_electronics")
core.EXAM_ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\電子學")

RAW = {
    "EL00": ("CH0 基本電路學", [r"\bkcl\b", r"\bkvl\b", r"kirchhoff", r"thevenin", r"norton", r"node\s+analysis", r"nodal\s+analysis", r"mesh\s+analysis", r"superposition", r"source\s+transformation"]),
    "EL01": ("CH1 二極體電路", [r"\bdiode", r"zener", r"rectifier", r"clipper", r"clamper", r"constant[ -]?voltage[ -]?drop", r"piecewise[ -]?linear\s+diode", r"diode\s+equation"]),
    "EL02": ("CH2 半導體簡介", [r"semiconductor", r"doping", r"p[ -]?type", r"n[ -]?type", r"fermi", r"electron[ -]?hole", r"carrier\s+concentration", r"drift\s+current", r"diffusion\s+current", r"depletion\s+region", r"pn\s+junction", r"mobility"]),
    "EL03": ("CH3 BJT 物理特性", [r"\bbjt\b", r"bipolar\s+junction", r"early\s+effect", r"ebers[ -]?moll", r"forward[ -]?active", r"base\s+current", r"collector\s+current", r"emitter\s+current", r"current\s+gain\s+beta", r"transistor\s+region"]),
    "EL04": ("CH4 BJT 直流偏壓", [r"bjt\s+bias", r"transistor\s+bias", r"bias\s+point", r"quiescent\s+point", r"\bq[ -]?point", r"dc\s+operating\s+point", r"voltage[ -]?divider\s+bias", r"collector[ -]?feedback\s+bias", r"emitter\s+bias"]),
    "EL05": ("CH5 FET 物理特性", [r"\bmosfet\b", r"\bnmos\b", r"\bpmos\b", r"threshold\s+voltage", r"body\s+effect", r"channel[ -]?length\s+modulation", r"oxide\s+capacit", r"inversion\s+layer", r"triode\s+region", r"mos\s+transistor"]),
    "EL06": ("CH6 FET 直流偏壓", [r"mos\s+bias", r"mosfet\s+bias", r"fet\s+bias", r"gate\s+bias", r"drain\s+bias", r"mos\s+operating\s+point", r"drain\s+current\s+bias"]),
    "EL07": ("CH7 BJT 線性放大器", [r"common[ -]?emitter", r"common[ -]?base", r"common[ -]?collector", r"emitter\s+follower", r"hybrid[ -]?pi", r"bjt\s+small[ -]?signal", r"ce\s+amplifier", r"cb\s+amplifier", r"cc\s+amplifier"]),
    "EL08": ("CH8 單級 FET 放大器", [r"common[ -]?source", r"common[ -]?gate", r"common[ -]?drain", r"source\s+follower", r"mos\s+small[ -]?signal", r"mosfet\s+amplifier", r"cs\s+amplifier", r"cg\s+amplifier", r"cd\s+amplifier"]),
    "EL09": ("CH9 多級放大器", [r"multi[ -]?stage", r"multistage", r"cascaded?\s+amplifier", r"cascade\s+connection", r"interstage", r"coupled\s+amplifier", r"darlington"]),
    "EL10": ("CH10 晶片基本架構", [r"current\s+mirror", r"\bcascode", r"active\s+load", r"wilson\s+mirror", r"widlar", r"compliance\s+voltage", r"high[ -]?swing\s+cascode", r"bias\s+current\s+source"]),
    "EL11": ("CH11 差動放大器", [r"differential\s+(?:pair|amplifier)", r"common[ -]?mode", r"\bcmrr\b", r"\bicmr\b", r"tail\s+current", r"differential\s+gain", r"common[ -]?mode\s+gain", r"input\s+common[ -]?mode"]),
    "EL12": ("CH12 放大器頻率響應", [r"frequency\s+response", r"cutoff\s+frequency", r"lower\s+cutoff", r"upper\s+cutoff", r"bandwidth", r"miller\s+(?:effect|theorem)", r"open[ -]?circuit\s+time", r"short[ -]?circuit\s+time", r"dominant\s+pole", r"bode\s+plot", r"coupling\s+capacitor", r"bypass\s+capacitor"]),
    "EL13": ("CH13 運算放大器", [r"op[ -]?amp", r"operational\s+amplifier", r"inverting\s+amplifier", r"non[ -]?inverting\s+amplifier", r"summing\s+amplifier", r"voltage\s+follower", r"virtual\s+(?:ground|short)", r"slew\s+rate", r"gain[ -]?bandwidth", r"\bgbw\b"]),
    "EL14": ("CH14 回授放大器", [r"negative\s+feedback", r"feedback\s+amplifier", r"loop\s+gain", r"return\s+ratio", r"desensitiv", r"series[ -]?shunt", r"shunt[ -]?series", r"series[ -]?series", r"shunt[ -]?shunt"]),
    "EL15": ("CH15 回授穩定性", [r"phase\s+margin", r"gain\s+margin", r"feedback\s+stability", r"stability\s+of", r"frequency\s+compensation", r"miller\s+compensation", r"pole\s+splitting", r"oscillat(?:e|ion)", r"nyquist"]),
    "EL16": ("CH16 OP 內部 IC 電路", [r"two[ -]?stage\s+(?:cmos\s+)?op", r"folded\s+cascode", r"telescopic\s+cascode", r"op[ -]?amp\s+internal", r"operational\s+amplifier\s+design", r"compensation\s+capacitor", r"second\s+gain\s+stage", r"unity[ -]?gain\s+frequency"]),
    "EL17": ("CH17 CMOS 反向器與邏輯", [r"cmos\s+inverter", r"voltage\s+transfer\s+characteristic", r"\bvtc\b", r"noise\s+margin", r"propagation\s+delay", r"dynamic\s+power", r"static\s+power", r"\bnand\b", r"\bnor\b", r"pass\s+(?:transistor|gate)", r"transmission\s+gate", r"logic\s+gate", r"fan[ -]?out"]),
    "EL18": ("CH18 輸出級", [r"class\s+[ab]+", r"push[ -]?pull", r"crossover\s+distortion", r"power\s+amplifier", r"output\s+stage", r"power\s+dissipation", r"thermal\s+resistance", r"safe\s+operating\s+area", r"\bsoa\b", r"efficiency"]),
    "EL19": ("CH19 濾波器電路", [r"low[ -]?pass\s+filter", r"high[ -]?pass\s+filter", r"band[ -]?pass\s+filter", r"band[ -]?stop\s+filter", r"active\s+filter", r"butterworth", r"chebyshev", r"sallen[ -]?key", r"biquad", r"filter\s+order", r"quality\s+factor"]),
    "OT99": ("未能可靠映射", []),
}

core.CHAPTERS = {}
for code, (chapter, patterns) in RAW.items():
    core.CHAPTERS[code] = {
        "subject": "總覽外" if code == "OT99" else "電子學",
        "chapter": chapter,
        "patterns": patterns,
        "compiled": [re.compile(p, re.I) for p in patterns],
    }


def counts(text: str):
    out = core.Counter()
    for code, info in core.CHAPTERS.items():
        if code == "OT99":
            continue
        n = sum(len(p.findall(text)) for p in info["compiled"])
        if n:
            out[code] = n
    if not out and len(text.strip()) >= 50:
        out["OT99"] = 1
    return out


def electronics_difficulty(text: str, chapters: set[str], question_count: int) -> str:
    markers = len(re.findall(
        r"design|derive|prove|differential\s+(?:pair|amplifier)|frequency\s+response|phase\s+margin|gain\s+margin|"
        r"feedback|compensation|cascode|cmrr|icmr|slew\s+rate|stability|body\s+effect|channel[ -]?length",
        text, re.I,
    ))
    breadth = len([c for c in chapters if c != "OT99"])
    if markers >= 10 or (markers >= 6 and breadth >= 8) or breadth >= 12:
        return "難"
    if markers >= 5 or breadth >= 7 or question_count >= 10:
        return "中偏難"
    if markers >= 2 or breadth >= 4 or question_count >= 6:
        return "中等"
    return "基礎～中等"


core.chapter_counts = counts
core.difficulty = electronics_difficulty


def postprocess() -> None:
    path = core.BASE / "逐卷分析.csv"
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    output = []
    for row in rows:
        unknown = 0.0
        for item in row["chapter_weights_pct"].split("；"):
            if item.startswith("未能可靠映射="):
                try:
                    unknown = float(item.split("=")[1].rstrip("%"))
                except ValueError:
                    pass
        output.append({
            "school_or_exam": row["school_or_exam"], "year": row["year"], "filename": row["filename"],
            "classified_electronics_share_pct": round(100 - unknown, 1), "unmapped_share_pct": round(unknown, 1),
            "difficulty": row["difficulty"], "explicit_score_total_detected": row["explicit_score_total_detected"],
            "explicit_score_usable": row["explicit_score_usable"], "chapters": row["chapters"],
            "chapter_weights_pct": row["chapter_weights_pct"], "source": row["source"],
            "duplicate_locations": row["duplicate_locations"],
        })
    target = core.BASE / "逐卷分析_電子學.csv"
    with target.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=output[0].keys()); writer.writeheader(); writer.writerows(output)


if __name__ == "__main__":
    core.main()
    postprocess()
