package com.glory.cosmetics;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;

import java.util.Map;

/** 1.21.2 and later: feature renderers get a render state, not the entity, so the local player is recognised by position. */
public class CosFeature extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    public CosFeature(PlayerEntityRenderer parent) { super(parent); }

    private static ModelPart bone(PlayerEntityModel m, String slot) {
        return switch (slot) { case "head" -> m.head; case "back" -> m.body; case "armR" -> m.rightArm; case "armL" -> m.leftArm; case "legR" -> m.rightLeg; default -> m.leftLeg; };
    }

    @Override
    public void render(MatrixStack m, VertexConsumerProvider vcp, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player == null || state.invisible) return;
        if (Math.abs(state.x - mc.player.getX()) > 0.6 || Math.abs(state.y - mc.player.getY()) > 0.6 || Math.abs(state.z - mc.player.getZ()) > 0.6) return;   // only the local player for now
        PlayerEntityModel model = getContextModel();
        for (Map.Entry<String, CosCore.Item> e : GloryCosmeticsClient.CORE.worn().entrySet()) {
            CosCore.Item it = e.getValue();
            m.push(); bone(model, e.getKey()).rotate(m);
            VertexConsumer vc = vcp.getBuffer(RenderLayer.getEntityCutoutNoCull((Identifier) it.texture));
            MatrixStack.Entry en = m.peek();
            CosCore.emit(it, (x, y, z, u, v, nx, ny, nz) -> vc.vertex(en, x, y, z).color(255, 255, 255, 255).texture(u, v).overlay(OverlayTexture.DEFAULT_UV).light(light).normal(en, nx, ny, nz));
            m.pop();
        }
    }
}
