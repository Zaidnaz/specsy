# Generates the README artwork in light and dark variants.
#
# Two renderer constraints shape this file:
#   * Presentation attributes only, no <style> and no web fonts. An SVG loaded
#     through <img> on GitHub can fetch neither.
#   * Arrow markers use orient="auto", not "auto-start-reverse": resvg ignores
#     the latter on marker-end and leaves the head pointing right.
import pathlib

OUT = pathlib.Path("E:/projects3/spec_driven_developement/assets")

MONO = "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace"
SANS = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif"

LIGHT = dict(bg="#ffffff", panel="#f6f8fa", border="#d1d9e0", fg="#1f2328",
             muted="#59636e", brand="#0969da", red="#cf222e", green="#1a7f37",
             amber="#9a6700")
DARK = dict(bg="#0d1117", panel="#161b22", border="#3d444d", fg="#f0f6fc",
            muted="#9198a1", brand="#4493f8", red="#ff7b72", green="#3fb950",
            amber="#d29922")

DOT, ARROW, DASH, ELL = "\u00b7", "\u2192", "\u2014", "\u2026"


def squiggle(x0, x1, y, amp=3.5, period=9.0):
    """The spell-checker underline: alternating quadratic humps."""
    parts = ["M %.1f %.1f" % (x0, y)]
    x, up = x0, True
    while x < x1 - 0.1:
        nx = min(x + period, x1)
        parts.append("Q %.1f %.1f %.1f %.1f"
                     % ((x + nx) / 2, y - amp if up else y + amp, nx, y))
        up, x = not up, nx
    return " ".join(parts)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=16, fill="#000", family=SANS, weight="normal",
         anchor="start", length=None, spacing=None):
    a = ['x="%.1f"' % x, 'y="%.1f"' % y, 'font-family="%s"' % family,
         'font-size="%s"' % size, 'fill="%s"' % fill]
    if weight != "normal":
        a.append('font-weight="%s"' % weight)
    if anchor != "start":
        a.append('text-anchor="%s"' % anchor)
    if spacing is not None:
        a.append('letter-spacing="%s"' % spacing)
    if length is not None:
        # Force an exact advance so neighbouring runs can be placed by
        # arithmetic instead of guessing the renderer's font metrics.
        a.append('textLength="%.1f" lengthAdjust="spacing"' % length)
    return "  <text %s>%s</text>" % (" ".join(a), esc(s))


def rect(x, y, w, h, fill, stroke=None, rx=10, sw=1.5, dash=None):
    a = ['x="%.1f"' % x, 'y="%.1f"' % y, 'width="%.1f"' % w,
         'height="%.1f"' % h, 'rx="%s"' % rx, 'fill="%s"' % fill]
    if stroke:
        a += ['stroke="%s"' % stroke, 'stroke-width="%s"' % sw]
    if dash:
        a.append('stroke-dasharray="%s"' % dash)
    return "  <rect %s/>" % " ".join(a)


def head(w, h, label):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="%d" height="%d" role="img" aria-label="%s">' % (w, h, w, h, label))


def banner(c):
    W, H = 1200, 320
    o = [head(W, H, "specsy - a linter for specifications, as a CLI and an MCP server")]
    o.append(rect(0, 0, W, H, c["bg"], rx=0))

    o.append(text(80, 96, "specsy", 62, c["fg"], SANS, "700"))
    o.append(text(80, 134, "A linter for specifications", 22, c["muted"]))
    o.append(text(80, 162, "CLI and MCP server %s 16 deterministic rules %s no LLM, no API key"
                  % (DOT, DOT), 15, c["muted"], MONO))

    o.append(rect(930, 62, 190, 40, c["panel"], c["border"], rx=20))
    o.append(text(1025, 89, "npx specsy", 18, c["brand"], MONO, anchor="middle"))

    # A spec sentence with its unmeasurable word called out. This says what the
    # tool does faster than any prose could.
    o.append(rect(60, 190, 1080, 108, c["panel"], c["border"]))

    adv, size, base, x = 18.6, 30, 234, 96.0
    a, b, d = "The system MUST be", "fast", "."
    wa, wb = len(a) * adv, len(b) * adv
    bx = x + wa + adv          # one blank advance stands in for the space
    o.append(text(x, base, a, size, c["fg"], MONO, length=wa))
    o.append(text(bx, base, b, size, c["red"], MONO, "600", length=wb))
    o.append(text(bx + wb, base, d, size, c["fg"], MONO, length=adv))
    o.append('  <path d="%s" fill="none" stroke="%s" stroke-width="2.5" '
             'stroke-linecap="round"/>' % (squiggle(bx, bx + wb, base + 12), c["red"]))

    # The finding, tied to the underlined word by a short leader line.
    o.append('  <path d="M %.1f 254 L %.1f 272" fill="none" stroke="%s" '
             'stroke-width="1.5" opacity="0.55"/>' % (bx + 4, bx + 4, c["muted"]))
    rule, note = "quantify-performance", ("no target given %s state a budget, "
                                          "e.g. p95 under 200ms" % DASH)
    rx_, rw = bx + 14, len(rule) * 9.0
    o.append(text(rx_, 278, rule, 15, c["red"], MONO, "600", length=rw))
    o.append(text(rx_ + rw + 12, 278, note, 14, c["muted"], MONO, length=len(note) * 8.4))

    o.append("</svg>")
    return "\n".join(o)


def workflow(c):
    """
    The loop, as it works once specsy is reachable over MCP.

    The earlier version of this diagram showed specsy as a gate a person walks
    the spec through. That is no longer the interesting claim: the agent calls
    the rules itself and corrects its own spec before writing any code, so the
    self-correction cycle is what the picture has to show.
    """
    W, H = 1200, 500
    o = [head(W, H, "The loop: you describe a feature, the agent writes a spec, "
                    "lints it with specsy, fixes what it finds, and only then implements")]
    o.append("  <defs>")
    for name, col in (("g", c["green"]), ("m", c["muted"]), ("a", c["amber"]),
                      ("b", c["brand"])):
        o.append('    <marker id="ah-%s" viewBox="0 0 10 10" refX="9" refY="5" '
                 'markerWidth="7" markerHeight="7" orient="auto">'
                 '<path d="M 0 0 L 10 5 L 0 10 z" fill="%s"/></marker>' % (name, col))
    o.append("  </defs>")
    o.append(rect(0, 0, W, H, c["bg"], rx=0))

    def step_label(x, y, n):
        return text(x, y, "STEP %d" % n, 12, c["brand"], SANS, "700", spacing="1.4")

    # 1 - the human's whole job
    o.append(rect(40, 98, 250, 90, c["panel"], c["border"]))
    o.append(step_label(68, 124, 1))
    o.append(text(68, 150, "You describe", 19, c["fg"], SANS, "700"))
    o.append(text(68, 172, "the feature", 19, c["fg"], SANS, "700"))

    # 2 - the agent, with the gate inside it
    o.append(rect(330, 60, 520, 330, c["panel"], c["brand"], sw=2.5))
    o.append(step_label(380, 92, 2))
    o.append(text(444, 92, "Your agent, on its own", 15, c["muted"]))

    o.append(rect(380, 120, 420, 46, c["bg"], c["border"], rx=8))
    o.append(text(590, 149, "writes the spec", 17, c["fg"], SANS, anchor="middle"))

    o.append(rect(380, 196, 420, 46, c["bg"], c["brand"], rx=8, sw=2))
    o.append(text(590, 225, "calls lint_specs", 17, c["brand"], MONO, "600", anchor="middle"))

    o.append(rect(380, 272, 420, 46, c["bg"], c["amber"], rx=8))
    o.append(text(590, 301, "reads the fix, rewrites the spec", 16, c["amber"], SANS, anchor="middle"))

    o.append('  <line x1="590" y1="166" x2="590" y2="190" stroke="%s" '
             'stroke-width="2.5" marker-end="url(#ah-m)"/>' % c["muted"])
    o.append('  <line x1="590" y1="242" x2="590" y2="266" stroke="%s" '
             'stroke-width="2.5" marker-end="url(#ah-a)"/>' % c["amber"])
    o.append(text(606, 261, "findings", 13, c["amber"], MONO, "600"))

    # The self-correction return path: no human anywhere on it.
    o.append('  <path d="M 380 295 L 356 295 Q 348 295 348 287 L 348 227 '
             'Q 348 219 356 219 L 374 219" fill="none" stroke="%s" '
             'stroke-width="2.5" stroke-dasharray="7 5" marker-end="url(#ah-a)"/>'
             % c["amber"])

    o.append(text(380, 356, "16 deterministic rules %s no LLM %s no API key" % (DOT, DOT),
                  14, c["muted"]))

    # 3 - only reached when the spec passes
    o.append(rect(930, 174, 230, 90, c["panel"], c["green"]))
    o.append(step_label(958, 200, 3))
    o.append(text(958, 226, "It implements", 19, c["fg"], SANS, "700"))
    o.append(text(958, 248, "the change", 19, c["fg"], SANS, "700"))

    o.append('  <line x1="290" y1="143" x2="374" y2="143" stroke="%s" '
             'stroke-width="2.5" marker-end="url(#ah-m)"/>' % c["muted"])
    o.append('  <line x1="804" y1="219" x2="926" y2="219" stroke="%s" '
             'stroke-width="2.5" marker-end="url(#ah-g)"/>' % c["green"])
    o.append(text(890, 206, "clean", 14, c["green"], MONO, "600", anchor="middle"))

    o.append(text(600, 438, "The agent calls the rules itself %s nobody copies output between windows"
                  % DASH, 16, c["fg"], anchor="middle"))
    o.append(text(600, 466, "claude mcp add specsy -- npx -y specsy mcp",
                  15, c["brand"], MONO, anchor="middle"))
    o.append("</svg>")
    return "\n".join(o)


def commands(c):
    """What to call, and when. The same content as `specsy --help`."""
    W, H = 1200, 420
    o = [head(W, H, "specsy commands: lint, rules, explain, footprint, mcp")]
    o.append(rect(0, 0, W, H, c["bg"], rx=0))
    o.append(text(60, 62, "What to call, and when", 26, c["fg"], SANS, "700"))
    o.append(text(60, 88, "specsy --help", 15, c["muted"], MONO))

    rows = [
        ("specsy", "You have written or edited a spec and want it checked before implementing.", c["brand"]),
        ("specsy rules", "You are about to write your first spec and want to know the bar.", c["fg"]),
        ("specsy explain <rule>", "A finding is unclear and you want to see what good looks like.", c["fg"]),
        ("specsy footprint", "A change feels large and you want to know what re-reading it costs.", c["fg"]),
        ("specsy mcp", "You want the agent to lint and fix its own specs, with no human relaying output.", c["green"]),
    ]
    y = 130
    for cmd, when, col in rows:
        o.append(rect(60, y - 26, 1080, 44, c["panel"], c["border"], rx=8))
        o.append(text(84, y, cmd, 17, col, MONO, "600"))
        o.append(text(400, y, when, 15, c["muted"]))
        y += 52

    o.append(text(60, y + 14, "Exit codes:  0 = clean %s 1 = findings %s 2 = specsy could not run"
                  % (DOT, DOT), 14, c["muted"], MONO))
    o.append("</svg>")
    return "\n".join(o)


OUT.mkdir(parents=True, exist_ok=True)
for name, fn in (("banner", banner), ("workflow", workflow), ("commands", commands)):
    for suffix, theme in (("light", LIGHT), ("dark", DARK)):
        p = OUT / ("%s-%s.svg" % (name, suffix))
        p.write_text(fn(theme), encoding="utf8")
        print("%-24s %6d bytes" % (p.name, p.stat().st_size))
