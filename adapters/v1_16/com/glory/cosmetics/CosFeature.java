package com.glory.cosmetics;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Matrix3f;
import net.minecraft.util.math.Matrix4f;

import java.util.Map;

/** 1.16.x (Java 8): the torso bone is called torso, and the matrix entry exposes getModel()/getNormal(). */
public class CosFeature extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {
    public CosFeature(FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> ctx) { super(ctx); }

    private static ModelPart bone(PlayerEntityModel<AbstractClientPlayerEntity> m, String slot) {
        if (slot.equals("head")) return m.head;
        if (slot.equals("back")) return m.torso;
        if (slot.equals("armR")) return m.rightArm;
        if (slot.equals("armL")) return m.leftArm;
        if (slot.equals("legR")) return m.rightLeg;
        return m.leftLeg;
    }

    @Override
    public void render(MatrixStack m, VertexConsumerProvider vcp, int light, AbstractClientPlayerEntity p, float limbAngle, float limbDistance, float tickDelta, float animationProgress, float headYaw, float headPitch) {
        if (p != MinecraftClient.getInstance().player || p.isInvisible()) return;   // only the local player for now
        PlayerEntityModel<AbstractClientPlayerEntity> model = getContextModel();
        for (Map.Entry<String, CosCore.Item> e : GloryCosmeticsClient.CORE.worn().entrySet()) {
            CosCore.Item it = e.getValue();
            m.push(); bone(model, e.getKey()).rotate(m);
            final VertexConsumer vc = vcp.getBuffer(RenderLayer.getEntityCutoutNoCull((Identifier) it.texture));
            MatrixStack.Entry en = m.peek(); final Matrix4f pm = en.getModel(); final Matrix3f nm = en.getNormal();
            final int lt = light;
            CosCore.emit(it, (x, y, z, u, v, nx, ny, nz) -> vc.vertex(pm, x, y, z).color(255, 255, 255, 255).texture(u, v).overlay(OverlayTexture.DEFAULT_UV).light(lt).normal(nm, nx, ny, nz).next());
            m.pop();
        }
    }
}
