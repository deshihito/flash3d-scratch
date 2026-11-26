"""
make_minimal.py — Minimal test scene for the Python sb3_builder (reference).

Builds the exact same scene as tests/fixtures/make-minimal.ts (TS port) so
tools/compare.mjs can verify structural identity of the two project.json
outputs. Scene coverage: Stage + 1 sprite, variables (number/string/float
inits), lists, one warp custom procedure with an argument, pen drawing
(incl. pen color param), control flow (repeat / if_else / if / repeat_until /
forever), sensing, motion, looks, list ops, math ops, costume from
make_radial_glow_svg.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sb3_builder import ProjectBuilder, make_radial_glow_svg

OUT = Path(__file__).resolve().parent.parent / "out" / "python" / "minimal.sb3"


def build():
    pb = ProjectBuilder()

    stage = pb.stage
    stage.var("global_tick", 0)
    stage.when_flag_clicked([
        stage.set_var("global_tick", stage.timer()),
    ])

    s = pb.add_sprite("Renderer")
    s.var("score", 0)
    s.var("speed", 2.5)
    s.var("label", "Flash")
    s.var("count", 0)
    s.lst("points", [1, 2, 3])
    s.lst("trail")

    glow_svg, _ = make_radial_glow_svg(64)
    s.add_svg_costume("glow", glow_svg, rot_x=32, rot_y=32)

    draw = s.define_proc("draw_dot", ["n"], True, [
        s.pen_clear(),
        s.set_var("count", s.arg("n")),
        s.repeat(s.arg("n"), [
            s.goto_xy(s.mul(s.var("count"), 10), s.sub(100, s.mul(s.var("count"), 5))),
            s.pen_set_color(s.add(s.mul(s.var("count"), 65536), 255)),
            s.pen_set_param("transparency", s.mul(s.var("count"), 10)),
            s.pen_down(),
            s.pen_set_size(s.add(s.var("count"), 1)),
            s.pen_up(),
            s.add_to_list("points", s.var("count")),
            s.change_var("count", -1),
        ]),
        s.if_else(
            s.gt(s.length_of_list("points"), 3),
            [s.set_var("label", s.join("len=", s.length_of_list("points")))],
            [s.replace_item("points", 1, s.item_of("points", 1))],
        ),
        s.set_var("speed", s.div(s.add(s.var("speed"), s.rand(1, 9)), 2)),
        s.set_var("score", s.round_(s.add(s.var("score"), s.sqrt(s.mod(s.var("count"), 7))))),
        s.wait(0.1),
        s.stop_this(),
    ])

    s.when_flag_clicked([
        s.hide(),
        s.set_var("score", 0),
        s.call_proc(draw, 4),
        s.if_(s.land(s.key_pressed("space"), s.lnot(s.mouse_down())), [
            s.pen_stamp(),
            s.show(),
        ]),
        s.repeat_until(s.eq(s.var("count"), 0), [
            s.change_var("count", -1),
            s.set_x(s.mouse_x()),
            s.set_y(s.mouse_y()),
        ]),
        s.delete_all_list("trail"),
        s.set_effect("GHOST", 0),
        s.switch_costume("blank"),
        s.set_size(100),
        s.forever([
            s.change_x(1),
            s.change_y(-1),
        ]),
    ])

    return pb.save_sb3(OUT)


if __name__ == "__main__":
    print("Built:", build())
