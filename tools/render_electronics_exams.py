from pathlib import Path

import render_math_exams as renderer


renderer.ROOT = Path(r"C:\Users\user\Downloads\研究所 講義、補充、截圖\考古題\電子學")
renderer.OUT = Path(r"C:\AI\projects\card-workspace\analysis_electronics")

if __name__ == "__main__":
    renderer.main()
