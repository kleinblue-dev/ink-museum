import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:90]
    s = s.replace(old, new, 1)
rep('img = draw_fibers(img, seed=717, count=int(w * h / 2600))',
    'img = draw_fibers(img, seed=717, count=int(w * h / 1800), strength=0.60)')
rep('img = draw_fibers(img, seed=4242, count=260, wrap=True, strength=0.30)',
    'img = draw_fibers(img, seed=4242, count=380, wrap=True, strength=0.60)')
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("fiber tuned")
