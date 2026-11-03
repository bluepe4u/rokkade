#!/usr/bin/env python3
"""Fetch a rating-balanced sample of public chess.com games that carry chess.com's accuracy numbers.

Players are sampled from public country member lists (a spread of all ratings, unlike the
leaderboards), and each player's latest month of games is read. Games are bucketed by the two
players' average rating so every band gets the same number.

Usage: python tools/fetch_accuracy_sample.py OUT.json [--per-band 25] [--seed 7]
Then:  node tools/calibrate-accuracy.mjs OUT.json
"""
import argparse, json, random, sys, time, urllib.request

UA = "outpost-accuracy-calibration/1.0 (offline research tool)"
API = "https://api.chess.com/pub"
COUNTRIES = ["IS", "EE", "LU", "MT", "CY", "SI", "LV", "LT", "IE", "NZ", "FI", "NO", "DK", "HR", "UY"]
BANDS = [(0, 800), (800, 1200), (1200, 1600), (1600, 2000), (2000, 3500)]


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            if e.code in (404, 410):
                return None
            raise
        except Exception:
            time.sleep(2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--per-band", type=int, default=25)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--max-players", type=int, default=600)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    names = []
    for c in COUNTRIES:
        d = get(f"{API}/country/{c}/players") or {}
        ps = d.get("players", [])
        rnd.shuffle(ps)
        names += ps[:80]
        time.sleep(0.3)
    # Titled players (and their opponents) fill the higher bands, which country lists rarely reach.
    titled = []
    for t in ("CM", "NM", "WCM", "WFM", "FM"):
        d = get(f"{API}/titled/{t}") or {}
        ps = d.get("players", [])
        rnd.shuffle(ps)
        titled += ps[:60]
        time.sleep(0.3)
    rnd.shuffle(names)
    rnd.shuffle(titled)
    mixed = []
    for i in range(max(len(names), len(titled))):
        if i < len(names):
            mixed.append(names[i])
        if i < len(titled) and i % 2 == 0:
            mixed.append(titled[i])
    names = mixed
    buckets = {b: [] for b in BANDS}
    seen = set()
    for i, name in enumerate(names[: a.max_players]):
        if all(len(v) >= a.per_band for v in buckets.values()):
            break
        ar = get(f"{API}/player/{name}/games/archives") or {}
        months = ar.get("archives", [])
        time.sleep(0.25)
        if not months:
            continue
        games = (get(months[-1]) or {}).get("games", [])
        time.sleep(0.25)
        taken = 0
        for g in games:
            if taken >= 2:
                break  # at most two games per player, to spread the sample
            if g.get("rules") != "chess" or g.get("time_class") not in ("blitz", "rapid"):
                continue
            acc = g.get("accuracies") or {}
            if "white" not in acc or "black" not in acc or g.get("uuid") in seen:
                continue
            pgn = g.get("pgn", "")
            if pgn.count(".") < 30:  # very short games say little about accuracy
                continue
            avg = (g["white"]["rating"] + g["black"]["rating"]) / 2
            band = next((b for b in BANDS if b[0] <= avg < b[1]), None)
            if not band or len(buckets[band]) >= a.per_band:
                continue
            seen.add(g.get("uuid"))
            buckets[band].append({
                "uuid": g.get("uuid"), "pgn": pgn, "time_class": g["time_class"], "time_control": g.get("time_control"),
                "accuracies": acc, "white": {"rating": g["white"]["rating"]}, "black": {"rating": g["black"]["rating"]},
            })
            taken += 1
        if i % 20 == 0:
            print(f"{i} players · " + " ".join(f"{b[0]}+:{len(v)}" for b, v in buckets.items()), file=sys.stderr)
    out = [g for v in buckets.values() for g in v]
    with open(a.out, "w") as f:
        json.dump(out, f)
    print(f"saved {len(out)} games: " + ", ".join(f"{b[0]}-{b[1]}: {len(v)}" for b, v in buckets.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
