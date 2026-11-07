import io
p = r"C:\Users\samcz\Documents\deepseek-harness\default-workspace\ink-museum\scripts\assets\fetch_and_compose.py"
s = io.open(p, encoding="utf-8").read()
old = """        lnew = srgb_to_lin(np.asarray(mi, dtype=np.float32) / 255.0)
        lin = lin * (lnew / np.maximum(lum, 1e-4))[..., None]
    if flatten:"""
new = """        lnew = srgb_to_lin(np.asarray(mi, dtype=np.float32) / 255.0)
        lin = lin * (lnew / np.maximum(lum, 1e-4))[..., None]
        lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    if flatten:"""
assert old in s
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("fixed lum recompute")
