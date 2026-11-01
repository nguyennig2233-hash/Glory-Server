package com.glory.cosmetics;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Everything that does not touch Minecraft: reads config/glory-cosmetics (written by the launcher), builds the quads, applies the creator's
 * placement, and hands finished vertices to a version-specific sink. Each Minecraft version only supplies a small adapter (see mcX_Y_Z/).
 * Format and coordinate rules: SPEC.md. The maths must match CosModel.xform in the launcher's renderer/cosmodel.js.
 */
public final class CosCore {
    public static final String[] SLOTS = {"head", "back", "armR", "armL", "legR", "legL"};
    static final String[] FACES = {"north", "east", "south", "west", "up", "down"};
    // Corner order matches the UV corners (top-left, bottom-left, bottom-right, top-right), as in vanilla's FaceInfo. Index 0/1 = from/to.
    static final int[][][] FV = {
        {{1, 1, 0}, {1, 0, 0}, {0, 0, 0}, {0, 1, 0}}, {{1, 1, 1}, {1, 0, 1}, {1, 0, 0}, {1, 1, 0}}, {{0, 1, 1}, {0, 0, 1}, {1, 0, 1}, {1, 1, 1}},
        {{0, 1, 0}, {0, 0, 0}, {0, 0, 1}, {0, 1, 1}}, {{0, 1, 0}, {0, 1, 1}, {1, 1, 1}, {1, 1, 0}}, {{0, 0, 1}, {0, 0, 0}, {1, 0, 0}, {1, 0, 1}},
    };
    static final float[][] NORMAL = {{0, 0, -1}, {1, 0, 0}, {0, 0, 1}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}};

    /** Creates the version's texture for a PNG and returns whatever handle the adapter wants back (usually an Identifier). */
    public interface TexFactory { Object make(String id, byte[] png) throws Exception; }
    /** Receives one vertex in the bone's space, already divided by 16 (blocks). */
    public interface Sink { void vertex(float x, float y, float z, float u, float v, float nx, float ny, float nz); }

    public static final class Item {
        public final String id, slot; public Object texture;
        final float[] tm = {0, 0, 0}, tr = {0, 0, 0}, ts = {1, 1, 1};
        final List<float[][]> pos = new ArrayList<>(), uv = new ArrayList<>(); final List<Integer> face = new ArrayList<>();
        Item(String id, String slot) { this.id = id; this.slot = slot; }
    }

    private final Path dir; private final TexFactory tex;
    private final Map<String, Item> items = new HashMap<>(); private final Map<String, String> worn = new HashMap<>();
    private long checked;

    /** Java 8 and Gson 2.8.0 safe (Minecraft 1.16 ships both): no Files.readString, no static JsonParser.parseString. */
    private static JsonElement parse(Path f) throws java.io.IOException { return new JsonParser().parse(new String(Files.readAllBytes(f), java.nio.charset.StandardCharsets.UTF_8)); }

    public CosCore(Path dir, TexFactory tex) { this.dir = dir; this.tex = tex; }

    /** The items worn right now, by slot. Re-reads the manifest at most every 3 s (the launcher rewrites it when you change what you wear). */
    public Map<String, Item> worn() {
        long now = System.currentTimeMillis();
        if (now - checked >= 3000) {
            checked = now;
            try {
                JsonObject eq = parse(dir.resolve("manifest.json")).getAsJsonObject().getAsJsonObject("equip"); worn.clear();
                for (String s : SLOTS) if (eq.has(s)) {
                    String id = eq.get(s).getAsString(); worn.put(s, id);
                    if (!items.containsKey(id)) items.put(id, load(id));
                }
            } catch (Exception ignored) { worn.clear(); }
        }
        Map<String, Item> out = new HashMap<>(); for (Map.Entry<String, String> e : worn.entrySet()) { Item it = items.get(e.getValue()); if (it != null) out.put(e.getKey(), it); }
        return out;
    }

    /** Offset (x, y) of a slot's anchor inside its bone's space, in pixels; the bone itself is chosen by the adapter (head, body, arm or leg). */
    public static float[] anchor(String slot) { return new float[]{slot.equals("armR") ? -1 : slot.equals("armL") ? 1 : 0, slot.equals("head") ? 0 : 12}; }

    /** Emit all quads of an item (4 vertices each). The caller has already applied the bone's transform. */
    public static void emit(Item it, Sink sink) {
        float[] an = anchor(it.slot);
        for (int q = 0; q < it.pos.size(); q++) {
            float[][] p = it.pos.get(q), uv = it.uv.get(q); float[] n = NORMAL[it.face.get(q)];
            for (int i = 0; i < 4; i++) sink.vertex((an[0] - p[i][0]) / 16f, (an[1] - p[i][1]) / 16f, p[i][2] / 16f, uv[i][0], uv[i][1], -n[0], -n[1], n[2]);
        }
    }

    private Item load(String id) throws Exception {
        JsonObject m = parse(dir.resolve("models").resolve(id + ".json")).getAsJsonObject();
        Item it = new Item(id, m.get("slot").getAsString()); float w = m.get("w").getAsFloat(), h = m.get("h").getAsFloat();
        if (m.has("tf")) { JsonObject tf = m.getAsJsonObject("tf"); copy(arr(tf.getAsJsonArray("m")), it.tm); copy(arr(tf.getAsJsonArray("r")), it.tr); copy(arr(tf.getAsJsonArray("s")), it.ts); }
        for (JsonElement ee : m.getAsJsonArray("els")) {
            JsonObject e = ee.getAsJsonObject(), fc = e.getAsJsonObject("fc");
            float[] f = arr(e.getAsJsonArray("f")), t = arr(e.getAsJsonArray("t")), o = arr(e.getAsJsonArray("o")), r = arr(e.getAsJsonArray("r"));
            for (int n = 0; n < 6; n++) {
                if (!fc.has(FACES[n])) continue;
                float[] q = arr(fc.getAsJsonArray(FACES[n])); int k = ((int) q[4] / 90) & 3;
                float u1 = q[0] / w, v1 = q[1] / h, u2 = q[2] / w, v2 = q[3] / h; float[][] cor = {{u1, v1}, {u1, v2}, {u2, v2}, {u2, v1}}, uvs = new float[4][], ps = new float[4][];
                for (int i = 0; i < 4; i++) {
                    uvs[i] = cor[(i + k) % 4]; int[] c = FV[n][i];
                    ps[i] = place(it, rotate(new float[]{c[0] == 1 ? t[0] : f[0], c[1] == 1 ? t[1] : f[1], c[2] == 1 ? t[2] : f[2]}, o, r));
                }
                it.pos.add(ps); it.uv.add(uvs); it.face.add(n);
            }
        }
        it.texture = tex.make(id, Files.readAllBytes(dir.resolve("tex").resolve(id + ".png")));
        return it;
    }

    /** Model point (after the cube's own rotation) -> offset from the slot anchor in block axes: scale about (8,0,8), rotate, then move. */
    private static float[] place(Item it, float[] q) {
        float[] l = rotate(new float[]{(q[0] - 8) * it.ts[0], q[1] * it.ts[1], (q[2] - 8) * it.ts[2]}, new float[]{0, 0, 0}, it.tr);
        return new float[]{l[0] + it.tm[0], l[1] + it.tm[1], l[2] + it.tm[2]};
    }
    /** Rotate about o, X then Y then Z (degrees), like Blockbench. */
    static float[] rotate(float[] p, float[] o, float[] r) {
        double x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2], c, s, t;
        if (r[0] != 0) { c = Math.cos(Math.toRadians(r[0])); s = Math.sin(Math.toRadians(r[0])); t = y * c - z * s; z = y * s + z * c; y = t; }
        if (r[1] != 0) { c = Math.cos(Math.toRadians(r[1])); s = Math.sin(Math.toRadians(r[1])); t = x * c + z * s; z = -x * s + z * c; x = t; }
        if (r[2] != 0) { c = Math.cos(Math.toRadians(r[2])); s = Math.sin(Math.toRadians(r[2])); t = x * c - y * s; y = x * s + y * c; x = t; }
        return new float[]{(float) x + o[0], (float) y + o[1], (float) z + o[2]};
    }
    private static float[] arr(JsonArray a) { float[] o = new float[a.size()]; for (int i = 0; i < o.length; i++) o[i] = a.get(i).getAsFloat(); return o; }
    private static void copy(float[] a, float[] to) { System.arraycopy(a, 0, to, 0, Math.min(3, a.length)); }
}
