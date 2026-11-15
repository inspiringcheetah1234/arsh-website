"""Builds an ffmpeg crop `x` expression from media/hero/mobile-crop.json (eased piecewise moves).
usage: python3 -I crop-expr.py mobile-crop.json   ->  prints the expression for crop=...:x='<expr>'"""
import json, sys

kf = json.load(open(sys.argv[1]))["keyframes"]
kf.sort()

def seg(i):
    t0, c0 = kf[i]; t1, c1 = kf[i + 1]
    u = f"((t-{t0})/{t1 - t0})"
    s = f"({u}*{u}*(3-2*{u}))"                    # smoothstep
    return f"({c0}+({c1}-{c0})*{s})"

expr = f"{kf[-1][1]}"
for i in range(len(kf) - 2, -1, -1):
    expr = f"if(lt(t,{kf[i + 1][0]}),{seg(i)},{expr})"
expr = f"if(lt(t,{kf[0][0]}),{kf[0][1]},{expr})"
# centre -> left edge, kept inside the frame
print(f"max(0,min(iw-ow,iw*({expr})-ow/2))")
