# 在 Blender 里对照游戏灰盒（米制）。由 Cursor Blender MCP 的 execute_blender_code 执行，
# 或在 Blender 脚本编辑器打开运行。
# 路径按本机仓库改 OBJ_PATH。

import bpy
import os

OBJ_PATH = r"G:\dajavu\Events\2026.9.6 TripoThon\prototype\design\machine-shell-ref\machine_shell_graybox_reference.obj"
EXPORT_DIR = r"G:\dajavu\Events\2026.9.6 TripoThon\prototype\assets\machine"


def clear_mesh_objects():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_graybox():
    if not os.path.isfile(OBJ_PATH):
        raise FileNotFoundError(OBJ_PATH)
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(
            filepath=OBJ_PATH,
            forward_axis="NEGATIVE_Z",
            up_axis="Y",
        )
    else:
        bpy.ops.import_scene.obj(filepath=OBJ_PATH, axis_forward="-Z", axis_up="Y")
    for o in bpy.context.selected_objects:
        o.name = o.name  # keep names from OBJ


def frame_camera():
    bpy.ops.object.select_all(action="DESELECT")
    for name in ("machine_base", "machine_top", "REF_cavity_volume"):
        o = bpy.data.objects.get(name)
        if o:
            o.select_set(True)
    if bpy.context.selected_objects:
        bpy.ops.view3d.view_selected()
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.clip_end = 500.0
                    break


def export_part_glb(object_name, out_name):
    obj = bpy.data.objects.get(object_name)
    if not obj:
        return False
    os.makedirs(EXPORT_DIR, exist_ok=True)
    out_path = os.path.join(EXPORT_DIR, out_name)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    return True


# --- 执行 ---
clear_mesh_objects()
import_graybox()
frame_camera()

# 示例：只导出底座（手模时复制 mesh 改名 machine_base 再 export_part_glb）
# export_part_glb("machine_base", "machine_base.glb")
