package com.glory.cosmetics;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;
import org.joml.Matrix3f;
import org.joml.Matrix4f;

import java.util.Map;

/** 1.20.x: feature renderers get the entity; vertices need the position and normal matrices and a trailing next(). */
public class CosFeature extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {
    public CosFeature(FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> ctx) { super(ctx); }

    private static ModelPart bone(PlayerEntityModel<AbstractClientPlayerEntity> m, String slot) {
        return switch (slot) { case "head" -> m.head; case "back" -> m.body; case "armR" -> m.rightArm; case "armL" -> m.leftArm; case "legR" -> m.rightLeg; default -> m.leftLeg; };
    }

    @Override
    public void render(MatrixStack m, VertexConsumerProvider vcp, int light, AbstractClientPlayerEntity p, float limbAngle, float limbDistance, float tickDelta, float animationProgress, float headYaw, float headPitch) {
        if (p != MinecraftClient.getInstance().player || p.isInvisible()) return;   // only the local player for now
        PlayerEntityModel<AbstractClientPlayerEntity> model = getContextModel();
        for (Map.Entry<String, CosCore.Item> e : GloryCosmeticsClient.CORE.worn().entrySet()) {
            CosCore.Item it = e.getValue();
            m.push(); bone(model, e.getKey()).rotate(m);
            VertexConsumer vc = vcp.getBuffer(RenderLayer.getEntityCutoutNoCull((Identifier) it.texture));
            MatrixStack.Entry en = m.peek(); Matrix4f pm = en.getPositionMatrix(); Matrix3f nm = en.getNormalMatrix();
            CosCore.emit(it, (x, y, z, u, v, nx, ny, nz) -> vc.vertex(pm, x, y, z).color(255, 255, 255, 255).texture(u, v).overlay(OverlayTexture.DEFAULT_UV).light(light).normal(nm, nx, ny, nz).next());
            m.pop();
        }
    }
}
