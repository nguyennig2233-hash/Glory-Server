package com.glory.cosmetics;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.ByteArrayInputStream;

/** Minecraft 1.16.x. The registration callback has three arguments here (no render context). */
public class GloryCosmeticsClient implements ClientModInitializer {
    static final CosCore CORE = new CosCore(FabricLoader.getInstance().getConfigDir().resolve("glory-cosmetics"), (id, png) -> {
        NativeImage img = NativeImage.read(new ByteArrayInputStream(png));
        Identifier ident = new Identifier("glorycosmetics", "tex/" + id);
        MinecraftClient.getInstance().getTextureManager().registerTexture(ident, new NativeImageBackedTexture(img));
        return ident;
    });

    @Override
    @SuppressWarnings({"unchecked", "rawtypes"})
    public void onInitializeClient() {
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register((type, renderer, helper) -> {
            if (renderer instanceof PlayerEntityRenderer) helper.register(new CosFeature((PlayerEntityRenderer) renderer));
        });
    }
}
