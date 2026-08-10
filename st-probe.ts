import { startWorkspaceServer } from "./packages/server/src/index.ts";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

async function main() {
  const projectId = "我的青春戀愛喜劇太色情了";
  const server = await startWorkspaceServer({
    actor: "probe",
    host: "127.0.0.1",
    port: 0,
    projectRoot: resolve(process.cwd(), "projects"),
    autoStartWorker: false,
    projectId,
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  const endpoint = `http://127.0.0.1:${address.port}`;

  const wikiClean = readFileSync(resolve(process.cwd(), "clean-zhwiki-characters.txt"), "utf8");

  const payload = {
    kind: "source_research",
    query: "果然我的青春戀愛喜劇搞錯了 登場人物 角色設定",
    work_title: "果然我的青春戀愛喜劇搞錯了",
    character_names: ["雪之下陽乃", "雪之下雪乃", "由比濱結衣", "三浦優美子", "川崎沙希", "一色伊呂波", "平塚靜", "海老名姬菜", "比企谷小町", "雪之下清雪", "由比濱明日奈"],
    aliases: ["俺ガイル", "果青", "やはり俺の青春ラブコメはまちがっている"],
    language: "zh-Hant",
    candidates: [
      {
        title: "TBS公式やはり俺の青春ラブコメはまちがっている。完（首頁文字版）",
        url: "https://www.tbs.co.jp/anime/oregairu/",
        domain: "tbs.co.jp",
        official: true,
        content: "TVアニメ「やはり俺の青春ラブコメはまちがっている。完」公式ホームページ。まちがい続けた青春は、本物を見つける最終章へ。作品：やはり俺の青春ラブコメはまちがっている。（俺ガイル）。2020年9月4日キャラクター情報追加。2020年7月17日キャラクター情報「葉山隼人」追加。2020年7月10日キャラクター情報追加。ハッピーバースデー雪乃（1月3日）。ハッピーバースデー結衣（6月18日）。ハッピーバースデーいろは（4月16日）。©渡 航、小学館/やはりこの製作委員会はまちがっている。完",
      },
      {
        title: "果然我的青春戀愛喜劇搞錯了。 - 维基百科 登場人物章節（文字版）",
        url: "https://zh.wikipedia.org/wiki/%E6%9E%9C%E7%84%B6%E6%88%91%E7%9A%84%E9%9D%92%E6%98%A5%E6%88%80%E6%84%9B%E5%96%9C%E5%8A%87%E6%90%9E%E9%94%99%E4%BA%86",
        domain: "zh.wikipedia.org",
        official: false,
        content: wikiClean,
      },
    ],
    notes: ["本候選以乾淨純文字提供（非 HTML），供 fact-curator 產生結構化事實；內容已驗證可存取。"],
  };

  console.log("POST /workspace/template (source_research, clean text)");
  const start = Date.now();
  const response = await fetch(`${endpoint}/workspace/template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  console.log("STATUS", response.status, "ELAPSED_MS", Date.now() - start);
  console.log("BODY", text.slice(0, 3000));
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

main().catch((error) => {
  console.error("PROBE_FAILED", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
