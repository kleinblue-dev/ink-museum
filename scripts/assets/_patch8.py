import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
old = '"tall": {"cache": "bamboo_wentong.jpg", "box": (0.10, 0.205, 0.8672, 0.985),'
new = '"tall": {"cache": "bamboo_wentong.jpg", "box": (0.10, 0.222, 0.8500, 0.985),'
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok")
