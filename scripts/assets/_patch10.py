import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
old = '''    path = os.path.join(ASSETS, "CREDITS.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\\n")'''
new = '''    path = os.path.join(ASSETS, "CREDITS.json")
    # 与已有清单合并：--only 局部重建时不会把其它条目的出处丢掉
    merged = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                for e in json.load(f).get("assets", []):
                    merged[e["id"]] = e
        except Exception:
            merged = {}
    for e in entries:
        merged[e["id"]] = e
    order = [a["id"] for a in ARTWORKS] + ["scroll", "paper-tile", "icons"]
    doc["assets"] = [merged[k] for k in order if k in merged]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\\n")'''
assert old in s
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("write_credits merge patched")
