#!/usr/bin/env python3
"""data/odds.json helper for the 'EPL 프로토 · 베트맨 배당 자동 입력' scheduled task.

The app (index.html, 배당 tab) reads data/odds.json. Only this file is written by the task;
betman.json / betman-state.json belong to the GitHub robot (.github/workflows/betman.yml) and are never touched.

Usage (run from the repo root):
  python3 -I tools/odds_tool.py merge /path/to/round.json   # add or update one proto round, then check
  python3 -I tools/odds_tool.py check                        # check only; exit code 1 if anything is wrong

round.json = one proto round:
  {"no": 141, "url": "https://sharppick.app/proto/2026/141/",
   "fetchedAt": "2026-11-27T13:00:00+09:00",   # the page's '…기준' time
   "ends": "2026-11-29T23:00:00+09:00",        # the round's 발매 마감
   "matches": [
     {"id": "r12-01", "roundId": "epl-2627-r12",       # matchId / roundId from the 투자실 app's rounds doc
      "espn": "401879225",                             # optional: betman.json game with the same kickoff (±1h) and same 승무패
      "ko": "2026-11-28T05:00:00+09:00",               # kickoff, Korean time
      "closes": "2026-11-27T23:00:00+09:00",           # 00:00–08:00 kickoffs close the day before at 23:00; never later than "ends"
      "home": "노팅엄 포리스트", "away": "첼시",          # the 투자실 app's Korean names
      "x12": [2.21, 3.3, 2.45],                        # required
      "x12Open": [2.3, 3.2, 2.4],                      # optional, only when the page shows ▲▼ opening odds
      "buy": [12.7, 31.6, 55.7],                       # optional, 구매율 %
      "hcp": [{"line": -1, "odds": [4.55, 3.75, 1.48]}, {"line": -2, "odds": [11, 6.5, 1.09]}],  # optional, home-team line
      "ou": {"line": 2.5, "odds": [1.84, 1.65]}}]}     # optional, [언더, 오버]

merge keeps the first x12Open ever seen for a match, overwrites everything else with the newest values,
keeps the newest 6 rounds and stamps updatedAt.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
PATH = os.path.join("data", "odds.json")
KEEP_ROUNDS = 6


def now_iso():
    return datetime.now(KST).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S+09:00")


def parse_iso(s):
    try:
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else None
    except (TypeError, ValueError):
        return None


def num_list(a, n):
    return isinstance(a, list) and len(a) == n and all(isinstance(x, (int, float)) and not isinstance(x, bool) and x > 1 for x in a)


def margin_ok(a):
    s = sum(1 / x for x in a)
    return 1.10 <= s <= 1.22, round(s, 3)


def check(doc):
    errs = []
    if not isinstance(doc, dict) or doc.get("v") != 1 or not isinstance(doc.get("rounds"), list):
        return ["top level must be {v:1, rounds:[...]}"]
    seen_no = set()
    for r in doc["rounds"]:
        no = r.get("no")
        tag = f"round {no}"
        if not isinstance(no, int) or no in seen_no:
            errs.append(f"{tag}: 'no' must be a unique whole number")
        seen_no.add(no)
        for k in ("fetchedAt", "ends"):
            if not parse_iso(r.get(k)):
                errs.append(f"{tag}: {k} must be an ISO time with +09:00")
        ms = r.get("matches")
        if not isinstance(ms, list) or not ms:
            errs.append(f"{tag}: matches must be a non-empty list")
            continue
        ids = set()
        for m in ms:
            mt = f"{tag} {m.get('id')}"
            if not m.get("id") or m["id"] in ids:
                errs.append(f"{mt}: id missing or repeated")
            ids.add(m.get("id"))
            for k in ("home", "away"):
                if not isinstance(m.get(k), str) or not m[k].strip() or "<" in m[k]:
                    errs.append(f"{mt}: {k} must be plain text")
            ko, cl, ends = parse_iso(m.get("ko")), parse_iso(m.get("closes")), parse_iso(r.get("ends"))
            if not ko or not cl:
                errs.append(f"{mt}: ko and closes must be ISO times with +09:00")
            elif cl > ko or (ends and cl > ends):
                errs.append(f"{mt}: closes must not be after the kickoff or the round end")
            if not num_list(m.get("x12"), 3):
                errs.append(f"{mt}: x12 must be 3 odds above 1")
            else:
                ok, s = margin_ok(m["x12"])
                if not ok:
                    errs.append(f"{mt}: x12 margin {s} outside 1.10–1.22 (misread?)")
            if "x12Open" in m and not num_list(m["x12Open"], 3):
                errs.append(f"{mt}: x12Open must be 3 odds above 1")
            if "buy" in m and not (isinstance(m["buy"], list) and len(m["buy"]) == 3 and all(isinstance(x, (int, float)) and 0 <= x <= 100 for x in m["buy"])):
                errs.append(f"{mt}: buy must be 3 percentages")
            for h in m.get("hcp", []) if isinstance(m.get("hcp", []), list) else [None]:
                if not (isinstance(h, dict) and isinstance(h.get("line"), (int, float)) and num_list(h.get("odds"), 3)):
                    errs.append(f"{mt}: each hcp needs line and 3 odds")
                else:
                    ok, s = margin_ok(h["odds"])
                    if not ok:
                        errs.append(f"{mt}: hcp {h['line']} margin {s} outside 1.10–1.22")
            if "ou" in m:
                o = m["ou"]
                if not (isinstance(o, dict) and isinstance(o.get("line"), (int, float)) and num_list(o.get("odds"), 2)):
                    errs.append(f"{mt}: ou needs line and 2 odds")
                else:
                    ok, s = margin_ok(o["odds"])
                    if not ok:
                        errs.append(f"{mt}: ou margin {s} outside 1.10–1.22")
    return errs


def load():
    if os.path.exists(PATH):
        with open(PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"v": 1, "league": "EPL", "source": "샤프픽(베트맨 공개 배당 수집)", "rounds": []}


def save(doc):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")


def merge(doc, new):
    old = next((r for r in doc["rounds"] if r.get("no") == new.get("no")), None)
    if old is None:
        doc["rounds"].append(new)
    else:
        by_id = {m["id"]: m for m in old.get("matches", [])}
        for m in new.get("matches", []):
            prev = by_id.get(m["id"])
            if prev and num_list(prev.get("x12Open"), 3):
                m["x12Open"] = prev["x12Open"]  # keep the first opening odds ever seen
            by_id[m["id"]] = {**(prev or {}), **m}
        old.update({k: v for k, v in new.items() if k != "matches"})
        old["matches"] = sorted(by_id.values(), key=lambda m: (m.get("ko", ""), m["id"]))
    doc["rounds"] = sorted(doc["rounds"], key=lambda r: r.get("no", 0), reverse=True)[:KEEP_ROUNDS]
    doc["updatedAt"] = now_iso()
    return doc


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("merge", "check"):
        print(__doc__)
        sys.exit(2)
    doc = load()
    if sys.argv[1] == "merge":
        with open(sys.argv[2], encoding="utf-8") as f:
            new = json.load(f)
        doc = merge(doc, new)
        errs = check(doc)
        if errs:
            print("NOT SAVED —", len(errs), "problem(s):")
            print("\n".join(" - " + e for e in errs))
            sys.exit(1)
        save(doc)
        r = next(r for r in doc["rounds"] if r["no"] == new["no"])
        print(f"saved {PATH}: round {r['no']} · {len(r['matches'])} matches · {len(doc['rounds'])} round(s) kept")
    else:
        errs = check(doc)
        print("ok" if not errs else "\n".join(" - " + e for e in errs))
        sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
